import type {
  InternalPlugins,
  ViewRegistry
} from '@obsidian-typings/obsidian-public-latest';
import type {
  App,
  MetadataCache,
  TFile,
  TFolder,
  Vault,
  Workspace
} from 'obsidian';
import type {
  ResourceLockComponent,
  ResourceLockComponentLockForPathParams
} from 'obsidian-dev-utils/obsidian/resource-lock';

import { noop } from 'obsidian-dev-utils/function';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { SuggestModalBaseConstructorParams } from './suggest-modal-base.ts';

import { InsertMode } from '../insert-mode.ts';
import { FrontmatterMergeStrategy } from '../plugin-settings.ts';
import { prepareForMergeFile } from './merge-file-modal.ts';

vi.mock('obsidian-dev-utils/obsidian/html-element', () => ({
  appendCodeBlock: vi.fn()
}));

vi.mock('obsidian-dev-utils/html-element', () => ({
  createFragmentAsync: vi.fn().mockImplementation((cb: (f: DocumentFragment) => Promise<void>) => {
    const fragment = createFragment();
    return cb(fragment).then(() => fragment);
  })
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn().mockResolvedValue(createSpan())
}));

vi.mock('obsidian-dev-utils/obsidian/plugin/plugin-context', () => ({
  addPluginCssClasses: vi.fn()
}));

vi.mock('../composers/composer-base.ts', () => ({
  getInsertModeFromEvent: vi.fn().mockReturnValue(InsertMode.Append)
}));

let shouldAutoSelect = false;

interface AsyncModule {
  invokeAsyncSafely(fn: () => Promise<void>): void;
}

interface WithChooseAsync {
  onChooseSuggestionAsync(item: unknown, evt: KeyboardEvent | MouseEvent): Promise<void>;
}

interface WithSelectSuggestion {
  selectSuggestion(value: unknown, evt: KeyboardEvent | MouseEvent): void;
}

vi.mock('./suggest-modal-base.ts', async () => {
  const obsidian = await vi.importActual<typeof import('obsidian')>('obsidian');

  const asyncModule = await import('obsidian-dev-utils/async') as AsyncModule;

  class MockSuggestModalBase extends obsidian.SuggestModal<unknown> {
    protected allowCreateNewFile = false;
    protected readonly pluginSettingsComponent: PluginSettingsComponent;
    protected shouldAllowOnlyCurrentFolder = false;
    protected shouldShowAlias = false;
    protected shouldShowImages = true;
    protected shouldShowMarkdown = true;
    protected shouldShowNonAttachments = true;
    protected shouldShowNonFileBookmarks = false;
    protected shouldShowNonImageAttachments = true;
    protected shouldShowUnresolved = false;

    protected sourceFile: TFile;

    public constructor(params: SuggestModalBaseConstructorParams) {
      super(params.app);
      this.sourceFile = params.sourceFile;
      this.pluginSettingsComponent = params.pluginSettingsComponent;
      this.shouldAllowOnlyCurrentFolder = params.pluginSettingsComponent.settings.shouldAllowOnlyCurrentFolderByDefault;
    }

    public getSuggestions(_query: string): unknown[] {
      return [];
    }

    public onChooseSuggestion(item: unknown, evt: KeyboardEvent | MouseEvent): void {
      asyncModule.invokeAsyncSafely(() => castTo<WithChooseAsync>(this).onChooseSuggestionAsync(item, evt));
    }

    public override onOpen(): void {
      if (shouldAutoSelect) {
        (this as WithSelectSuggestion).selectSuggestion(null, { shiftKey: false } as MouseEvent);
      }
      super.onOpen();
    }

    public renderSuggestion(): void {
      noop();
    }

    public override selectActiveSuggestion(_evt: KeyboardEvent | MouseEvent): void {
      noop();
    }

    public override updateSuggestions(): void {
      noop();
    }
  }
  return { SuggestModalBase: MockSuggestModalBase };
});

