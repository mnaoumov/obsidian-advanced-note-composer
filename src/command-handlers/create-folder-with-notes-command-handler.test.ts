import type {
  App as AppOriginal,
  TFolder
} from 'obsidian';
import type { FolderCommandHandlerShouldAddToFolderMenuParams } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import type {
  PluginNoticeComponent,
  PluginNoticeComponentShowNoticeAfterDelayParams
} from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { GenericObject } from 'obsidian-dev-utils/type-guards';
import type { MockInstance } from 'vitest';

import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { noopAsync } from 'obsidian-dev-utils/function';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { prompt } from 'obsidian-dev-utils/obsidian/modals/prompt';
import {
  requestResourceUnlockForPath,
  ResourceLockComponent
} from 'obsidian-dev-utils/obsidian/resource-lock';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { ConfirmDialogModalResult } from '../modals/confirm-dialog-modal.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';

import { InsertMode } from '../insert-mode.ts';
// The picker is the plugin's OWN sibling UI module: stub only its resolved folder so the palette path runs
// Without opening a suggest modal. Everything else (vault, lock, transaction) is REAL.
import { selectParentFolderForCreate } from '../modals/create-folder-parent-modal.ts';
import { openModal } from '../open-minimizable-modal.ts';
import { CreateFolderWithNotesCommandHandler } from './create-folder-with-notes-command-handler.ts';

interface CapturedConfirmParams {
  buildContent(this: void, fragment: DocumentFragment): Promise<void>;
  readonly canReselectTarget: boolean;
  promiseResolve(this: void, result: ConfirmDialogModalResult): void;
  readonly title: string;
}

interface HandlerContext {
  editAndSave: MockInstance<PluginSettingsComponent['editAndSave']>;
  handler: Testable;
  showNotice: MockInstance<PluginNoticeComponent['showNotice']>;
}

interface Testable {
  canExecute(): boolean;
  canExecuteFolder(folder: TFolder): boolean;
  execute(): Promise<void>;
  executeFolder(folder: TFolder): Promise<void>;
  readonly icon: string;
  readonly id: string;
  readonly name: string;
  shouldAddCommandToSubmenu(): boolean;
  shouldAddToFolderMenu(params: FolderCommandHandlerShouldAddToFolderMenuParams): boolean;
}

vi.mock('obsidian-dev-utils/html-element', () => ({
  createFragmentAsync: vi.fn().mockImplementation((callback: (f: DocumentFragment) => Promise<void>) => {
    const fragment = createFragment();
    return callback(fragment).then(() => fragment);
  })
}));

vi.mock('obsidian-dev-utils/obsidian/html-element', () => ({
  appendCodeBlock: vi.fn()
}));

// A FRESH element per call: `appendChild` MOVES a node rather than copying it, so one shared span would let
// A missing link pass unnoticed.
vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn().mockImplementation(() => Promise.resolve(createSpan()))
}));

vi.mock('obsidian-dev-utils/obsidian/modals/prompt', () => ({
  prompt: vi.fn()
}));

vi.mock('../modals/confirm-dialog-modal.ts', () => ({
  ConfirmDialogModal: class {
    public readonly params: CapturedConfirmParams;

    public constructor(params: CapturedConfirmParams) {
      this.params = params;
      capturedConfirmParams = params;
    }
  }
}));

vi.mock('../modals/create-folder-parent-modal.ts', () => ({
  selectParentFolderForCreate: vi.fn()
}));

vi.mock('../open-minimizable-modal.ts', () => ({
  openModal: vi.fn(() => {
    capturedConfirmParams?.promiseResolve(confirmResults.shift() ?? createConfirmResult(false));
  })
}));

const mockOpenModal = vi.mocked(openModal);
const mockPrompt = vi.mocked(prompt);
const mockRenderInternalLink = vi.mocked(renderInternalLink);
const mockSelectParentFolder = vi.mocked(selectParentFolderForCreate);

let app: AppOriginal;
let capturedConfirmParams: CapturedConfirmParams | null = null;
let confirmResults: ConfirmDialogModalResult[] = [];
let resourceLockComponent: ResourceLockComponent;

