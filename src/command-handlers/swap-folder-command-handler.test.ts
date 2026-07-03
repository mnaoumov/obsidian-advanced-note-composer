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

// The modal is the plugin's OWN sibling UI module: stub only its resolved target folder so the swap
// Proceeds without opening a suggest modal. Everything else (vault, lock, transaction, swapper) is REAL.
import { selectTargetFolderForSwap } from '../modals/swap-folder-modal.ts';
import { SwapFolderCommandHandler } from './swap-folder-command-handler.ts';

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

// UI-rendering helpers used only by the ignored-path notice — stub their return so link rendering does
// Not reach into unmocked App internals. Not the behavior under test.
vi.mock('obsidian-dev-utils/html-element', () => ({
  createFragmentAsync: vi.fn().mockImplementation((cb: (f: DocumentFragment) => Promise<void>) => {
    const fragment = createFragment();
    return cb(fragment).then(() => fragment);
  })
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn().mockResolvedValue(createSpan())
}));

vi.mock('../modals/swap-folder-modal.ts', () => ({
  selectTargetFolderForSwap: vi.fn()
}));

const mockSelectTargetFolder = vi.mocked(selectTargetFolderForSwap);

let app: AppOriginal;
let resourceLockComponent: ResourceLockComponent;

afterEach(() => {
  resourceLockComponent.unload();
  vi.restoreAllMocks();
});