const mockTargetFile = strictProxy<TFile>({ path: 'folder/target.md' });

interface SelectItemResult {
  readonly isNewTargetFile: boolean;
  readonly targetFile: TFile;
}

vi.mock('../item-selectors/merge-item-selector.ts', () => {
  class MockMergeItemSelector {
    public selectItem(): Promise<SelectItemResult> {
      return Promise.resolve({ isNewTargetFile: false, targetFile: mockTargetFile });
    }
  }
  return { MergeItemSelector: MockMergeItemSelector };
});

interface MockPlugin {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

interface MockPluginOptions {
  readonly shouldAskBeforeMerging?: boolean;
}

function createMockFile(path: string): TFile {
  const name = path.split('/').pop() ?? '';
  const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  return strictProxy<TFile>({
    extension: 'md',
    name,
    parent: strictProxy<TFolder>({
      getParentPrefix: () => parentPath ? `${parentPath}/` : '',
      path: parentPath
    }),
    path
  });
}

function createMockPlugin(options?: MockPluginOptions): MockPlugin {
  const shouldAskBeforeMerging = options?.shouldAskBeforeMerging ?? false;

  return {
    app: strictProxy<App>({
      internalPlugins: strictProxy<InternalPlugins>({
        getEnabledPluginById: castTo<InternalPlugins['getEnabledPluginById']>(vi.fn().mockReturnValue(null))
      }),
      metadataCache: strictProxy<MetadataCache>({
        getFileCache: vi.fn().mockReturnValue(null),
        isUserIgnored: vi.fn().mockReturnValue(false),
        unresolvedLinks: {}
      }),
      vault: strictProxy<Vault>({
        getFileByPath: vi.fn().mockReturnValue(null),
        getFiles: vi.fn().mockReturnValue([]),
        getMarkdownFiles: vi.fn().mockReturnValue([])
      }),

      viewRegistry: strictProxy<ViewRegistry>({
        isExtensionRegistered: vi.fn().mockReturnValue(true)
      }),
      workspace: strictProxy<Workspace>({
        getRecentFiles: vi.fn().mockReturnValue([])
      })
    }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      editAndSave: vi.fn().mockResolvedValue(undefined),
      settings: strictProxy({
        defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues,
        isPathIgnored: vi.fn().mockReturnValue(false),
        shouldAllowOnlyCurrentFolderByDefault: false,
        shouldAllowSplitIntoUnresolvedPathByDefault: true,
        shouldAskBeforeMerging,
        shouldFixFootnotesByDefault: true,
        shouldMergeHeadingsByDefault: false,
        shouldShowModalInstructions: true
      })
    }),
    resourceLockComponent: createMockResourceLockComponent()
  };
}

function createMockResourceLockComponent(): ResourceLockComponent {
  const unlockForPath = vi.fn();
  // The real lock is released by disposing the returned `Disposable`; model that as
  // `unlockForPath` so a `using` scope-exit disposal is observable through the same spy.
  return strictProxy<ResourceLockComponent>({
    lockForPath: castTo<ResourceLockComponent['lockForPath']>(vi.fn((params: ResourceLockComponentLockForPathParams) => ({
      [Symbol.dispose]: (): void => {
        unlockForPath(params.pathOrFile);
      }
    }))),
    unlockForPath
  });
}

