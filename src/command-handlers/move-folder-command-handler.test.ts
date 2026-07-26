import type {
  App as AppOriginal,
  TFolder
} from 'obsidian';
import type { FolderCommandHandlerShouldAddToFolderMenuParams } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { MockInstance } from 'vitest';

import { castTo } from 'obsidian-dev-utils/object-utils';
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

// The modal is the plugin's OWN sibling UI module: stub only its resolved target folder so the move
// Proceeds without opening a suggest modal. Everything else (vault, lock, transaction) is REAL.
import { selectTargetFolderForMove } from '../modals/move-folder-modal.ts';
import { MoveFolderCommandHandler } from './move-folder-command-handler.ts';

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
  createFragmentAsync: vi.fn().mockImplementation((cb: (f: DocumentFragment) => Promise<void>) => {
    const fragment = createFragment();
    return cb(fragment).then(() => fragment);
  })
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn().mockResolvedValue(createSpan())
}));

vi.mock('../modals/move-folder-modal.ts', () => ({
  selectTargetFolderForMove: vi.fn()
}));

const mockSelectTargetFolder = vi.mocked(selectTargetFolderForMove);

let app: AppOriginal;
let resourceLockComponent: ResourceLockComponent;

afterEach(() => {
  resourceLockComponent.unload();
  vi.restoreAllMocks();
});

function createHandler(settingsOverrides?: Partial<PluginSettings>): HandlerContext {
  const showNotice = vi.fn().mockReturnValue({ hide: vi.fn() });
  const handler = new MoveFolderCommandHandler({
    app,
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        isPathIgnored: () => false,
        shouldAddCommandsToSubmenu: true,
        shouldBlockCommandOnPath: () => false,
        ...settingsOverrides
      })
    }),
    resourceLockComponent
  });
  return {
    handler: castTo<Testable>(handler),
    showNotice: castTo<MockInstance<PluginNoticeComponent['showNotice']>>(showNotice)
  };
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

describe('MoveFolderCommandHandler', () => {
  it('should expose its command identity', () => {
    initApp();
    const { handler } = createHandler();
    expect(handler.id).toBe('move-folder');
    expect(handler.name).toBe('Move folder to...');
    expect(handler.icon).toBe('lucide-folder-input');
  });

  it('should refuse the vault root in canExecuteFolder', () => {
    initApp({ 'a/note.md': 'A' });
    const { handler } = createHandler();
    expect(handler.canExecuteFolder(app.vault.getRoot())).toBe(false);
  });

  it('should allow a non-root folder in canExecuteFolder', () => {
    initApp({ 'parent/a/note.md': 'note' });
    const { handler } = createHandler();
    expect(handler.canExecuteFolder(getFolder('parent/a'))).toBe(true);
  });

  it('should block a non-root folder in canExecuteFolder when the command is blocked on its path', () => {
    initApp({ 'parent/a/note.md': 'note' });
    const { handler } = createHandler({ shouldBlockCommandOnPath: () => true });
    expect(handler.canExecuteFolder(getFolder('parent/a'))).toBe(false);
  });

  it('should show a notice and not move when the folder path is ignored', async () => {
    initApp({ 'parent/a/note.md': 'note body' });
    const { handler, showNotice } = createHandler({ isPathIgnored: (path) => path === 'parent/a' });

    await handler.executeFolder(getFolder('parent/a'));

    expect(showNotice).toHaveBeenCalledOnce();
    expect(mockSelectTargetFolder).not.toHaveBeenCalled();
    expect(await app.vault.adapter.read('parent/a/note.md')).toBe('note body');
  });

  it('should do nothing when no target folder is selected', async () => {
    initApp({ 'parent/a/note.md': 'note body' });
    const { handler } = createHandler();
    mockSelectTargetFolder.mockResolvedValue(null);

    await handler.executeFolder(getFolder('parent/a'));

    expect(await app.vault.adapter.read('parent/a/note.md')).toBe('note body');
  });

  it('should move the folder into the chosen target, preserving its structure', async () => {
    initApp({
      'dst/keep.md': 'keep',
      'parent/a/note.md': 'note body',
      'parent/a/sub/deep.md': 'deep body'
    });
    const { handler } = createHandler();
    mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

    await handler.executeFolder(getFolder('parent/a'));

    // The folder now lives under the target, keeping its internal structure.
    expect(await app.vault.adapter.read('dst/a/note.md')).toBe('note body');
    expect(await app.vault.adapter.read('dst/a/sub/deep.md')).toBe('deep body');
    // The source location is emptied out.
    expect(await app.vault.adapter.exists('parent/a/note.md')).toBe(false);
    // The pre-existing target file is untouched.
    expect(await app.vault.adapter.read('dst/keep.md')).toBe('keep');
  });

  it('should de-duplicate when the target already has a folder with the same name', async () => {
    initApp({
      'dst/a/existing.md': 'existing',
      'parent/a/note.md': 'note body'
    });
    const { handler } = createHandler();
    mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

    await handler.executeFolder(getFolder('parent/a'));

    // The colliding target folder is preserved and the moved folder took an available (deduped) path.
    expect(await app.vault.adapter.read('dst/a/existing.md')).toBe('existing');
    expect(await app.vault.adapter.read('dst/a 1/note.md')).toBe('note body');
    expect(await app.vault.adapter.exists('parent/a/note.md')).toBe(false);
  });

  it('should swallow the cancellation and roll everything back when unlocked mid-move', async () => {
    initApp({ 'parent/a/note.md': 'note body' });
    await app.vault.createFolder('dst');
    const source = getFolder('parent/a');
    const { handler } = createHandler();
    mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

    const originalRenameFile = app.fileManager.renameFile.bind(app.fileManager);
    let hasAborted = false;
    vi.spyOn(app.fileManager, 'renameFile').mockImplementation(async (file, newPath) => {
      if (!hasAborted) {
        hasAborted = true;
        requestResourceUnlockForPath(app, source.path);
        throw new Error('Move cancelled.');
      }
      await originalRenameFile(file, newPath);
    });

    await expect(handler.executeFolder(source)).resolves.toBeUndefined();

    // Rolled back: the source note is intact and nothing landed under the target.
    expect(await app.vault.adapter.read('parent/a/note.md')).toBe('note body');
    expect(await app.vault.adapter.exists('dst/a/note.md')).toBe(false);
  });

  it('should roll back and rethrow a non-abort error', async () => {
    initApp({ 'parent/a/note.md': 'note body' });
    await app.vault.createFolder('dst');
    const { handler } = createHandler();
    mockSelectTargetFolder.mockResolvedValue(getFolder('dst'));

    vi.spyOn(app.fileManager, 'renameFile').mockRejectedValue(new Error('boom'));

    await expect(handler.executeFolder(getFolder('parent/a'))).rejects.toThrow('boom');

    expect(await app.vault.adapter.read('parent/a/note.md')).toBe('note body');
  });

  it('should fall back to the submenu setting for shouldAddCommandToSubmenu', () => {
    initApp();
    expect(createHandler({ shouldAddCommandsToSubmenu: true }).handler.shouldAddCommandToSubmenu()).toBe(true);
    expect(createHandler({ shouldAddCommandsToSubmenu: false }).handler.shouldAddCommandToSubmenu()).toBe(false);
  });

  it('should always add the command to the folder menu', () => {
    initApp({ 'parent/a/note.md': 'note' });
    const { handler } = createHandler();
    expect(handler.shouldAddToFolderMenu({ folder: getFolder('parent/a'), source: 'source' })).toBe(true);
  });
});