function createHandler(settingsOverrides?: Partial<PluginSettings>): HandlerContext {
  const showNotice = vi.fn().mockReturnValue({ hide: vi.fn() });
  const handler = new SwapFolderCommandHandler({
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

function initApp(files: Record<string, string> = {}): void {
  app = App.createConfigured__({ files }).asOriginalType__();
  // Test-mocks' Vault.getAvailablePath is under-modeled (it never checks existence); install a faithful
  // Existence-checking double so temp-path collisions resolve exactly as real Obsidian would.
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

describe('SwapFolderCommandHandler', () => {
  it('should expose its command identity', () => {
    initApp();
    const { handler } = createHandler();
    expect(handler.id).toBe('swap-folder');
    expect(handler.name).toBe('Swap folder with...');
    expect(handler.icon).toBe('switch-camera');
  });

  it('should refuse the vault root in canExecuteFolder', () => {
    initApp({ 'a.md': 'A' });
    const { handler } = createHandler();
    expect(handler.canExecuteFolder(app.vault.getRoot())).toBe(false);
  });

  it('should allow a non-root folder in canExecuteFolder', async () => {
    initApp();
    await app.vault.createFolder('some/folder');
    const { handler } = createHandler();
    expect(handler.canExecuteFolder(getFolder('some/folder'))).toBe(true);
  });

  it('should show a notice and not swap when the folder path is ignored', async () => {
    initApp({ 'src/note.md': 'note body' });
    const { handler, showNotice } = createHandler({ isPathIgnored: (path) => path === 'src' });

    await handler.executeFolder(getFolder('src'));

    expect(showNotice).toHaveBeenCalledOnce();
    expect(mockSelectTargetFolder).not.toHaveBeenCalled();
    // The source is untouched.
    expect(await app.vault.adapter.read('src/note.md')).toBe('note body');
  });

  it('should do nothing when no target folder is selected', async () => {
    initApp({ 'src/note.md': 'note body' });
    const { handler } = createHandler();
    mockSelectTargetFolder.mockResolvedValue(null);

    await handler.executeFolder(getFolder('src'));

    // Nothing moved; the source note is intact.
    expect(await app.vault.adapter.read('src/note.md')).toBe('note body');
  });

  it('should swap the contents of two same-named folders', async () => {
    initApp({
      'left/shared/a.md': 'LEFT',
      'right/shared/b.md': 'RIGHT'
    });
    const { handler } = createHandler();
    mockSelectTargetFolder.mockResolvedValue({
      shouldSwapEntireFolderStructure: true,
      targetFolder: getFolder('right/shared')
    });

    await handler.executeFolder(getFolder('left/shared'));

    // The two folders' children were exchanged.
    expect(await app.vault.adapter.read('left/shared/b.md')).toBe('RIGHT');
    expect(await app.vault.adapter.read('right/shared/a.md')).toBe('LEFT');
    expect(await app.vault.adapter.exists('left/shared/a.md')).toBe(false);
    expect(await app.vault.adapter.exists('right/shared/b.md')).toBe(false);
    // The scratch temp folder was cleaned up.
    expect(await app.vault.adapter.exists('__temp')).toBe(false);
  });

  it('should swap two differently-named empty folders', async () => {
    // Test-mocks does not cascade descendant paths on a folder rename, so a differently-named swap can
    // Only be exercised with empty folders (the rename branch of the swapper).
    initApp();
    // Each ancestor level must be created explicitly so test-mocks links `.parent` (the swapper reads
    // `folder.parent.path` to compute the swapped names).
    await app.vault.createFolder('p');
    await app.vault.createFolder('p/alpha');
    await app.vault.createFolder('q');
    await app.vault.createFolder('q/beta');
    const { handler } = createHandler();
    mockSelectTargetFolder.mockResolvedValue({
      shouldSwapEntireFolderStructure: true,
      targetFolder: getFolder('q/beta')
    });

    await handler.executeFolder(getFolder('p/alpha'));

    // The folders traded names within their own parents.
    expect(await app.vault.adapter.exists('p/beta')).toBe(true);
    expect(await app.vault.adapter.exists('q/alpha')).toBe(true);
    expect(await app.vault.adapter.exists('p/alpha')).toBe(false);
    expect(await app.vault.adapter.exists('q/beta')).toBe(false);
  });

  it('should swallow the cancellation and roll everything back when unlocked mid-swap', async () => {
    initApp({
      'left/shared/a.md': 'LEFT',
      'right/shared/b.md': 'RIGHT'
    });
    const source = getFolder('left/shared');
    const { handler } = createHandler();
    mockSelectTargetFolder.mockResolvedValue({
      shouldSwapEntireFolderStructure: true,
      targetFolder: getFolder('right/shared')
    });

    // Simulate the user clicking the lock indicator's Unlock mid-operation: the first rename aborts the
    // Folder-lock's controller and then fails, so the spanning transaction rolls back and the handler
    // Swallows the cancellation.
    const originalRenameFile = app.fileManager.renameFile.bind(app.fileManager);
    let hasAborted = false;
    vi.spyOn(app.fileManager, 'renameFile').mockImplementation(async (file, newPath) => {
      if (!hasAborted) {
        hasAborted = true;
        requestResourceUnlockForPath(app, source.path);
        throw new Error('Swap cancelled.');
      }
      await originalRenameFile(file, newPath);
    });

    await expect(handler.executeFolder(source)).resolves.toBeUndefined();

    // Rolled back: both folders' notes are intact and the scratch temp folder is gone.
    expect(await app.vault.adapter.read('left/shared/a.md')).toBe('LEFT');
    expect(await app.vault.adapter.read('right/shared/b.md')).toBe('RIGHT');
    expect(await app.vault.adapter.exists('__temp')).toBe(false);
  });

  it('should roll back and rethrow a non-abort error', async () => {
    initApp({
      'left/shared/a.md': 'LEFT',
      'right/shared/b.md': 'RIGHT'
    });
    const source = getFolder('left/shared');
    const { handler } = createHandler();
    mockSelectTargetFolder.mockResolvedValue({
      shouldSwapEntireFolderStructure: true,
      targetFolder: getFolder('right/shared')
    });

    const originalRenameFile = app.fileManager.renameFile.bind(app.fileManager);
    let hasThrown = false;
    vi.spyOn(app.fileManager, 'renameFile').mockImplementation(async (file, newPath) => {
      if (!hasThrown) {
        hasThrown = true;
        throw new Error('boom');
      }
      await originalRenameFile(file, newPath);
    });

    await expect(handler.executeFolder(source)).rejects.toThrow('boom');

    // The spanning transaction rolled back: both notes are intact and the temp folder is gone.
    expect(await app.vault.adapter.read('left/shared/a.md')).toBe('LEFT');
    expect(await app.vault.adapter.read('right/shared/b.md')).toBe('RIGHT');
    expect(await app.vault.adapter.exists('__temp')).toBe(false);
  });

  it('should fall back to the submenu setting for shouldAddCommandToSubmenu', () => {
    initApp();
    expect(createHandler({ shouldAddCommandsToSubmenu: true }).handler.shouldAddCommandToSubmenu()).toBe(true);
    expect(createHandler({ shouldAddCommandsToSubmenu: false }).handler.shouldAddCommandToSubmenu()).toBe(false);
  });

  it('should always add the command to the folder menu', async () => {
    initApp();
    await app.vault.createFolder('some/folder');
    const { handler } = createHandler();
    expect(handler.shouldAddToFolderMenu({ folder: getFolder('some/folder'), source: 'source' })).toBe(true);
  });
});
