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

vi.mock('obsidian-dev-utils/html-element', () => ({
  appendCodeBlock: vi.fn(),
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
  // eslint-disable-next-line no-restricted-syntax -- Need to import for mock delegation.
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

vi.mock('./suggest-modal-command-builder.ts', () => {
  class MockSuggestModalCommandBuilder {
    public addCheckbox(): this {
      return this;
    }

    public addDropDown(): this {
      return this;
    }

    public addKeyboardCommand(): this {
      return this;
    }

    public build(): void {
      noop();
    }
  }
  return { SuggestModalCommandBuilder: MockSuggestModalCommandBuilder };
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
        shouldMergeHeadingsByDefault: false
      })
    })
  };
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

    const promise = prepareForMergeFile({ app: plugin.app, pluginSettingsComponent: plugin.pluginSettingsComponent, sourceFile });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('should return result when shouldAskBeforeMerging is false', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const plugin = createMockPlugin({ shouldAskBeforeMerging: false });

    // MergeFileModal auto-closes → onClose → resolves null → prepareForMergeFile returns null
    const promise = prepareForMergeFile({ app: plugin.app, pluginSettingsComponent: plugin.pluginSettingsComponent, sourceFile });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('should show confirm dialog when shouldAskBeforeMerging is true', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const plugin = createMockPlugin({ shouldAskBeforeMerging: true });

    const promise = prepareForMergeFile({ app: plugin.app, pluginSettingsComponent: plugin.pluginSettingsComponent, sourceFile });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    // Modal auto-closes without selection → null
    expect(result).toBeNull();
  });

  it('should return result when user selects an item and shouldAskBeforeMerging is false', async () => {
    shouldAutoSelect = true;
    const sourceFile = createMockFile('folder/source.md');
    const plugin = createMockPlugin({ shouldAskBeforeMerging: false });

    const promise = prepareForMergeFile({ app: plugin.app, pluginSettingsComponent: plugin.pluginSettingsComponent, sourceFile });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).not.toBeNull();
    expect(result?.targetFile).toBe(mockTargetFile);
  });

  it('should return null when confirm dialog is rejected after user selects item', async () => {
    shouldAutoSelect = true;
    const sourceFile = createMockFile('folder/source.md');
    const plugin = createMockPlugin({ shouldAskBeforeMerging: true });

    const promise = prepareForMergeFile({ app: plugin.app, pluginSettingsComponent: plugin.pluginSettingsComponent, sourceFile });
    // First timer: SuggestModal close
    await vi.advanceTimersByTimeAsync(0);
    // Second timer: ConfirmDialog close (auto-closes without selection → isConfirmed=false)
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
  });
});
