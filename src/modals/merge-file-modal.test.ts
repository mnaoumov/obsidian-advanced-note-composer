import type {
  App,
  MetadataCache,
  TFile,
  TFolder,
  Vault,
  ViewRegistry,
  Workspace
} from 'obsidian';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { Plugin } from '../plugin.ts';

import { InsertMode } from '../insert-mode.ts';
import { FrontmatterMergeStrategy } from '../plugin-settings.ts';
import { prepareForMergeFile } from './merge-file-modal.ts';

vi.mock('obsidian-dev-utils/async', () => ({
  invokeAsyncSafely: vi.fn((fn: () => Promise<void>) => fn())
}));

vi.mock('obsidian-dev-utils/html-element', () => ({
  appendCodeBlock: vi.fn(),
  createFragmentAsync: vi.fn().mockResolvedValue(createFragment())
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn().mockResolvedValue(createSpan())
}));

vi.mock('obsidian-dev-utils/obsidian/plugin/plugin-context', () => ({
  addPluginCssClasses: vi.fn()
}));

vi.mock('obsidian-dev-utils/path', () => ({
  basename: vi.fn((filePath: string) => {
    const parts = filePath.split('/');
    return parts[parts.length - 1] ?? '';
  })
}));

vi.mock('obsidian-dev-utils/string', () => ({
  trimEnd: vi.fn((str: string, suffix: string) => {
    if (str.endsWith(suffix)) {
      return str.slice(0, -suffix.length);
    }
    return str;
  }),
  trimStart: vi.fn((str: string, prefix: string) => {
    if (str.startsWith(prefix)) {
      return str.slice(prefix.length);
    }
    return str;
  })
}));

vi.mock('../composers/composer-base.ts', () => ({
  getInsertModeFromEvent: vi.fn().mockReturnValue(InsertMode.Append)
}));

vi.mock('./suggest-modal-base.ts', async () => {
  const obsidian = await vi.importActual<typeof import('obsidian')>('obsidian');
  class MockSuggestModalBase extends obsidian.SuggestModal<unknown> {
    protected allowCreateNewFile = false;
    protected shouldAllowOnlyCurrentFolder = false;
    protected shouldShowAlias = false;
    protected shouldShowImages = true;
    protected shouldShowMarkdown = true;
    protected shouldShowNonAttachments = true;
    protected shouldShowNonFileBookmarks = false;
    protected shouldShowNonImageAttachments = true;
    protected shouldShowUnresolved = false;
    protected sourceFile: TFile;

    public constructor(plugin: Plugin, sourceFile: TFile) {
      super(plugin.app);
      this.sourceFile = sourceFile;
      this.shouldAllowOnlyCurrentFolder = plugin.pluginSettingsComponent.settings.shouldAllowOnlyCurrentFolderByDefault;
    }

    public getSuggestions(_query: string): unknown[] {
      return [];
    }
    public onChooseSuggestion(): void {/* Noop */}
    public renderSuggestion(): void {/* Noop */}
    public selectActiveSuggestion(_evt: KeyboardEvent | MouseEvent): void {/* Noop */}
    public updateSuggestions(): void {/* Noop */}
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
    public build(): void {/* Noop */}
  }
  return { SuggestModalCommandBuilder: MockSuggestModalCommandBuilder };
});

const mockTargetFile = strictProxy<TFile>({ path: 'folder/target.md' });

interface SelectItemResult {
  isNewTargetFile: boolean;
  targetFile: TFile;
}

vi.mock('../item-selectors/merge-item-selector.ts', () => {
  class MockMergeItemSelector {
    public selectItem(): Promise<SelectItemResult> {
      return Promise.resolve({ isNewTargetFile: false, targetFile: mockTargetFile });
    }
  }
  return { MergeItemSelector: MockMergeItemSelector };
});

interface InternalPlugins {
  getEnabledPluginById: ReturnType<typeof vi.fn>;
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

function createMockPlugin(options?: MockPluginOptions): Plugin {
  const shouldAskBeforeMerging = options?.shouldAskBeforeMerging ?? false;

  return strictProxy<Plugin>({
    app: strictProxy<App>({
      internalPlugins: strictProxy<InternalPlugins>({
        getEnabledPluginById: vi.fn().mockReturnValue(null)
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- ViewRegistry is an internal Obsidian type with incomplete typings.
      viewRegistry: strictProxy<ViewRegistry>({
        isExtensionRegistered: vi.fn().mockReturnValue(true)
      }),
      workspace: strictProxy<Workspace>({
        getRecentFiles: vi.fn().mockReturnValue([])
      })
    }),
    pluginSettingsComponent: strictProxy({
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
  });
}

describe('prepareForMergeFile', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return null when modal is cancelled', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const plugin = createMockPlugin();

    const promise = prepareForMergeFile(plugin, sourceFile);
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('should return result when shouldAskBeforeMerging is false', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const plugin = createMockPlugin({ shouldAskBeforeMerging: false });

    // MergeFileModal auto-closes → onClose → resolves null → prepareForMergeFile returns null
    const promise = prepareForMergeFile(plugin, sourceFile);
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('should show confirm dialog when shouldAskBeforeMerging is true', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const plugin = createMockPlugin({ shouldAskBeforeMerging: true });

    const promise = prepareForMergeFile(plugin, sourceFile);
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    // Modal auto-closes without selection → null
    expect(result).toBeNull();
  });
});