describe('prepareForMergeFile', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    shouldAutoSelect = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return null when modal is cancelled', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const plugin = createMockPlugin();

    const promise = prepareForMergeFile({ app: plugin.app, pluginSettingsComponent: plugin.pluginSettingsComponent, resourceLockComponent: plugin.resourceLockComponent, sourceFile });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('should return result when shouldAskBeforeMerging is false', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const plugin = createMockPlugin({ shouldAskBeforeMerging: false });

    // MergeFileModal auto-closes → onClose → resolves null → prepareForMergeFile returns null
    const promise = prepareForMergeFile({ app: plugin.app, pluginSettingsComponent: plugin.pluginSettingsComponent, resourceLockComponent: plugin.resourceLockComponent, sourceFile });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('should show confirm dialog when shouldAskBeforeMerging is true', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const plugin = createMockPlugin({ shouldAskBeforeMerging: true });

    const promise = prepareForMergeFile({ app: plugin.app, pluginSettingsComponent: plugin.pluginSettingsComponent, resourceLockComponent: plugin.resourceLockComponent, sourceFile });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    // Modal auto-closes without selection → null
    expect(result).toBeNull();
  });

  it('should return result when user selects an item and shouldAskBeforeMerging is false', async () => {
    shouldAutoSelect = true;
    const sourceFile = createMockFile('folder/source.md');
    const plugin = createMockPlugin({ shouldAskBeforeMerging: false });

    const promise = prepareForMergeFile({ app: plugin.app, pluginSettingsComponent: plugin.pluginSettingsComponent, resourceLockComponent: plugin.resourceLockComponent, sourceFile });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).not.toBeNull();
    expect(result?.targetFile).toBe(mockTargetFile);
  });

  it('should return null when confirm dialog is rejected after user selects item', async () => {
    shouldAutoSelect = true;
    const sourceFile = createMockFile('folder/source.md');
    const plugin = createMockPlugin({ shouldAskBeforeMerging: true });

    const promise = prepareForMergeFile({ app: plugin.app, pluginSettingsComponent: plugin.pluginSettingsComponent, resourceLockComponent: plugin.resourceLockComponent, sourceFile });
    // First timer: SuggestModal close
    await vi.advanceTimersByTimeAsync(0);
    // Second timer: ConfirmDialog close (auto-closes without selection → isConfirmed=false)
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('should lock the source note while the modal is open and unlock it afterwards', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const plugin = createMockPlugin();

    const promise = prepareForMergeFile({ app: plugin.app, pluginSettingsComponent: plugin.pluginSettingsComponent, resourceLockComponent: plugin.resourceLockComponent, sourceFile });
    expect(vi.mocked(plugin.resourceLockComponent.lockForPath).mock.calls.map((call) => call[0].pathOrFile)).toContain(sourceFile);
    expect(plugin.resourceLockComponent.unlockForPath).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    await promise;
    expect(plugin.resourceLockComponent.unlockForPath).toHaveBeenCalledWith(sourceFile);
  });

  it('should lock the target note while the confirmation dialog is open and unlock both notes afterwards', async () => {
    shouldAutoSelect = true;
    const sourceFile = createMockFile('folder/source.md');
    const plugin = createMockPlugin({ shouldAskBeforeMerging: true });

    const promise = prepareForMergeFile({ app: plugin.app, pluginSettingsComponent: plugin.pluginSettingsComponent, resourceLockComponent: plugin.resourceLockComponent, sourceFile });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    await promise;
    const lockedPaths = vi.mocked(plugin.resourceLockComponent.lockForPath).mock.calls.map((call) => call[0].pathOrFile);
    expect(lockedPaths).toContain(sourceFile);
    expect(lockedPaths).toContain(mockTargetFile);
    expect(plugin.resourceLockComponent.unlockForPath).toHaveBeenCalledWith(sourceFile);
    expect(plugin.resourceLockComponent.unlockForPath).toHaveBeenCalledWith(mockTargetFile);
  });

  it('should cancel and unlock when the lock is aborted while the modal is open', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const plugin = createMockPlugin();

    const promise = prepareForMergeFile({ app: plugin.app, pluginSettingsComponent: plugin.pluginSettingsComponent, resourceLockComponent: plugin.resourceLockComponent, sourceFile });
    // Simulate the user unlocking: abort the controller the lock was registered with.
    const abortController = vi.mocked(plugin.resourceLockComponent.lockForPath).mock.calls[0]?.[0]?.abortController;
    expect(abortController).toBeInstanceOf(AbortController);
    abortController?.abort();
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
    expect(plugin.resourceLockComponent.unlockForPath).toHaveBeenCalledWith(sourceFile);
  });
});
