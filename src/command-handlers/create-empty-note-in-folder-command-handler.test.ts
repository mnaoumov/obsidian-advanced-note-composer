import type {
  App,
  TFile,
  TFolder
} from 'obsidian';
import type { FolderCommandHandlerShouldAddToFolderMenuParams } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';
import type { MaybeReturn } from 'obsidian-dev-utils/type';

import { noopAsync } from 'obsidian-dev-utils/function';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { prompt } from 'obsidian-dev-utils/obsidian/modals/prompt';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';

import { applySplitTemplateToNotes } from '../apply-split-template.ts';
import { createNoteFromTypedName } from '../create-note.ts';
import { openFileAfterOperation } from '../open-after-operation.ts';
import { showOperationCompletionNotice } from '../operation-notices.ts';
import { recordRecentTarget } from '../recent-targets.ts';
import { placeCaretFromEnd } from '../reveal-inserted-content.ts';
import { CreateEmptyNoteInFolderCommandHandler } from './create-empty-note-in-folder-command-handler.ts';

interface TestableHandler {
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

// A FRESH element per call: `appendChild` MOVES a node rather than copying it.
vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn().mockImplementation(() => Promise.resolve(createSpan()))
}));

vi.mock('obsidian-dev-utils/obsidian/modals/prompt', () => ({
  prompt: vi.fn()
}));

vi.mock('../create-note.ts', () => ({
  createNoteFromTypedName: vi.fn()
}));

vi.mock('../open-after-operation.ts', () => ({
  openFileAfterOperation: vi.fn()
}));

vi.mock('../operation-notices.ts', () => ({
  buildOperationNoticeContent: vi.fn().mockImplementation(() => Promise.resolve(createFragment())),
  showOperationCompletionNotice: vi.fn()
}));

vi.mock('../recent-targets.ts', () => ({
  recordRecentTarget: vi.fn()
}));

vi.mock('../apply-split-template.ts', () => ({
  applySplitTemplateToNotes: vi.fn()
}));

// The caret placement polls a live Obsidian workspace for a `MarkdownView`, so a unit test would sit
// Through its whole give-up budget waiting for one that never appears.
vi.mock('../reveal-inserted-content.ts', () => ({
  placeCaretFromEnd: vi.fn()
}));

const mockPrompt = vi.mocked(prompt);
const mockCreateNoteFromTypedName = vi.mocked(createNoteFromTypedName);
const mockOpenFileAfterOperation = vi.mocked(openFileAfterOperation);
const mockShowOperationCompletionNotice = vi.mocked(showOperationCompletionNotice);
const mockRecordRecentTarget = vi.mocked(recordRecentTarget);
const mockApplySplitTemplateToNotes = vi.mocked(applySplitTemplateToNotes);
const mockPlaceCaretFromEnd = vi.mocked(placeCaretFromEnd);

interface HandlerContext {
  readonly app: App;
  readonly handler: TestableHandler;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

function createHandler(settingsOverrides: Partial<PluginSettings> = {}, activeFilePath: null | string = null): HandlerContext {
  const app = strictProxy<App>({
    fileManager: strictProxy({
      getNewFileParent: vi.fn().mockReturnValue(createMockFolder('Default'))
    }),
    workspace: strictProxy({
      getActiveFile: vi.fn().mockReturnValue(activeFilePath === null ? null : strictProxy<TFile>({ path: activeFilePath }))
    })
  });
  const pluginNoticeComponent = strictProxy<PluginNoticeComponent>({ showNotice: vi.fn().mockReturnValue({ hide: vi.fn() }) });
  const pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
    settings: strictProxy<PluginSettings>({
      isPathIgnored: vi.fn().mockReturnValue(false),
      nameTransformTemplate: '',
      reorderedFolderNameTemplate: '{{index}}. {{safeFolderName}}',
      replacement: '_',
      shouldAddCommandsToSubmenu: true,
      shouldBlockCommandOnPath: vi.fn().mockReturnValue(false),
      shouldReplaceInvalidTitleCharacters: true,
      splitTemplate: '',
      ...settingsOverrides
    })
  });
  const consoleDebugComponent = strictProxy<ConsoleDebugComponent>({ consoleDebug: vi.fn() });
  const resourceLockComponent = strictProxy<ResourceLockComponent>({});

  return {
    app,
    handler: castTo<TestableHandler>(
      new CreateEmptyNoteInFolderCommandHandler({
        app,
        consoleDebugComponent,
        pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent
      })
    ),
    pluginNoticeComponent,
    pluginSettingsComponent,
    resourceLockComponent
  };
}

function createMockFolder(path: string): TFolder {
  return strictProxy<TFolder>({
    getParentPrefix: (): string => `${path}/`,
    path
  });
}

describe('CreateEmptyNoteInFolderCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateNoteFromTypedName.mockResolvedValue(strictProxy<TFile>({ path: 'Parent/Ghost.md' }));
  });

  it('should expose its command identity', () => {
    const { handler } = createHandler();
    expect(handler.id).toBe('create-empty-note-in-folder');
    expect(handler.name).toBe('Create empty note in folder...');
    expect(handler.icon).toBe('lucide-file-plus');
  });

  it('should stay available from the palette with no active note', () => {
    const { handler } = createHandler();
    expect(handler.canExecute()).toBe(true);
  });

  it('should offer itself on the folder menu', () => {
    const { handler } = createHandler();
    expect(handler.shouldAddToFolderMenu(castTo<FolderCommandHandlerShouldAddToFolderMenuParams>({}))).toBe(true);
    expect(handler.shouldAddCommandToSubmenu()).toBe(true);
  });

  it('should refuse a blocked folder in canExecuteFolder', () => {
    const { handler } = createHandler({ shouldBlockCommandOnPath: (): boolean => true });
    expect(handler.canExecuteFolder(createMockFolder('Parent'))).toBe(false);
  });

  it('should allow an unblocked folder in canExecuteFolder', () => {
    const { handler } = createHandler();
    expect(handler.canExecuteFolder(createMockFolder('Parent'))).toBe(true);
  });

  it('should resolve the palette destination through the new-file parent setting', async () => {
    const { app, handler } = createHandler({}, 'notes/open.md');
    mockPrompt.mockResolvedValue('Ghost');

    await handler.execute();

    expect(vi.mocked(app.fileManager.getNewFileParent)).toHaveBeenCalledWith('notes/open.md');
    expect(mockCreateNoteFromTypedName).toHaveBeenCalledOnce();
  });

  it('should pass an empty path to the new-file parent resolution when nothing is open', async () => {
    const { app, handler } = createHandler();
    mockPrompt.mockResolvedValue(null);

    await handler.execute();

    expect(vi.mocked(app.fileManager.getNewFileParent)).toHaveBeenCalledWith('');
  });

  it('should show a notice and create nothing when the folder is ignored', async () => {
    const { handler, pluginNoticeComponent } = createHandler({ isPathIgnored: (): boolean => true });

    await handler.executeFolder(createMockFolder('Parent'));

    expect(pluginNoticeComponent.showNotice).toHaveBeenCalled();
    expect(mockPrompt).not.toHaveBeenCalled();
    expect(mockCreateNoteFromTypedName).not.toHaveBeenCalled();
  });

  it('should create nothing when the prompt is cancelled', async () => {
    const { handler } = createHandler();
    mockPrompt.mockResolvedValue(null);

    await handler.executeFolder(createMockFolder('Parent'));

    expect(mockCreateNoteFromTypedName).not.toHaveBeenCalled();
  });

  it('should create the note in the right-clicked folder, open it and report it', async () => {
    const { app, handler, pluginSettingsComponent } = createHandler();
    const parentFolder = createMockFolder('Parent');
    const createdFile = strictProxy<TFile>({ path: 'Parent/Ghost.md' });
    mockPrompt.mockResolvedValue('Ghost');
    mockCreateNoteFromTypedName.mockResolvedValue(createdFile);

    await handler.executeFolder(parentFolder);

    expect(mockCreateNoteFromTypedName).toHaveBeenCalledWith({
      app,
      contextFile: null,
      fileName: 'Ghost',
      folderPrefix: '/Parent/',
      pluginSettingsComponent,
      // The explorer flow never wraps the note in a folder of its own — that is `Create folder with
      // Notes...`'s job — and a typed `/` is a character rather than a path to descend into.
      relocateNote: null,
      shouldTreatTitleAsPath: false,
      sourcePath: ''
    });
    expect(mockOpenFileAfterOperation).toHaveBeenCalledWith({ app, file: createdFile });
    expect(mockRecordRecentTarget).toHaveBeenCalledWith(parentFolder);
    expect(mockShowOperationCompletionNotice).toHaveBeenCalledOnce();
  });

  // Issue #244's follow-up: a configured `Split template` fills the created note, and its `{{content}}`
  // Marks where the caret goes once the note opens.
  describe('the split template', () => {
    const TEMPLATE = '# {{newTitle}}\n\n{{content}}\n\nfrom [[{{fromTitle}}]]';

    function createTemplatedFile(): TFile {
      return strictProxy<TFile>({
        basename: 'Ghost',
        parent: strictProxy<TFolder>({ name: 'Parent', path: 'Parent' }),
        path: 'Parent/Ghost.md'
      });
    }

    it('should leave the note empty when no template is configured', async () => {
      const { handler } = createHandler();
      mockPrompt.mockResolvedValue('Ghost');
      mockCreateNoteFromTypedName.mockResolvedValue(createTemplatedFile());

      await handler.executeFolder(createMockFolder('Parent'));

      expect(mockApplySplitTemplateToNotes).not.toHaveBeenCalled();
      expect(mockPlaceCaretFromEnd).not.toHaveBeenCalled();
    });

    it('should apply the configured template to the created note', async () => {
      const { app, handler, resourceLockComponent } = createHandler({ splitTemplate: TEMPLATE });
      const createdFile = createTemplatedFile();
      mockPrompt.mockResolvedValue('Ghost');
      mockCreateNoteFromTypedName.mockResolvedValue(createdFile);

      await handler.executeFolder(createMockFolder('Parent'));

      expect(mockApplySplitTemplateToNotes).toHaveBeenCalledWith({
        app,
        folderNameTemplate: '{{index}}. {{safeFolderName}}',
        // Created out of nothing, so there is no note it came from.
        notes: [{ file: createdFile, sourceFile: null }],
        resourceLockComponent,
        template: TEMPLATE
      });
    });

    it('should put the caret where the template placed the content token', async () => {
      const { app, handler } = createHandler({ splitTemplate: TEMPLATE });
      const createdFile = createTemplatedFile();
      mockPrompt.mockResolvedValue('Ghost');
      mockCreateNoteFromTypedName.mockResolvedValue(createdFile);

      await handler.executeFolder(createMockFolder('Parent'));

      // The `from` half resolves empty — there is no source note — and the tail is what the note now ends
      // With, so the caret sits immediately before it. Read off `lastCall` rather than matched with
      // `objectContaining`, which serializes the strict-proxy `app`/`file` and throws on their unmocked
      // Properties.
      const caretParams = ensureNonNullable(mockPlaceCaretFromEnd.mock.lastCall)[0];
      expect(caretParams.tail).toBe('\n\nfrom [[]]');
      expect(caretParams.file).toBe(createdFile);
      expect(caretParams.app).toBe(app);
    });

    it('should template the note before opening it', async () => {
      const { handler } = createHandler({ splitTemplate: TEMPLATE });
      const order: string[] = [];
      mockPrompt.mockResolvedValue('Ghost');
      mockCreateNoteFromTypedName.mockResolvedValue(createTemplatedFile());
      mockApplySplitTemplateToNotes.mockImplementation(async () => {
        order.push('template');
        await noopAsync();
      });
      mockOpenFileAfterOperation.mockImplementation(async () => {
        order.push('open');
        await noopAsync();
      });

      await handler.executeFolder(createMockFolder('Parent'));

      expect(order).toEqual(['template', 'open']);
    });
  });

  describe('the name prompt validator', () => {
    /**
     * Drives the validator the way the prompt does — through the callback the handler actually registered,
     * rather than by reaching for the private method, so the wiring is covered along with the rules.
     *
     * @param value - The typed name.
     * @param settingsOverrides - The settings the rules read.
     * @returns The error message, or nothing when the name is usable.
     */
    async function validate(value: string, settingsOverrides: Partial<PluginSettings> = {}): Promise<MaybeReturn<string>> {
      const { handler } = createHandler(settingsOverrides);
      mockPrompt.mockResolvedValue(null);
      await handler.executeFolder(createMockFolder('Parent'));
      const promptParams = ensureNonNullable(mockPrompt.mock.lastCall)[0];
      return await ensureNonNullable(promptParams.valueValidator)(value);
    }

    it('should refuse a blank name rather than letting it become Untitled', async () => {
      const BLANK_NAME_LENGTH = 3;
      expect(await validate(' '.repeat(BLANK_NAME_LENGTH))).toBe('Note name cannot be empty');
    });

    it('should accept a usable name', async () => {
      expect(await validate('Ghost note')).toBeUndefined();
    });

    it('should accept a name whose invalid characters are replaced', async () => {
      expect(await validate('a:b')).toBeUndefined();
    });

    it('should refuse invalid characters when the setting leaves them in place', async () => {
      expect(await validate('a:b', { shouldReplaceInvalidTitleCharacters: false })).toBe('Note name contains invalid characters');
    });

    it('should refuse a name that sanitizes down to nothing', async () => {
      // Every character is invalid and `replacement` is empty, so nothing survives the pass.
      expect(await validate('::', { replacement: '' })).toBe('Note name cannot be empty');
    });

    it('should report a refused name transform where it can be fixed', async () => {
      expect(await validate('Ghost', { nameTransformTemplate: '{{unknownToken}}' })).toEqual(expect.stringContaining('unknownToken'));
    });
  });
});
