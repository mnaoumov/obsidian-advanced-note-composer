import type {
  App as AppOriginal,
  TFile
} from 'obsidian';
import type { FileCommandHandlerShouldAddToFileMenuParams } from 'obsidian-dev-utils/obsidian/command-handlers/file-command-handler';
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

// The modal is the plugin's OWN sibling UI module: stub only its resolved target file so the swap
// Proceeds without opening a suggest modal. Everything else (vault, lock, transaction, swap) is REAL.
import { selectFileForSwap } from '../modals/swap-file-modal.ts';
import { SwapFileCommandHandler } from './swap-file-command-handler.ts';

interface HandlerContext {
  handler: Testable;
  hide: MockInstance;
  showNotice: MockInstance<PluginNoticeComponent['showNotice']>;
}

interface Testable {
  executeFile(file: TFile): Promise<void>;
  readonly icon: string;
  readonly id: string;
  readonly name: string;
  shouldAddCommandToSubmenu(): boolean;
  shouldAddToFileMenu(params: FileCommandHandlerShouldAddToFileMenuParams): boolean;
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

vi.mock('../modals/swap-file-modal.ts', () => ({
  selectFileForSwap: vi.fn()
}));

const mockSelectFileForSwap = vi.mocked(selectFileForSwap);

let app: AppOriginal;
let resourceLockComponent: ResourceLockComponent;

afterEach(() => {
  resourceLockComponent.unload();
  vi.restoreAllMocks();
});

function createHandler(settingsOverrides?: Partial<PluginSettings>): HandlerContext {
  const hide = vi.fn();
  const showNotice = vi.fn().mockReturnValue({ hide });
  const handler = new SwapFileCommandHandler({
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
    hide,
    showNotice: castTo<MockInstance<PluginNoticeComponent['showNotice']>>(showNotice)
  };
}

function getFile(path: string): TFile {
  return ensureNonNullable(app.vault.getFileByPath(path));
}

function initApp(files: Record<string, string>): void {
  app = App.createConfigured__({ files }).asOriginalType__();
  // Test-mocks' Vault.getAvailablePath echoes the input with no de-duplication, but the two-file swap's
  // Temp-path shuffle needs a genuinely free path. Provide a faithful existence-checking stub (an
  // Obsidian-API double, not a source workaround).
  vi.spyOn(app.vault, 'getAvailablePath').mockImplementation((basePath, extension) => {
    const suffix = extension ? `.${extension}` : '';
    let candidate = `${basePath}${suffix}`;
    let index = 0;
    while (app.vault.getAbstractFileByPath(candidate)) {
      index++;
      candidate = `${basePath} ${index.toString()}${suffix}`;
    }
    return candidate;
  });
  resourceLockComponent = new ResourceLockComponent(app, 'test-plugin');
  resourceLockComponent.load();
}

describe('SwapFileCommandHandler', () => {
  it('should expose its command identity', () => {
    initApp({});
    const { handler } = createHandler();
    expect(handler.id).toBe('swap-file');
    expect(handler.name).toBe('Swap file with...');
    expect(handler.icon).toBe('switch-camera');
  });

  it('should show a notice and not swap when the file path is ignored', async () => {
    initApp({ 'source.md': 'source body' });
    const { handler, showNotice } = createHandler({ isPathIgnored: (path) => path === 'source.md' });

    await handler.executeFile(getFile('source.md'));

    expect(showNotice).toHaveBeenCalledOnce();
    expect(mockSelectFileForSwap).not.toHaveBeenCalled();
    // The source is untouched.
    expect(await app.vault.adapter.read('source.md')).toBe('source body');
  });

  it('should do nothing when no target file is selected', async () => {
    initApp({ 'source.md': 'source body' });
    const { handler } = createHandler();
    mockSelectFileForSwap.mockResolvedValue(null);

    await handler.executeFile(getFile('source.md'));

    // Nothing swapped; the source note is intact.
    expect(await app.vault.adapter.read('source.md')).toBe('source body');
  });

  it('should swap the two files\' contents on the happy path', async () => {
    initApp({
      'source.md': 'source body',
      'target.md': 'target body'
    });
    const { handler } = createHandler();
    mockSelectFileForSwap.mockResolvedValue(getFile('target.md'));

    await handler.executeFile(getFile('source.md'));

    // The two files exchanged contents in place.
    expect(await app.vault.adapter.read('source.md')).toBe('target body');
    expect(await app.vault.adapter.read('target.md')).toBe('source body');
  });

  it('should swallow the cancellation and roll everything back when unlocked mid-swap', async () => {
    initApp({
      'source.md': 'source body',
      'target.md': 'target body'
    });
    const { handler } = createHandler();
    mockSelectFileForSwap.mockResolvedValue(getFile('target.md'));

    // Simulate the user clicking the lock indicator's Unlock mid-operation: aborting the shared
    // Controller cancels the operation, and the broken rename triggers the spanning transaction rollback.
    vi.spyOn(app.fileManager, 'renameFile').mockImplementationOnce(() => {
      requestResourceUnlockForPath(app, 'source.md');
      throw new Error('cancelled');
    });

    await expect(handler.executeFile(getFile('source.md'))).resolves.toBeUndefined();

    // Rolled back: both files keep their original contents.
    expect(await app.vault.adapter.read('source.md')).toBe('source body');
    expect(await app.vault.adapter.read('target.md')).toBe('target body');
  });

  it('should roll back and rethrow a non-abort error', async () => {
    initApp({
      'source.md': 'source body',
      'target.md': 'target body'
    });
    const { handler } = createHandler();
    mockSelectFileForSwap.mockResolvedValue(getFile('target.md'));

    vi.spyOn(app.fileManager, 'renameFile').mockRejectedValue(new Error('boom'));

    await expect(handler.executeFile(getFile('source.md'))).rejects.toThrow('boom');

    // The spanning transaction rolled back: both files keep their original contents.
    expect(await app.vault.adapter.read('source.md')).toBe('source body');
    expect(await app.vault.adapter.read('target.md')).toBe('target body');
  });

  it('should fall back to the submenu setting for shouldAddCommandToSubmenu', () => {
    initApp({});
    expect(createHandler({ shouldAddCommandsToSubmenu: true }).handler.shouldAddCommandToSubmenu()).toBe(true);
    expect(createHandler({ shouldAddCommandsToSubmenu: false }).handler.shouldAddCommandToSubmenu()).toBe(false);
  });

  it('should always add the command to the file menu', () => {
    initApp({ 'source.md': 'source body' });
    const { handler } = createHandler();
    expect(handler.shouldAddToFileMenu({ file: getFile('source.md'), source: 'source' })).toBe(true);
  });
});
