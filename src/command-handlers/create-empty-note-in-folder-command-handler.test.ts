import type {
  App,
  TFile,
  TFolder
} from 'obsidian';
import type { FolderCommandHandlerShouldAddToFolderMenuParams } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { MaybeReturn } from 'obsidian-dev-utils/type';

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

import { createNoteFromTypedName } from '../create-note.ts';
import { openFileAfterOperation } from '../open-after-operation.ts';
import { showOperationCompletionNotice } from '../operation-notices.ts';
import { recordRecentTarget } from '../recent-targets.ts';
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

const mockPrompt = vi.mocked(prompt);
const mockCreateNoteFromTypedName = vi.mocked(createNoteFromTypedName);
const mockOpenFileAfterOperation = vi.mocked(openFileAfterOperation);
const mockShowOperationCompletionNotice = vi.mocked(showOperationCompletionNotice);
const mockRecordRecentTarget = vi.mocked(recordRecentTarget);

interface HandlerContext {
  readonly app: App;
  readonly handler: TestableHandler;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
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
      replacement: '_',
      shouldAddCommandsToSubmenu: true,
      shouldBlockCommandOnPath: vi.fn().mockReturnValue(false),
      shouldReplaceInvalidTitleCharacters: true,
      ...settingsOverrides
    })
  });

  return {
    app,
    handler: castTo<TestableHandler>(new CreateEmptyNoteInFolderCommandHandler({ app, pluginNoticeComponent, pluginSettingsComponent })),
    pluginNoticeComponent,
    pluginSettingsComponent
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
