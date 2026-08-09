import type {
  App as AppOriginal,
  TFolder
} from 'obsidian';
import type { FolderCommandHandlerShouldAddToFolderMenuParams } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import type {
  PluginNoticeComponent,
  PluginNoticeComponentShowNoticeAfterDelayParams
} from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { MaybeReturn } from 'obsidian-dev-utils/type';
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
import { selectFolder } from '../modals/select-folder-modal.ts';
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
  validateTypedNoteName(params: ValidateTypedNoteNameParams): Promise<MaybeReturn<string>>;
}

interface ValidateTypedNoteNameParams {
  readonly otherNoteNames: readonly string[];
  readonly value: string;
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

    // A `Rename` button closes the dialog after resolving (issue #200).
    public close(): void {
      closeCount++;
    }
  }
}));

vi.mock('../modals/select-folder-modal.ts', () => ({
  selectFolder: vi.fn()
}));

vi.mock('../open-minimizable-modal.ts', () => ({
  openModal: vi.fn(() => {
    const renameButtonIndex = renameButtonClicks.shift();
    if (renameButtonIndex === undefined) {
      capturedConfirmParams?.promiseResolve(confirmResults.shift() ?? createConfirmResult(false));
      return;
    }

    // The `Rename` buttons live in the dialog BODY (issue #200), not in its button container, so driving one
    // Means building the content and clicking the real button.
    invokeAsyncSafely(async () => {
      const fragment = createFragment();
      await ensureNonNullable(capturedConfirmParams).buildContent(fragment);
      ensureNonNullable([...fragment.querySelectorAll('button')][renameButtonIndex]).click();
    });
  })
}));

const mockOpenModal = vi.mocked(openModal);
const mockSelectFolder = vi.mocked(selectFolder);
const mockPrompt = vi.mocked(prompt);
const mockRenderInternalLink = vi.mocked(renderInternalLink);

let app: AppOriginal;
let capturedConfirmParams: CapturedConfirmParams | null = null;
let closeCount = 0;
let confirmResults: ConfirmDialogModalResult[] = [];

/**
 * Which `Rename` button each successive dialog should click: `0` is the folder's, `1 + n` is note `n`'s. A
 * dialog with no entry left resolves from {@link confirmResults}, exactly as before issue #200.
 */
let renameButtonClicks: number[] = [];
let resourceLockComponent: ResourceLockComponent;

