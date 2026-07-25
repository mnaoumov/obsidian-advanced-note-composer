import type {
  App as AppOriginal,
  TFolder
} from 'obsidian';
import type { FolderCommandHandlerShouldAddToFolderMenuParams } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { GenericObject } from 'obsidian-dev-utils/type-guards';
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

import { FlattenFolderCommandHandler } from './flatten-folder-command-handler.ts';

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

// UI-rendering helpers used only by notices — stub their return so link rendering does not reach into
// Unmocked App internals. Not the behavior under test.
vi.mock('obsidian-dev-utils/html-element', () => ({
  createFragmentAsync: vi.fn().mockImplementation((cb: (f: DocumentFragment) => Promise<void>) => {
    const fragment = createFragment();
    return cb(fragment).then(() => fragment);
  })
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn().mockResolvedValue(createSpan())
}));

let app: AppOriginal;
let resourceLockComponent: ResourceLockComponent;

afterEach(() => {
  resourceLockComponent.unload();
  vi.restoreAllMocks();
});

function createHandler(settingsOverrides?: Partial<PluginSettings>): HandlerContext {
  const showNotice = vi.fn().mockReturnValue({ hide: vi.fn() });
  const handler = new FlattenFolderCommandHandler({
    app,
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        isPathIgnored: () => false,
        shouldAddCommandsToSubmenu: true,
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

function initApp(files: Record<string, string>): void {
  app = App.createConfigured__({ files }).asOriginalType__();
  castTo<GenericObject>(app.metadataCache)['computeMetadataAsync'] = vi.fn();
  resourceLockComponent = new ResourceLockComponent(app, 'test-plugin');
  resourceLockComponent.load();
}

describe('FlattenFolderCommandHandler', () => {
  it('should expose its command identity', () => {
    initApp({});
    const { handler } = createHandler();
    expect(handler.id).toBe('flatten-folder');
    expect(handler.name).toBe('Flatten folder...');
    expect(handler.icon).toBe('lucide-list-tree');
  });

  it('should refuse the vault root in canExecuteFolder', () => {
    initApp({ 'a/note.md': 'A' });
    const { handler } = createHandler();
    expect(handler.canExecuteFolder(app.vault.getRoot())).toBe(false);
  });

  it('should refuse an empty folder in canExecuteFolder', async () => {
    initApp({});
    await app.vault.createFolder('empty');
    const { handler } = createHandler();
    expect(handler.canExecuteFolder(getFolder('empty'))).toBe(false);
  });

  it('should allow a non-empty non-root folder in canExecuteFolder', () => {
    initApp({ 'parent/a/note.md': 'note' });
    const { handler } = createHandler();
    expect(handler.canExecuteFolder(getFolder('parent/a'))).toBe(true);
  });

  it('should show a notice and not move anything when the folder path is ignored', async () => {
    initApp({ 'parent/a/note.md': 'note body' });
    const { handler, showNotice } = createHandler({ isPathIgnored: (path) => path === 'parent/a' });

    await handler.executeFolder(getFolder('parent/a'));

    expect(showNotice).toHaveBeenCalledOnce();
    expect(await app.vault.adapter.read('parent/a/note.md')).toBe('note body');
  });

  it('should move direct children up to the parent, preserving subfolder structure', async () => {
    initApp({
      'parent/a/note.md': 'note body',
      'parent/a/pic.png': 'PIC',
      'parent/a/sub/deep.md': 'deep body'
    });
    const { handler } = createHandler();

    await handler.executeFolder(getFolder('parent/a'));

    // Direct children were promoted to the parent level.
    expect(await app.vault.adapter.read('parent/note.md')).toBe('note body');
    expect(await app.vault.adapter.exists('parent/pic.png')).toBe(true);
    // The subfolder was moved wholesale, keeping its internal structure.
    expect(await app.vault.adapter.read('parent/sub/deep.md')).toBe('deep body');
    // The children no longer live under the flattened folder.
    expect(await app.vault.adapter.exists('parent/a/note.md')).toBe(false);
    expect(await app.vault.adapter.exists('parent/a/sub/deep.md')).toBe(false);
  });

  it('should de-duplicate a name that collides with an existing sibling', async () => {
    initApp({
      'parent/a/note.md': 'inner body',
      'parent/note.md': 'existing body'
    });
    const { handler } = createHandler();

    await handler.executeFolder(getFolder('parent/a'));

    // The pre-existing sibling is untouched and the moved file landed on an available (deduped) path.
    expect(await app.vault.adapter.read('parent/note.md')).toBe('existing body');
    expect(await app.vault.adapter.exists('parent/a/note.md')).toBe(false);
  });

  it('should swallow the cancellation and roll everything back when unlocked mid-flatten', async () => {
    initApp({
      'parent/a/a.md': 'a body',
      'parent/a/b.md': 'b body'
    });
    const { handler } = createHandler();

    // Simulate the user clicking the lock indicator's Unlock mid-operation: the first rename aborts the
    // Folder-lock's controller, so the next iteration's abort check rolls the transaction back.
    const originalRename = app.fileManager.renameFile.bind(app.fileManager);
    let hasAborted = false;
    vi.spyOn(app.fileManager, 'renameFile').mockImplementation(async (file, newPath) => {
      if (!hasAborted) {
        hasAborted = true;
        requestResourceUnlockForPath(app, 'parent/a');
      }
      await originalRename(file, newPath);
    });

    await expect(handler.executeFolder(getFolder('parent/a'))).resolves.toBeUndefined();

    // Rolled back: both notes are intact under the source folder and nothing was promoted.
    expect(await app.vault.adapter.read('parent/a/a.md')).toBe('a body');
    expect(await app.vault.adapter.read('parent/a/b.md')).toBe('b body');
  });

  it('should roll back and rethrow a non-abort error', async () => {
    initApp({ 'parent/a/a.md': 'a body' });
    const { handler } = createHandler();

    vi.spyOn(app.fileManager, 'renameFile').mockRejectedValue(new Error('boom'));

    await expect(handler.executeFolder(getFolder('parent/a'))).rejects.toThrow('boom');

    // The transaction rolled back: the source note is intact.
    expect(await app.vault.adapter.read('parent/a/a.md')).toBe('a body');
  });

  it('should fall back to the submenu setting for shouldAddCommandToSubmenu', () => {
    initApp({});
    expect(createHandler({ shouldAddCommandsToSubmenu: true }).handler.shouldAddCommandToSubmenu()).toBe(true);
    expect(createHandler({ shouldAddCommandsToSubmenu: false }).handler.shouldAddCommandToSubmenu()).toBe(false);
  });

  it('should always add the command to the folder menu', () => {
    initApp({ 'parent/a/note.md': 'note' });
    const { handler } = createHandler();
    expect(handler.shouldAddToFolderMenu({ folder: getFolder('parent/a'), source: 'source' })).toBe(true);
  });
});
