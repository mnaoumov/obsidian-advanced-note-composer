import type {
  App as AppOriginal,
  TFolder
} from 'obsidian';
import type { FolderCommandHandlerShouldAddToFolderMenuParams } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import type {
  PluginNoticeComponent,
  PluginNoticeComponentShowNoticeAfterDelayParams
} from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { PromptParams } from 'obsidian-dev-utils/obsidian/modals/prompt';
import type { MockInstance } from 'vitest';

import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { noopAsync } from 'obsidian-dev-utils/function';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { FolderNoteLocation } from 'obsidian-dev-utils/obsidian/folder-note';
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

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';
import type { RenameFolderCommandHandlerConstructorParams } from './rename-folder-command-handler.ts';

import { RenameFolderCommandHandler } from './rename-folder-command-handler.ts';

interface HandlerContext {
  handler: Testable;
  showNotice: MockInstance<PluginNoticeComponent['showNotice']>;
}

interface Testable {
  canExecuteFolder(folder: TFolder): boolean;
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

// The prompt is v8-ignored UI; capture its params so the seeded value can be asserted, and answer it with
// Whatever the test says the user typed. The REAL validator still runs, through `validateTypedName`.
vi.mock('obsidian-dev-utils/obsidian/modals/prompt', () => ({
  prompt: vi.fn().mockImplementation((params: PromptParams) => {
    promptParams = params;
    return Promise.resolve(typedName);
  })
}));

const mockPrompt = vi.mocked(prompt);

let app: AppOriginal;
let promptParams: null | PromptParams = null;
let resourceLockComponent: ResourceLockComponent;
let typedName: null | string = null;

afterEach(() => {
  resourceLockComponent.unload();

  promptParams = null;
  typedName = null;
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('RenameFolderCommandHandler', () => {
  it('should expose its command identity', () => {
    initApp();
    const { handler } = createHandler();
    expect(handler.id).toBe('rename-folder');
    expect(handler.name).toBe('Rename folder...');
    expect(handler.icon).toBe('lucide-pencil');
  });

  it('should offer itself in the folder menu and follow the submenu setting', () => {
    initApp();
    const { handler } = createHandler();
    expect(handler.shouldAddToFolderMenu(castTo<FolderCommandHandlerShouldAddToFolderMenuParams>({}))).toBe(true);
    expect(handler.shouldAddCommandToSubmenu()).toBe(true);
  });

  it('should be available on an ordinary folder', () => {
    initApp({ 'parent/Alpha/note.md': 'a' });
    const { handler } = createHandler();
    expect(handler.canExecuteFolder(getFolder('parent/Alpha'))).toBe(true);
  });

  it('should refuse the vault root, which has no name of its own', () => {
    initApp({ 'Alpha/note.md': 'a' });
    const { handler } = createHandler();
    expect(handler.canExecuteFolder(app.vault.getRoot())).toBe(false);
  });

  it('should be unavailable when the command is blocked on the path', () => {
    initApp({ 'parent/Alpha/note.md': 'a' });
    const { handler } = createHandler({ shouldBlockCommandOnPath: () => true });
    expect(handler.canExecuteFolder(getFolder('parent/Alpha'))).toBe(false);
  });

  it('should refuse an ignored folder with a notice, without ever asking for a name', async () => {
    initApp({ 'parent/Alpha/note.md': 'a' });
    const { handler, showNotice } = createHandler({ isPathIgnored: () => true });

    await handler.executeFolder(getFolder('parent/Alpha'));

    expect(showNotice).toHaveBeenCalledOnce();
    expect(mockPrompt).not.toHaveBeenCalled();
  });

  it('should leave everything alone when the prompt is cancelled', async () => {
    initApp({ 'parent/Alpha/note.md': 'a' });
    const { handler, showNotice } = createHandler();
    typedName = null;

    await handler.executeFolder(getFolder('parent/Alpha'));

    expect(getChildFolderNames('parent')).toEqual(['Alpha']);
    expect(showNotice).not.toHaveBeenCalled();
  });

  it('should do nothing when the typed name is the one the folder already has', async () => {
    initApp({ 'parent/Alpha/note.md': 'a' });
    const { handler, showNotice } = createHandler();
    typedName = 'Alpha';

    await handler.executeFolder(getFolder('parent/Alpha'));

    expect(getChildFolderNames('parent')).toEqual(['Alpha']);
    expect(showNotice).not.toHaveBeenCalled();
  });

  it('should rename an unnumbered folder to exactly what was typed', async () => {
    initApp({ 'parent/Alpha/note.md': 'a' });
    const { handler } = createHandler();
    typedName = 'Beta';

    await handler.executeFolder(getFolder('parent/Alpha'));

    expect(getChildFolderNames('parent')).toEqual(['Beta']);
    expect(await readNote('parent/Beta/note.md')).toBe('a');
  });

  it('should seed the prompt with the name WITHOUT its index, and keep the index on the way back', async () => {
    initApp({ 'parent/1. Alpha/1. Alpha.md': '---\ntitle: 1. Alpha\naliases:\n  - Alpha\n---\n\nbody\n' });
    const { handler } = createHandler();
    typedName = 'Beta';

    await handler.executeFolder(getFolder('parent/1. Alpha'));

    expect(ensureNonNullable(promptParams).defaultValue).toBe('Alpha');
    expect(getChildFolderNames('parent')).toEqual(['1. Beta']);
    const note = await readNote('parent/1. Beta/1. Beta.md');
    expect(note).toContain('title: 1. Beta');
    expect(note).toContain('- Beta');
    expect(note).toContain('body');
  });

  it('should keep the aliases it did not derive, and swap only the one the old name rendered', async () => {
    initApp({ 'parent/1. Alpha/1. Alpha.md': '---\naliases:\n  - first\n  - Alpha\n  - last\n---\n' });
    const { handler } = createHandler();
    typedName = 'Beta';

    await handler.executeFolder(getFolder('parent/1. Alpha'));

    expect(await readFrontmatterAliases('parent/1. Beta/1. Beta.md')).toEqual(['first', 'Beta', 'last']);
  });

  it('should give the alias to a folder note that had none', async () => {
    initApp({ 'parent/Alpha/Alpha.md': '---\ntitle: Alpha\n---\n' });
    const { handler } = createHandler();
    typedName = 'Beta';

    await handler.executeFolder(getFolder('parent/Alpha'));

    expect(await readFrontmatterAliases('parent/Beta/Beta.md')).toEqual(['Beta']);
  });

  it('should leave the aliases alone when their template is empty', async () => {
    initApp({ 'parent/Alpha/Alpha.md': '---\ntitle: Alpha\naliases:\n  - Alpha\n---\n' });
    const { handler } = createHandler({ folderNoteAliasesTemplate: '' });
    typedName = 'Beta';

    await handler.executeFolder(getFolder('parent/Alpha'));

    const note = await readNote('parent/Beta/Beta.md');
    expect(note).toContain('title: Beta');
    expect(note).toContain('- Alpha');
  });

  it('should leave the title alone when its template is empty', async () => {
    initApp({ 'parent/Alpha/Alpha.md': '---\ntitle: Alpha\naliases:\n  - Alpha\n---\n' });
    const { handler } = createHandler({ folderNoteTitleTemplate: '' });
    typedName = 'Beta';

    await handler.executeFolder(getFolder('parent/Alpha'));

    const note = await readNote('parent/Beta/Beta.md');
    expect(note).toContain('title: Alpha');
    expect(await readFrontmatterAliases('parent/Beta/Beta.md')).toEqual(['Beta']);
  });

  it('should not touch the note at all when both property templates are empty', async () => {
    const originalContent = '---\ntitle: Alpha\naliases:\n  - Alpha\n---\n\nbody\n';
    initApp({ 'parent/Alpha/Alpha.md': originalContent });
    const { handler } = createHandler({ folderNoteAliasesTemplate: '', folderNoteTitleTemplate: '' });
    typedName = 'Beta';

    await handler.executeFolder(getFolder('parent/Alpha'));

    // Renamed with its folder, but its content is byte-for-byte what it was.
    expect(await readNote('parent/Beta/Beta.md')).toBe(originalContent);
  });

  it('should write nothing when the vault has no folder notes', async () => {
    initApp({ 'parent/Alpha/Alpha.md': '---\ntitle: Alpha\n---\n' });
    const { handler } = createHandler({ folderNoteLocation: FolderNoteLocation.None });
    typedName = 'Beta';

    await handler.executeFolder(getFolder('parent/Alpha'));

    // Moved with its folder and NOT renamed: without folder notes there is no folder note to keep in step.
    expect(await readNote('parent/Beta/Alpha.md')).toContain('title: Alpha');
  });

  it('should leave a fixed-name folder note where it is, only rewriting its properties', async () => {
    initApp({ 'parent/Alpha/!.md': '---\ntitle: Alpha\naliases:\n  - Alpha\n---\n' });
    const { handler } = createHandler({ folderNoteNameTemplate: '!' });
    typedName = 'Beta';

    await handler.executeFolder(getFolder('parent/Alpha'));

    // `!` does not depend on the folder name, so the note moved with its folder and needed no rename.
    const note = await readNote('parent/Beta/!.md');
    expect(note).toContain('title: Beta');
    expect(note).toContain('- Beta');
  });

  it('should rename a folder note that sits BESIDE its folder', async () => {
    initApp({
      'parent/Alpha.md': '---\ntitle: Alpha\naliases:\n  - Alpha\n---\n',
      'parent/Alpha/inner.md': 'a'
    });
    const { handler } = createHandler({ folderNoteLocation: FolderNoteLocation.ParentFolder });
    typedName = 'Beta';

    await handler.executeFolder(getFolder('parent/Alpha'));

    const note = await readNote('parent/Beta.md');
    expect(note).toContain('title: Beta');
    expect(note).toContain('- Beta');
  });

  it('should describe the folder it actually created when the wanted name is taken', async () => {
    initApp({
      'parent/Alpha/Alpha.md': '---\ntitle: Alpha\n---\n',
      'parent/Beta/note.md': 'b'
    });
    const { handler } = createHandler();
    typedName = 'Beta';

    await handler.executeFolder(getFolder('parent/Alpha'));

    expect(getChildFolderNames('parent')).toEqual(['Beta', 'Beta 1']);
    // The de-duplicated name is what the properties describe, not the name that was asked for.
    expect(await readNote('parent/Beta 1/Beta 1.md')).toContain('title: Beta 1');
  });

  it('should not re-case a name the user never retyped', async () => {
    initApp({ 'parent/iOS notes/note.md': 'a' });
    const { handler } = createHandler({ shouldTitleCaseCreatedFolderName: true });
    typedName = 'iOS stuff';

    await handler.executeFolder(getFolder('parent/iOS notes'));

    expect(getChildFolderNames('parent')).toEqual(['iOS stuff']);
  });

  it('should refuse a name that normalizes to nothing, through the prompt\'s own validator', async () => {
    initApp({ 'parent/Alpha/note.md': 'a' });
    const { handler } = createHandler();
    typedName = 'Beta';

    await handler.executeFolder(getFolder('parent/Alpha'));

    const validate = ensureNonNullable(ensureNonNullable(promptParams).valueValidator);
    expect(await validate(' '.repeat(3))).toBe('Folder name cannot be empty');
    expect(await validate('a/b')).toBe('Folder name contains invalid characters');
    expect(await validate('Gamma')).toBeUndefined();
  });

  it('should swallow the cancellation and roll everything back when unlocked mid-rename', async () => {
    initApp({ 'parent/Alpha/note.md': 'note body' });
    const folder = getFolder('parent/Alpha');
    const { handler } = createHandler();
    typedName = 'Beta';

    let hasAborted = false;
    vi.spyOn(app.fileManager, 'renameFile').mockImplementation(() => {
      if (hasAborted) {
        return noopAsync();
      }

      hasAborted = true;
      // Unlocking mid-flight is what a user's Cancel does: it aborts the operation holding the lock.
      requestResourceUnlockForPath(app, folder.path);
      return Promise.reject(new Error('Rename cancelled.'));
    });

    await expect(handler.executeFolder(folder)).resolves.toBeUndefined();

    expect(getChildFolderNames('parent')).toEqual(['Alpha']);
    expect(await app.vault.adapter.read('parent/Alpha/note.md')).toBe('note body');
  });

  it('should roll back and rethrow an error that is not a cancellation', async () => {
    initApp({ 'parent/Alpha/note.md': 'note body' });
    const { handler } = createHandler();
    typedName = 'Beta';
    vi.spyOn(app.fileManager, 'renameFile').mockRejectedValue(new Error('Disk on fire.'));

    await expect(handler.executeFolder(getFolder('parent/Alpha'))).rejects.toThrow('Disk on fire.');
    expect(getChildFolderNames('parent')).toEqual(['Alpha']);
  });

  it('should report the rename once it has landed', async () => {
    initApp({ 'parent/Alpha/note.md': 'a' });
    const { handler, showNotice } = createHandler();
    typedName = 'Beta';

    await handler.executeFolder(getFolder('parent/Alpha'));

    expect(showNotice).toHaveBeenCalledOnce();
  });
});

function createHandler(settingsOverrides?: Partial<PluginSettings>): HandlerContext {
  const showNotice = vi.fn().mockReturnValue({ hide: vi.fn() });
  const handler = new RenameFolderCommandHandler(createHandlerParams(castTo<PluginNoticeComponent['showNotice']>(showNotice), settingsOverrides));
  return {
    handler: castTo<Testable>(handler),
    showNotice: castTo<MockInstance<PluginNoticeComponent['showNotice']>>(showNotice)
  };
}

function createHandlerParams(
  showNotice: PluginNoticeComponent['showNotice'],
  settingsOverrides?: Partial<PluginSettings>
): RenameFolderCommandHandlerConstructorParams {
  return {
    app,
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice, showNoticeAfterDelay: createShowNoticeAfterDelayStub() }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        folderNoteAliasesTemplate: '{{safeFolderName}}',
        folderNoteLocation: FolderNoteLocation.InsideFolder,
        folderNoteNameTemplate: '{{folderName}}',
        folderNoteTitleTemplate: '{{folderName}}',
        isPathIgnored: () => false,
        nameTransformTemplate: '',
        reorderedFolderNameTemplate: '{{index}}. {{safeFolderName}}',
        replacement: '_',
        shouldAddCommandsToSubmenu: true,
        shouldBlockCommandOnPath: () => false,
        shouldReplaceInvalidTitleCharacters: false,
        shouldShowOperationNotices: true,
        ...settingsOverrides
      })
    }),
    resourceLockComponent
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

function getChildFolderNames(path: string): string[] {
  return getFolder(path).children.filter((child) => !('extension' in child)).map((child) => child.name).sort();
}

function getFolder(path: string): TFolder {
  return ensureNonNullable(app.vault.getFolderByPath(path));
}

function initApp(files: Record<string, string> = {}): void {
  app = App.createConfigured__({ files }).asOriginalType__();
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

const ALIAS_LINE_REG_EXP = /^\s+- (?<Alias>.*)$/;

async function readFrontmatterAliases(path: string): Promise<string[]> {
  const content = await readNote(path);
  return content
    .split('\n')
    .map((line) => ALIAS_LINE_REG_EXP.exec(line)?.groups?.['Alias'])
    .filter((alias): alias is string => alias !== undefined);
}

async function readNote(path: string): Promise<string> {
  return await app.vault.read(ensureNonNullable(app.vault.getFileByPath(path)));
}