afterEach(() => {
  resourceLockComponent.unload();
  capturedConfirmParams = null;
  closeCount = 0;
  confirmResults = [];
  renameButtonClicks = [];
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

/**
 * A dialog result that asks to go back to the parent-folder picker.
 *
 * @returns The result.
 */
function createConfirmReselect(): ConfirmDialogModalResult {
  return {
    ...createConfirmResult(false),
    shouldReselectTarget: true
  };
}

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
        nameTransformTemplate: '',
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
    async function captureValidator(settingsOverrides?: Partial<PluginSettings>): Promise<(value: string) => Promise<unknown>> {
      mockPrompt.mockResolvedValue(null);
      const { handler } = createHandler(settingsOverrides);
      await handler.executeFolder(getFolder('parent'));
      const promptParams = ensureNonNullable(mockPrompt.mock.calls[0]?.[0]);
      return castTo<(value: string) => Promise<unknown>>(promptParams.valueValidator);
    }

    it('should accept a usable name', async () => {
      initApp({ 'parent/note.md': 'note' });
      const validate = await captureValidator();
      expect(await validate('test notes')).toBeUndefined();
    });

    it('should reject an empty name', async () => {
      initApp({ 'parent/note.md': 'note' });
      const validate = await captureValidator();
      expect(await validate('')).toBe('Folder name cannot be empty');
    });

    it('should reject a name that normalizes to nothing', async () => {
      initApp({ 'parent/note.md': 'note' });
      const validate = await captureValidator();
      expect(await validate('  ...  ')).toBe('Folder name cannot be empty');
    });

    it('should accept an invalid character while replacing is on, since it gets replaced', async () => {
      initApp({ 'parent/note.md': 'note' });
      const validate = await captureValidator();
      expect(await validate('a*b')).toBeUndefined();
    });

    it('should reject an invalid character while replacing is off', async () => {
      initApp({ 'parent/note.md': 'note' });
      const validate = await captureValidator({ shouldReplaceInvalidTitleCharacters: false });
      expect(await validate('a*b')).toBe('Folder name contains invalid characters');
    });
  });

  describe('name transform (issue #196)', () => {
    it('should apply the transform before the rest of the normalization', async () => {
      initApp({ 'parent/note.md': 'note' });
      mockPrompt.mockResolvedValue('alpha');
      const { handler } = createHandler({ nameTransformTemplate: '{{rawString}} notes' });

      await handler.executeFolder(getFolder('parent'));

      // Title Case runs on the transform's output, not on what was typed.
      expect(listPaths('parent/1. Alpha Notes')).toEqual(['parent/1. Alpha Notes/Alpha Notes.md']);
    });

    it('should map a character that the replacement string would otherwise mangle', async () => {
      const parseTemplate = vi.fn().mockResolvedValue('A - B');
      initApp({ 'parent/note.md': 'note' }, {
        'templater-obsidian': {
          templater: {
            /* eslint-disable camelcase -- Templater's own API method names. */
            create_running_config: vi.fn().mockReturnValue({}),
            parse_template: parseTemplate
            /* eslint-enable camelcase -- Templater's own API method names. */
          }
        }
      });
      vi.spyOn(app.workspace, 'getActiveFile').mockReturnValue(app.vault.getFileByPath('parent/note.md'));
      mockPrompt.mockResolvedValue('A: B');
      const { handler } = createHandler({ nameTransformTemplate: '<% TOKENS.rawString.replaceAll(": ", " - ") %>' });

      await handler.executeFolder(getFolder('parent'));

      // Without the transform the `:` would have become `_`, giving `1. A_ B`.
      expect(app.vault.getFolderByPath('parent/1. A - B')).not.toBeNull();
    });

    it('should report a broken transform in the prompt instead of letting it escape', async () => {
      initApp({ 'parent/note.md': 'note' });
      mockPrompt.mockResolvedValue(null);
      const { handler } = createHandler({ nameTransformTemplate: '{{nope}}' });
      await handler.executeFolder(getFolder('parent'));
      const promptParams = ensureNonNullable(mockPrompt.mock.calls[0]?.[0]);
      const validate = castTo<(value: string) => Promise<unknown>>(promptParams.valueValidator);

      expect(await validate('alpha')).toBe('Invalid template key: nope');
    });

    it('should report a template that throws something other than an Error', async () => {
      // Templater runs user JS, and `throw "boom"` is legal JS.
      initApp({ 'parent/note.md': 'note' }, {
        'templater-obsidian': {
          templater: {
            /* eslint-disable camelcase -- Templater's own API method names. */
            create_running_config: vi.fn().mockReturnValue({}),
            parse_template: vi.fn().mockRejectedValue('boom')
            /* eslint-enable camelcase -- Templater's own API method names. */
          }
        }
      });
      vi.spyOn(app.workspace, 'getActiveFile').mockReturnValue(app.vault.getFileByPath('parent/note.md'));
      mockPrompt.mockResolvedValue(null);
      const { handler } = createHandler({ nameTransformTemplate: '<% throw "boom" %>' });
      await handler.executeFolder(getFolder('parent'));
      const promptParams = ensureNonNullable(mockPrompt.mock.calls[0]?.[0]);
      const validate = castTo<(value: string) => Promise<unknown>>(promptParams.valueValidator);

      expect(await validate('alpha')).toBe('boom');
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

  /*
   * Issue #194: the palette used to open a folder picker. It now resolves through Obsidian's own
   * `Default location for new notes`, so each of the two entry points has ONE unambiguous source.
   * `newFileLocation` / `newFileFolderPath` are modeled by neither obsidian-typings nor
   * obsidian-test-mocks, so the RESOLUTION itself can only be exercised in an integration test. What is
   * asserted here is that the palette routes through Obsidian's own resolver at all, with the source path
   * that makes its `Same folder as current file` mode mean anything.
   */
  describe('the palette path', () => {
    it('should resolve the parent through Obsidian\'s new-note location, then create there', async () => {
      initApp({ 'parent/note.md': 'note' });
      vi.spyOn(app.workspace, 'getActiveFile').mockReturnValue(ensureNonNullable(app.vault.getFileByPath('parent/note.md')));
      const getNewFileParent = vi.spyOn(app.fileManager, 'getNewFileParent').mockReturnValue(getFolder('parent'));
      mockPrompt.mockResolvedValue('alpha');
      const { handler } = createHandler();

      await handler.execute();

      expect(getNewFileParent).toHaveBeenCalledWith('parent/note.md');
      expect(app.vault.getFolderByPath('parent/1. Alpha')).not.toBeNull();
    });

    it('should resolve with an empty source path when no note is open', async () => {
      // The command is offered with nothing open, which is the one case `Same folder as current file` has
      // No answer for — Obsidian's own resolver falls back to the vault root for it.
      initApp({ 'note.md': 'note' });
      vi.spyOn(app.workspace, 'getActiveFile').mockReturnValue(null);
      const getNewFileParent = vi.spyOn(app.fileManager, 'getNewFileParent').mockReturnValue(app.vault.getRoot());
      mockPrompt.mockResolvedValue('alpha');
      const { handler } = createHandler();

      await handler.execute();

      expect(getNewFileParent).toHaveBeenCalledWith('');
      expect(app.vault.getFolderByPath('1. Alpha')).not.toBeNull();
    });

    it('should refuse when the resolved folder is ignored', async () => {
      // Obsidian points at a folder the plugin is told to ignore. The refusal states that contradiction
      // Rather than silently creating the folder somewhere else.
      initApp({ 'parent/note.md': 'note' });
      vi.spyOn(app.workspace, 'getActiveFile').mockReturnValue(null);
      vi.spyOn(app.fileManager, 'getNewFileParent').mockReturnValue(getFolder('parent'));
      const { handler, showNotice } = createHandler({ isPathIgnored: () => true });

      await handler.execute();

      expect(showNotice).toHaveBeenCalledOnce();
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

    it('should render the dialog body with the destination linked and the target changeable', async () => {
      initApp({ 'parent/note.md': 'note' });
      mockPrompt.mockResolvedValue('alpha');
      confirmResults = [createConfirmResult(true)];
      const { handler } = createHandler({ shouldAskBeforeCreatingFolder: true });

      await handler.executeFolder(getFolder('parent'));

      const params = ensureNonNullable(capturedConfirmParams);
      expect(params.title).toBe('Create folder with notes');
      // Issue #199: the parent folder can be changed from the dialog.
      expect(params.canReselectTarget).toBe(true);
      const fragment = createFragment();
      // The completion notice renders links of its own, so only the dialog's are counted.
      mockRenderInternalLink.mockClear();
      await params.buildContent(fragment);
      expect(mockRenderInternalLink).toHaveBeenCalledOnce();
      expect(fragment.textContent).toContain('Are you sure you want to create');
    });

    // Issue #199: the parent folder is decided before the command starts (right-clicked, or Obsidian's
    // Default new-note location), so "Change target" is the only way to move it without starting over.
    it('should create the folder under the parent picked from the dialog', async () => {
      initApp({
        'elsewhere/other.md': 'other',
        'parent/note.md': 'note'
      });
      mockPrompt.mockResolvedValue('alpha');
      confirmResults = [createConfirmReselect(), createConfirmResult(true)];
      mockSelectFolder.mockResolvedValue(getFolder('elsewhere'));

      const { handler } = createHandler({ shouldAskBeforeCreatingFolder: true });
      await handler.executeFolder(getFolder('parent'));

      expect(app.vault.getFolderByPath('elsewhere/1. Alpha')).not.toBeNull();
      expect(app.vault.getFolderByPath('parent/1. Alpha')).toBeNull();

      // An ignored folder is refused by `executeFolder` up front, so it is never offered here either.
      const isAllowedFolder = mockSelectFolder.mock.calls[0]?.[0].isAllowedFolder;
      expect(isAllowedFolder?.(getFolder('elsewhere'))).toBe(true);
    });

    it('should renumber the folder against the NEW parent siblings', async () => {
      // The whole plan is rebuilt around the picked parent: the index counts ITS children, not the old
      // Parent's, so the previewed name is the one the write actually produces.
      initApp({
        'elsewhere/1. Existing/x.md': 'x',
        'parent/note.md': 'note'
      });
      mockPrompt.mockResolvedValue('alpha');
      confirmResults = [createConfirmReselect(), createConfirmResult(true)];
      mockSelectFolder.mockResolvedValue(getFolder('elsewhere'));

      const { handler } = createHandler({ shouldAskBeforeCreatingFolder: true });
      await handler.executeFolder(getFolder('parent'));

      expect(app.vault.getFolderByPath('elsewhere/2. Alpha')).not.toBeNull();
    });

    it('should keep the current parent when the picker is dismissed', async () => {
      initApp({ 'parent/note.md': 'note' });
      mockPrompt.mockResolvedValue('alpha');
      confirmResults = [createConfirmReselect(), createConfirmResult(true)];
      mockSelectFolder.mockResolvedValue(null);

      const { handler } = createHandler({ shouldAskBeforeCreatingFolder: true });
      await handler.executeFolder(getFolder('parent'));

      expect(app.vault.getFolderByPath('parent/1. Alpha')).not.toBeNull();
    });

    it('should not open the picker at all when the confirmation is turned off', async () => {
      initApp({ 'parent/note.md': 'note' });
      mockPrompt.mockResolvedValue('alpha');

      const { handler } = createHandler({ shouldAskBeforeCreatingFolder: false });
      await handler.executeFolder(getFolder('parent'));

      expect(mockSelectFolder).not.toHaveBeenCalled();
      expect(app.vault.getFolderByPath('parent/1. Alpha')).not.toBeNull();
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

  // Issue #200: the dialog previews a name that is not what was typed, so it is the one place a rename can
  // Still change the outcome. The folder's `Rename` rebuilds the whole plan; a note's overrides that row.
  describe('renaming from the confirmation dialog (issue #200)', () => {
    it('should rebuild the plan around the folder name typed into Rename', async () => {
      initApp({ 'parent/note.md': 'note' });
      mockPrompt.mockResolvedValueOnce('alpha').mockResolvedValueOnce('beta');
      renameButtonClicks = [0];
      confirmResults = [createConfirmResult(true)];
      const { handler } = createHandler({ shouldAskBeforeCreatingFolder: true });

      await handler.executeFolder(getFolder('parent'));

      expect(app.vault.getFolderByPath('parent/1. Alpha')).toBeNull();
      // The token-derived note name followed the rename, so the whole plan was rebuilt rather than patched.
      expect(listPaths('parent/1. Beta')).toEqual(['parent/1. Beta/Beta.md']);
      // The dialog was closed rather than left open behind the prompt.
      expect(closeCount).toBe(1);
    });

    it('should seed the folder Rename prompt with the name already typed', async () => {
      initApp({ 'parent/note.md': 'note' });
      mockPrompt.mockResolvedValueOnce('alpha').mockResolvedValueOnce('beta');
      renameButtonClicks = [0];
      confirmResults = [createConfirmResult(true)];
      const { handler } = createHandler({ shouldAskBeforeCreatingFolder: true });

      await handler.executeFolder(getFolder('parent'));

      expect(mockPrompt.mock.calls[0]?.[0]).toMatchObject({ defaultValue: '', okButtonText: 'Create' });
      expect(mockPrompt.mock.calls[1]?.[0]).toMatchObject({ defaultValue: 'alpha', okButtonText: 'Rename' });
    });

    it('should keep the current name when the folder Rename prompt is dismissed', async () => {
      initApp({ 'parent/note.md': 'note' });
      mockPrompt.mockResolvedValueOnce('alpha').mockResolvedValueOnce(null);
      renameButtonClicks = [0];
      confirmResults = [createConfirmResult(true)];
      const { handler } = createHandler({ shouldAskBeforeCreatingFolder: true });

      await handler.executeFolder(getFolder('parent'));

      expect(listPaths('parent/1. Alpha')).toEqual(['parent/1. Alpha/Alpha.md']);
    });

    it('should rename one note without touching the others', async () => {
      initApp({ 'parent/note.md': 'note' });
      mockPrompt.mockResolvedValueOnce('alpha').mockResolvedValueOnce('renamed');
      // `0` is the folder's button, so `2` is the SECOND note's.
      renameButtonClicks = [2];
      confirmResults = [createConfirmResult(true)];
      const { handler } = createHandler({
        newFolderContentTemplate: '{{file}} first.md\na\n{{file}} second.md\nb',
        shouldAskBeforeCreatingFolder: true
      });

      await handler.executeFolder(getFolder('parent'));

      expect(listPaths('parent/1. Alpha')).toEqual(['parent/1. Alpha/first.md', 'parent/1. Alpha/renamed.md']);
      expect(mockPrompt.mock.calls[1]?.[0]).toMatchObject({ defaultValue: 'second.md', okButtonText: 'Rename' });

      // The prompt's validator knows about the OTHER planned notes, so a collision is refused up front
      // Rather than silently de-duplicated into `first 1.md` by the write.
      const validate = castTo<(value: string) => Promise<unknown>>(ensureNonNullable(mockPrompt.mock.calls[1]?.[0]).valueValidator);
      expect(await validate('first')).toBe('Another note in this folder is already named that');
    });

    it('should keep the previewed note name when its Rename prompt is dismissed', async () => {
      initApp({ 'parent/note.md': 'note' });
      mockPrompt.mockResolvedValueOnce('alpha').mockResolvedValueOnce(null);
      renameButtonClicks = [1];
      confirmResults = [createConfirmResult(true)];
      const { handler } = createHandler({ shouldAskBeforeCreatingFolder: true });

      await handler.executeFolder(getFolder('parent'));

      expect(listPaths('parent/1. Alpha')).toEqual(['parent/1. Alpha/Alpha.md']);
    });

    it('should keep a renamed note when the folder is renamed afterwards', async () => {
      // The user named that note deliberately; re-deriving it from `{{safeFolderName}}` would silently undo
      // Them, so the override outlives the rebuild.
      initApp({ 'parent/note.md': 'note' });
      mockPrompt.mockResolvedValueOnce('alpha').mockResolvedValueOnce('kept').mockResolvedValueOnce('beta');
      renameButtonClicks = [1, 0];
      confirmResults = [createConfirmResult(true)];
      const { handler } = createHandler({ shouldAskBeforeCreatingFolder: true });

      await handler.executeFolder(getFolder('parent'));

      expect(listPaths('parent/1. Beta')).toEqual(['parent/1. Beta/kept.md']);
    });

    it('should keep a renamed note across Change target', async () => {
      initApp({
        'elsewhere/other.md': 'other',
        'parent/note.md': 'note'
      });
      mockPrompt.mockResolvedValueOnce('alpha').mockResolvedValueOnce('kept');
      renameButtonClicks = [1];
      confirmResults = [createConfirmReselect(), createConfirmResult(true)];
      mockSelectFolder.mockResolvedValue(getFolder('elsewhere'));
      const { handler } = createHandler({ shouldAskBeforeCreatingFolder: true });

      await handler.executeFolder(getFolder('parent'));

      expect(listPaths('elsewhere/1. Alpha')).toEqual(['elsewhere/1. Alpha/kept.md']);
    });

    it('should render a Rename button beside the folder and beside every note', async () => {
      initApp({ 'parent/note.md': 'note' });
      mockPrompt.mockResolvedValue('alpha');
      confirmResults = [createConfirmResult(true)];
      const { handler } = createHandler({
        newFolderContentTemplate: '{{file}} first.md\na\n{{file}} second.md\nb',
        shouldAskBeforeCreatingFolder: true
      });

      await handler.executeFolder(getFolder('parent'));

      const fragment = createFragment();
      await ensureNonNullable(capturedConfirmParams).buildContent(fragment);
      const buttonTexts = [...fragment.querySelectorAll('button')].map((buttonEl) => buttonEl.textContent);
      expect(buttonTexts).toEqual(['Rename', 'Rename', 'Rename']);
    });
  });

  describe('note rename validation (issue #200)', () => {
    it('should refuse a name that normalizes to nothing', async () => {
      initApp({ 'parent/note.md': 'note' });
      const { handler } = createHandler();
      // Without this the empty name would become a note literally called `.md`.
      expect(await handler.validateTypedNoteName({ otherNoteNames: [], value: ' ' })).toBe('Note name cannot be empty');
    });

    it('should refuse an invalid character while replacing is off', async () => {
      initApp({ 'parent/note.md': 'note' });
      const { handler } = createHandler({ shouldReplaceInvalidTitleCharacters: false });
      expect(await handler.validateTypedNoteName({ otherNoteNames: [], value: 'a*b' })).toBe('Note name contains invalid characters');
    });

    it('should refuse a name another planned note already holds, case-insensitively', async () => {
      // The write de-duplicates through `getAvailablePath`, so without this the dialog would preview
      // `second.md` twice and create `second 1.md`.
      initApp({ 'parent/note.md': 'note' });
      const { handler } = createHandler();
      const message = 'Another note in this folder is already named that';
      expect(await handler.validateTypedNoteName({ otherNoteNames: ['second.md'], value: 'second' })).toBe(message);
      expect(await handler.validateTypedNoteName({ otherNoteNames: ['second.md'], value: 'SECOND.md' })).toBe(message);
    });

    it('should accept a name nothing else holds', async () => {
      initApp({ 'parent/note.md': 'note' });
      const { handler } = createHandler();
      expect(await handler.validateTypedNoteName({ otherNoteNames: ['second.md'], value: 'third' })).toBeUndefined();
    });

    it('should report a broken name transform instead of letting it escape', async () => {
      initApp({ 'parent/note.md': 'note' });
      const { handler } = createHandler({ nameTransformTemplate: '{{nope}}' });
      expect(await handler.validateTypedNoteName({ otherNoteNames: [], value: 'alpha' })).toBe('Invalid template key: nope');
    });

    it('should report a transform that throws something other than an Error', async () => {
      initApp({ 'parent/note.md': 'note' }, {
        'templater-obsidian': {
          templater: {
            /* eslint-disable camelcase -- Templater's own API method names. */
            create_running_config: vi.fn().mockReturnValue({}),
            parse_template: vi.fn().mockRejectedValue('boom')
            /* eslint-enable camelcase -- Templater's own API method names. */
          }
        }
      });
      vi.spyOn(app.workspace, 'getActiveFile').mockReturnValue(app.vault.getFileByPath('parent/note.md'));
      const { handler } = createHandler({ nameTransformTemplate: '<% throw "boom" %>' });

      expect(await handler.validateTypedNoteName({ otherNoteNames: [], value: 'alpha' })).toBe('boom');
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

    it('should parse each note with TOKENS declared first and write back the result', async () => {
      const parseTemplate = vi.fn().mockResolvedValue('rendered\n');
      const startTask = vi.fn();
      const endTask = vi.fn().mockResolvedValue(undefined);
      initApp({ 'parent/note.md': 'note' }, {
        'templater-obsidian': {
          templater: {
            /* eslint-disable camelcase -- Templater's own API method names. */
            create_running_config: vi.fn().mockReturnValue({}),
            end_templater_task: endTask,
            parse_template: parseTemplate,
            start_templater_task: startTask
            /* eslint-enable camelcase -- Templater's own API method names. */
          }
        }
      });
      mockPrompt.mockResolvedValue('alpha');
      const { handler } = createHandler({
        newFolderContentTemplate: '{{file}} n.md\n# {{folderName}}',
        shouldRunTemplaterOnDestinationFile: true
      });

      await handler.executeFolder(getFolder('parent'));

      expect(parseTemplate).toHaveBeenCalledOnce();
      const parsedTemplate = castTo<string>(parseTemplate.mock.calls[0]?.[1]);
      // Declared FIRST: anything below it may reference `TOKENS`, including the note's own frontmatter.
      expect(parsedTemplate.startsWith('<%*\nconst TOKENS = {')).toBe(true);
      expect(parsedTemplate).toContain('"safeFolderName":"Alpha"');
      expect(parsedTemplate).toContain('"index":1');
      expect(parsedTemplate.endsWith('# 1. Alpha\n')).toBe(true);

      // The note on disk NEVER holds the prelude — that is what keeps its frontmatter real for the
      // Metadata cache, and therefore what keeps `tp.frontmatter` working.
      expect(await readNote('parent/1. Alpha/n.md')).toBe('rendered\n');
      expect(startTask).toHaveBeenCalledWith('parent/1. Alpha/n.md');
      expect(endTask).toHaveBeenCalledWith('parent/1. Alpha/n.md');
    });

    it('should name the note a broken template failed on, close its task, and keep going', async () => {
      const endTask = vi.fn().mockResolvedValue(undefined);
      const parseTemplate = vi.fn()
        .mockRejectedValueOnce(new Error('bad template'))
        .mockResolvedValueOnce('second\n');
      initApp({ 'parent/note.md': 'note' }, {
        'templater-obsidian': {
          templater: {
            /* eslint-disable camelcase -- Templater's own API method names. */
            create_running_config: vi.fn().mockReturnValue({}),
            end_templater_task: endTask,
            parse_template: parseTemplate,
            start_templater_task: vi.fn()
            /* eslint-enable camelcase -- Templater's own API method names. */
          }
        }
      });
      mockPrompt.mockResolvedValue('alpha');
      const { handler, showNotice } = createHandler({
        newFolderContentTemplate: '{{file}} first.md\n# one\n{{file}} second.md\n# two',
        shouldRunTemplaterOnDestinationFile: true
      });

      await handler.executeFolder(getFolder('parent'));

      // Not the LAST notice — the operation still completes, so its completion notice comes after this one.
      // The path is rendered with `appendCodeBlock`, which contributes nothing to `textContent` under the
      // Mocks (the completion notice loses its names the same way), so only the message is asserted here.
      const noticeTexts = showNotice.mock.calls.map((call) => {
        const content = call[0];
        return typeof content === 'string' ? content : content.textContent;
      });
      expect(noticeTexts.some((text) => text.includes('Templater failed on') && text.includes('bad template'))).toBe(true);
      // The failed note keeps what it had; the next one is still rendered.
      expect(await readNote('parent/1. Alpha/first.md')).toBe('# one\n');
      expect(await readNote('parent/1. Alpha/second.md')).toBe('second\n');
      // `finally`, so a broken template cannot strand the pair that fires `tp.hooks`.
      expect(endTask).toHaveBeenCalledTimes(2);
    });

    it('should report a created note whose template throws something other than an Error', async () => {
      // Templater runs user JS, and `throw "boom"` is legal JS.
      initApp({ 'parent/note.md': 'note' }, {
        'templater-obsidian': {
          templater: {
            /* eslint-disable camelcase -- Templater's own API method names. */
            create_running_config: vi.fn().mockReturnValue({}),
            end_templater_task: vi.fn().mockResolvedValue(undefined),
            parse_template: vi.fn().mockRejectedValue('boom'),
            start_templater_task: vi.fn()
            /* eslint-enable camelcase -- Templater's own API method names. */
          }
        }
      });
      mockPrompt.mockResolvedValue('alpha');
      const { handler, showNotice } = createHandler({ shouldRunTemplaterOnDestinationFile: true });

      await handler.executeFolder(getFolder('parent'));

      const noticeTexts = showNotice.mock.calls.map((call) => {
        const content = call[0];
        return typeof content === 'string' ? content : content.textContent;
      });
      expect(noticeTexts.some((text) => text.includes('Templater failed on') && text.includes('boom'))).toBe(true);
    });
  });
});