afterEach(() => {
  resourceLockComponent.unload();
  capturedConfirmParams = null;
  confirmResults = [];
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function createConfirmResult(isConfirmed: boolean, shouldAskAgain = true): ConfirmDialogModalResult {
  return {
    insertMode: InsertMode.Append,
    isConfirmed,
    shouldAskAgain,
    shouldReselectTarget: false,
    shouldSwitchToSmartCut: false
  };
}

function createHandler(settingsOverrides?: Partial<PluginSettings>): HandlerContext {
  // The callback IS the setting write, so it has to run for the "don't ask again" path to mean anything.
  const editAndSave = vi.fn().mockImplementation((edit: (settingsToEdit: PluginSettings) => void) => {
    edit(castTo<PluginSettings>({}));
    return noopAsync();
  });
  const showNotice = vi.fn().mockReturnValue({ hide: vi.fn() });
  const handler = new CreateFolderWithNotesCommandHandler({
    app,
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice, showNoticeAfterDelay: createShowNoticeAfterDelayStub() }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      editAndSave,
      settings: strictProxy<PluginSettings>({
        isPathIgnored: () => false,
        newFolderContentTemplate: '',
        newFolderNameTemplate: '{{index}}. {{safeFolderName}}',
        replacement: '_',
        shouldAddCommandsToSubmenu: true,
        shouldAskBeforeCreatingFolder: false,
        shouldBlockCommandOnPath: () => false,
        shouldOpenNoteAfterCreatingFolder: false,
        shouldReplaceInvalidTitleCharacters: true,
        shouldRunTemplaterOnDestinationFile: false,
        shouldShowOperationNotices: true,
        shouldTitleCaseCreatedFolderName: true,
        ...settingsOverrides
      })
    }),
    resourceLockComponent
  });
  return {
    editAndSave: castTo<MockInstance<PluginSettingsComponent['editAndSave']>>(editAndSave),
    handler: castTo<Testable>(handler),
    showNotice: castTo<MockInstance<PluginNoticeComponent['showNotice']>>(showNotice)
  };
}

function createShowNoticeAfterDelayStub(): PluginNoticeComponent['showNoticeAfterDelay'] {
  return vi.fn().mockImplementation((delayedNoticeParams: PluginNoticeComponentShowNoticeAfterDelayParams) => {
    invokeAsyncSafely(async () => {
      await castTo<() => Promise<unknown>>(delayedNoticeParams.content)();
    });
    return { setContent: vi.fn(), [Symbol.dispose]: vi.fn() };
  });
}

function getFolder(path: string): TFolder {
  return ensureNonNullable(app.vault.getFolderByPath(path));
}

function initApp(files: Record<string, string> = {}, plugins?: Record<string, unknown>): void {
  app = App.createConfigured__({ files }).asOriginalType__();
  if (plugins) {
    castTo<GenericObject>(app)['plugins'] = { plugins };
  }
  vi.spyOn(app.vault, 'getAvailablePath').mockImplementation((basePath, extension) => {
    const suffix = extension ? `.${extension}` : '';
    let candidate = `${basePath}${suffix}`;
    let index = 0;
    while (app.vault.getAbstractFileByPath(candidate) !== null) {
      index += 1;
      candidate = `${basePath} ${index.toString()}${suffix}`;
    }
    return candidate;
  });
  resourceLockComponent = new ResourceLockComponent(app, 'test-plugin');
  resourceLockComponent.load();
}

function listPaths(folderPath: string): string[] {
  return getFolder(folderPath).children.map((child) => child.path).sort();
}

async function readNote(path: string): Promise<string> {
  return await app.vault.read(ensureNonNullable(app.vault.getFileByPath(path)));
}

describe('CreateFolderWithNotesCommandHandler', () => {
  it('should expose its command identity', () => {
    initApp();
    const { handler } = createHandler();
    expect(handler.id).toBe('create-folder-with-notes');
    expect(handler.name).toBe('Create folder with notes...');
    expect(handler.icon).toBe('lucide-folder-plus');
  });

  it('should stay available from the palette with no active note', () => {
    // The base resolves the active file's parent and would otherwise hide a command that CREATES a folder.
    initApp();
    const { handler } = createHandler();
    expect(handler.canExecute()).toBe(true);
  });

  it('should offer itself on the vault root, unlike the folder commands that need an existing folder', () => {
    initApp({ 'a/note.md': 'A' });
    const { handler } = createHandler();
    expect(handler.canExecuteFolder(app.vault.getRoot())).toBe(true);
  });

  it('should refuse a blocked folder in canExecuteFolder', () => {
    initApp({ 'parent/note.md': 'note' });
    const { handler } = createHandler({ shouldBlockCommandOnPath: () => true });
    expect(handler.canExecuteFolder(getFolder('parent'))).toBe(false);
  });

  it('should add itself to the folder menu and follow the submenu setting', () => {
    initApp({ 'parent/note.md': 'note' });
    const { handler } = createHandler();
    expect(handler.shouldAddToFolderMenu(castTo<FolderCommandHandlerShouldAddToFolderMenuParams>({ source: 'file-explorer-context-menu' }))).toBe(true);
    expect(handler.shouldAddCommandToSubmenu()).toBe(true);
  });

  describe('refusals', () => {
    it('should refuse an ignored parent folder without prompting', async () => {
      initApp({ 'parent/note.md': 'note' });
      const { handler, showNotice } = createHandler({ isPathIgnored: () => true });
      await handler.executeFolder(getFolder('parent'));
      expect(showNotice).toHaveBeenCalledOnce();
      expect(mockPrompt).not.toHaveBeenCalled();
    });

    it('should do nothing when the prompt is cancelled', async () => {
      initApp({ 'parent/note.md': 'note' });
      mockPrompt.mockResolvedValue(null);
      const { handler } = createHandler();
      await handler.executeFolder(getFolder('parent'));
      expect(listPaths('parent')).toEqual(['parent/note.md']);
    });
  });

  describe('creating', () => {
    it('should create a numbered folder holding a note named after it', async () => {
      initApp({ 'parent/note.md': 'note' });
      mockPrompt.mockResolvedValue('test notes');
      const { handler } = createHandler();

      await handler.executeFolder(getFolder('parent'));

      expect(listPaths('parent')).toEqual(['parent/1. Test Notes', 'parent/note.md']);
      expect(listPaths('parent/1. Test Notes')).toEqual(['parent/1. Test Notes/Test Notes.md']);
      expect(await readNote('parent/1. Test Notes/Test Notes.md')).toBe('');
    });

    it('should continue the sibling numbering', async () => {
      initApp({
        'parent/1. Alpha/a.md': 'a',
        'parent/4. Beta/b.md': 'b'
      });
      mockPrompt.mockResolvedValue('gamma');
      const { handler } = createHandler();

      await handler.executeFolder(getFolder('parent'));

      expect(app.vault.getFolderByPath('parent/5. Gamma')).not.toBeNull();
    });

    it('should de-duplicate a colliding folder name and report the real one to the notes', async () => {
      // An un-numbered template is what makes a collision reachable at all: with `{{index}}` the sequence
      // Moves on instead. `{{folderName}}` then has to follow the de-duplicated PATH, not the template's
      // Own result.
      initApp({ 'parent/Alpha/a.md': 'a' });
      mockPrompt.mockResolvedValue('alpha');
      const { handler } = createHandler({
        newFolderContentTemplate: '{{file}} n.md\n{{folderName}}',
        newFolderNameTemplate: '{{safeFolderName}}'
      });

      await handler.executeFolder(getFolder('parent'));

      expect(await readNote('parent/Alpha 1/n.md')).toBe('Alpha 1\n');
    });

    it('should create several notes and resolve their tokens', async () => {
      initApp({ 'parent/note.md': 'note' });
      mockPrompt.mockResolvedValue('test notes');
      const { handler } = createHandler({
        newFolderContentTemplate: [
          '{{file}} !.md',
          '---',
          'title: "{{folderName}}"',
          'aliases:',
          '  - {{safeFolderName}}',
          '---',
          '',
          '- [ ] refine',
          '{{file}} {{safeFolderName}}.md',
          '# {{folderName}}'
        ].join('\n')
      });

      await handler.executeFolder(getFolder('parent'));

      expect(listPaths('parent/1. Test Notes')).toEqual([
        'parent/1. Test Notes/!.md',
        'parent/1. Test Notes/Test Notes.md'
      ]);
      expect(await readNote('parent/1. Test Notes/!.md')).toBe(
        '---\ntitle: "1. Test Notes"\naliases:\n  - Test Notes\n---\n\n- [ ] refine\n'
      );
      expect(await readNote('parent/1. Test Notes/Test Notes.md')).toBe('# 1. Test Notes\n');
    });

    it('should append the markdown extension when a note name carries none', async () => {
      initApp({ 'parent/note.md': 'note' });
      mockPrompt.mockResolvedValue('alpha');
      const { handler } = createHandler({ newFolderContentTemplate: '{{file}} Overview\nbody' });

      await handler.executeFolder(getFolder('parent'));

      expect(listPaths('parent/1. Alpha')).toEqual(['parent/1. Alpha/Overview.md']);
    });

    it('should resolve the index token in a note name', async () => {
      initApp({ 'parent/note.md': 'note' });
      mockPrompt.mockResolvedValue('alpha');
      const { handler } = createHandler({ newFolderContentTemplate: '{{file}} {{index:000}}.md\nbody' });

      await handler.executeFolder(getFolder('parent'));

      expect(listPaths('parent/1. Alpha')).toEqual(['parent/1. Alpha/001.md']);
    });

    it('should create the folder in the vault root', async () => {
      initApp({ 'note.md': 'note' });
      mockPrompt.mockResolvedValue('alpha');
      const { handler } = createHandler();

      await handler.executeFolder(app.vault.getRoot());

      expect(app.vault.getFolderByPath('1. Alpha')).not.toBeNull();
    });

    it('should fall back to the sanitized name when the template resolves to nothing', async () => {
      initApp({ 'parent/note.md': 'note' });
      mockPrompt.mockResolvedValue('alpha');
      const { handler } = createHandler({ newFolderNameTemplate: '{{rawFolderName}}' });

      await handler.executeFolder(getFolder('parent'));

      expect(app.vault.getFolderByPath('parent/alpha')).not.toBeNull();
    });

    it('should fall back to the sanitized name when the name template resolves to blank', async () => {
      initApp({ 'parent/note.md': 'note' });
      mockPrompt.mockResolvedValue('alpha');
      const { handler } = createHandler({ newFolderNameTemplate: ' '.repeat(3) });

      await handler.executeFolder(getFolder('parent'));

      expect(app.vault.getFolderByPath('parent/Alpha')).not.toBeNull();
    });

    it('should fall back to the folder name when a note name resolves to blank', async () => {
      // Reachable in the vault root, whose own name is empty.
      initApp({ 'note.md': 'note' });
      mockPrompt.mockResolvedValue('alpha');
      const { handler } = createHandler({ newFolderContentTemplate: '{{file}} {{parentFolder}}\nbody' });

      await handler.executeFolder(app.vault.getRoot());

      expect(app.vault.getFileByPath('1. Alpha/Alpha.md')).not.toBeNull();
    });

    it('should report what it created', async () => {
      initApp({ 'parent/note.md': 'note' });
      mockPrompt.mockResolvedValue('alpha');
      const { handler, showNotice } = createHandler();

      await handler.executeFolder(getFolder('parent'));

      expect(showNotice).toHaveBeenCalled();
    });
  });

  describe('the prompt validator', () => {
    async function captureValidator(settingsOverrides?: Partial<PluginSettings>): Promise<(value: string) => unknown> {
      mockPrompt.mockResolvedValue(null);
      const { handler } = createHandler(settingsOverrides);
      await handler.executeFolder(getFolder('parent'));
      const promptParams = ensureNonNullable(mockPrompt.mock.calls[0]?.[0]);
      return castTo<(value: string) => unknown>(promptParams.valueValidator);
    }

    it('should accept a usable name', async () => {
      initApp({ 'parent/note.md': 'note' });
      const validate = await captureValidator();
      expect(validate('test notes')).toBeUndefined();
    });

    it('should reject an empty name', async () => {
      initApp({ 'parent/note.md': 'note' });
      const validate = await captureValidator();
      expect(validate('')).toBe('Folder name cannot be empty');
    });

    it('should reject a name that normalizes to nothing', async () => {
      initApp({ 'parent/note.md': 'note' });
      const validate = await captureValidator();
      expect(validate('  ...  ')).toBe('Folder name cannot be empty');
    });

    it('should accept an invalid character while replacing is on, since it gets replaced', async () => {
      initApp({ 'parent/note.md': 'note' });
      const validate = await captureValidator();
      expect(validate('a*b')).toBeUndefined();
    });

    it('should reject an invalid character while replacing is off', async () => {
      initApp({ 'parent/note.md': 'note' });
      const validate = await captureValidator({ shouldReplaceInvalidTitleCharacters: false });
      expect(validate('a*b')).toBe('Folder name contains invalid characters');
    });
  });

  describe('rollback', () => {
    it('should roll back and stay silent when the operation is cancelled', async () => {
      initApp({ 'parent/note.md': 'note' });
      mockPrompt.mockResolvedValue('alpha');
      const { handler } = createHandler();
      const parentFolder = getFolder('parent');
      vi.spyOn(app.vault, 'create').mockImplementation(() => {
        requestResourceUnlockForPath(app, parentFolder.path);
        return Promise.reject(new Error('Create cancelled.'));
      });

      await expect(handler.executeFolder(parentFolder)).resolves.toBeUndefined();

      expect(app.vault.getFolderByPath('parent/1. Alpha')).toBeNull();
    });

    it('should roll back and rethrow a non-abort error', async () => {
      initApp({ 'parent/note.md': 'note' });
      mockPrompt.mockResolvedValue('alpha');
      const { handler } = createHandler();
      vi.spyOn(app.vault, 'create').mockRejectedValue(new Error('Disk full.'));

      await expect(handler.executeFolder(getFolder('parent'))).rejects.toThrow('Disk full.');

      expect(app.vault.getFolderByPath('parent/1. Alpha')).toBeNull();
    });
  });

  describe('the palette path', () => {
    it('should ask which folder to create in, then create there', async () => {
      initApp({ 'parent/note.md': 'note' });
      mockSelectParentFolder.mockImplementation(() => Promise.resolve(getFolder('parent')));
      mockPrompt.mockResolvedValue('alpha');
      const { handler } = createHandler();

      await handler.execute();

      expect(mockSelectParentFolder).toHaveBeenCalledOnce();
      expect(app.vault.getFolderByPath('parent/1. Alpha')).not.toBeNull();
    });

    it('should do nothing when the picker is dismissed', async () => {
      initApp({ 'parent/note.md': 'note' });
      mockSelectParentFolder.mockResolvedValue(null);
      const { handler } = createHandler();

      await handler.execute();

      expect(mockPrompt).not.toHaveBeenCalled();
    });
  });

  describe('confirmation', () => {
    it('should create nothing when the dialog is cancelled', async () => {
      initApp({ 'parent/note.md': 'note' });
      mockPrompt.mockResolvedValue('alpha');
      const { handler } = createHandler({ shouldAskBeforeCreatingFolder: true });

      await handler.executeFolder(getFolder('parent'));

      expect(mockOpenModal).toHaveBeenCalledOnce();
      expect(listPaths('parent')).toEqual(['parent/note.md']);
    });

    it('should create and persist "don\'t ask again" when confirmed', async () => {
      initApp({ 'parent/note.md': 'note' });
      mockPrompt.mockResolvedValue('alpha');
      confirmResults = [createConfirmResult(true, false)];
      const { editAndSave, handler } = createHandler({ shouldAskBeforeCreatingFolder: true });

      await handler.executeFolder(getFolder('parent'));

      expect(app.vault.getFolderByPath('parent/1. Alpha')).not.toBeNull();
      expect(editAndSave).toHaveBeenCalledOnce();
    });

    it('should render the dialog body with the destination linked and the target unchangeable', async () => {
      initApp({ 'parent/note.md': 'note' });
      mockPrompt.mockResolvedValue('alpha');
      confirmResults = [createConfirmResult(true)];
      const { handler } = createHandler({ shouldAskBeforeCreatingFolder: true });

      await handler.executeFolder(getFolder('parent'));

      const params = ensureNonNullable(capturedConfirmParams);
      expect(params.title).toBe('Create folder with notes');
      expect(params.canReselectTarget).toBe(false);
      const fragment = createFragment();
      // The completion notice renders links of its own, so only the dialog's are counted.
      mockRenderInternalLink.mockClear();
      await params.buildContent(fragment);
      expect(mockRenderInternalLink).toHaveBeenCalledOnce();
      expect(fragment.textContent).toContain('Are you sure you want to create');
    });

    it('should label the vault root as / in the dialog', async () => {
      initApp({ 'note.md': 'note' });
      mockPrompt.mockResolvedValue('alpha');
      confirmResults = [createConfirmResult(true)];
      const { handler } = createHandler({ shouldAskBeforeCreatingFolder: true });

      await handler.executeFolder(app.vault.getRoot());

      const params = ensureNonNullable(capturedConfirmParams);
      mockRenderInternalLink.mockClear();
      await params.buildContent(createFragment());
      expect(mockRenderInternalLink).toHaveBeenCalledWith(expect.objectContaining({ displayText: '/' }));
    });
  });

  describe('opening the created note', () => {
    it('should open the first declared note', async () => {
      initApp({ 'parent/note.md': 'note' });
      mockPrompt.mockResolvedValue('alpha');
      const openFile = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(app.workspace, 'getLeaf').mockReturnValue(castTo<ReturnType<AppOriginal['workspace']['getLeaf']>>({ openFile }));
      const { handler } = createHandler({
        newFolderContentTemplate: '{{file}} first.md\na\n{{file}} second.md\nb',
        shouldOpenNoteAfterCreatingFolder: true
      });

      await handler.executeFolder(getFolder('parent'));

      expect(openFile).toHaveBeenCalledOnce();
      expect(openFile.mock.calls[0]?.[0]).toMatchObject({ path: 'parent/1. Alpha/first.md' });
    });
  });

  describe('templater', () => {
    it('should warn when templater is enabled but the plugin is not installed', async () => {
      initApp({ 'parent/note.md': 'note' }, {});
      mockPrompt.mockResolvedValue('alpha');
      const { handler, showNotice } = createHandler({ shouldRunTemplaterOnDestinationFile: true });

      await handler.executeFolder(getFolder('parent'));

      expect(showNotice).toHaveBeenCalled();
      // The prelude must NOT be left behind when nothing will process it.
      expect(await readNote('parent/1. Alpha/Alpha.md')).toBe('');
    });

    it('should inject the TOKENS prelude and hand each note to templater', async () => {
      const overwriteFileCommands = vi.fn().mockResolvedValue(undefined);
      initApp({ 'parent/note.md': 'note' }, {
        // eslint-disable-next-line camelcase -- `overwrite_file_commands` is Templater's own API name.
        'templater-obsidian': { templater: { overwrite_file_commands: overwriteFileCommands } }
      });
      mockPrompt.mockResolvedValue('alpha');
      const { handler } = createHandler({
        newFolderContentTemplate: '{{file}} n.md\n# {{folderName}}',
        shouldRunTemplaterOnDestinationFile: true
      });

      await handler.executeFolder(getFolder('parent'));

      expect(overwriteFileCommands).toHaveBeenCalledOnce();
      const content = await readNote('parent/1. Alpha/n.md');
      expect(content).toContain('<%*');
      expect(content).toContain('const TOKENS = {');
      expect(content).toContain('safeFolderName: "Alpha"');
      expect(content).toContain('index: 1,');
      expect(content.endsWith('# 1. Alpha\n')).toBe(true);
    });
  });
});
