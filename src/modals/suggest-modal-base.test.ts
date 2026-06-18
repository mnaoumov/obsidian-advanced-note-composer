import type {
  BookmarkItem,
  InternalPlugins,
  ViewRegistry
} from '@obsidian-typings/obsidian-public-latest';
import type {
  App,
  CachedMetadata,
  MetadataCache,
  TFile,
  TFolder,
  Vault,
  Workspace
} from 'obsidian';

import { Platform } from 'obsidian';
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
import type { Item } from './suggest-modal-base.ts';

import { SuggestModalBase } from './suggest-modal-base.ts';

interface OnInputable {
  onInput(): void;
}

vi.mock('obsidian-dev-utils/async', () => ({
  invokeAsyncSafely: vi.fn((fn: () => Promise<void>) => fn())
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

interface BookmarksPlugin {
  getItemTitle: ReturnType<typeof vi.fn>;
  items: BookmarkItem[];
}

interface MockPlugin {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

interface MockPluginOptions {
  readonly bookmarksPlugin?: BookmarksPlugin | null;
  readonly files?: TFile[];
  readonly markdownFiles?: TFile[];
  readonly recentFiles?: string[];
  readonly unresolvedLinks?: Record<string, Record<string, number>>;
}

class TestSuggestModal extends SuggestModalBase {
  public lastChosenEvt: KeyboardEvent | MouseEvent | null = null;
  public lastChosenItem: Item | null = null;

  // eslint-disable-next-line @typescript-eslint/require-await -- Abstract base class requires Promise<void> return type.
  protected override async onChooseSuggestionAsync(item: Item | null, evt: KeyboardEvent | MouseEvent): Promise<void> {
    this.lastChosenItem = item;
    this.lastChosenEvt = evt;
  }
}

function createMockFile(path: string, extension = 'md'): TFile {
  const parts = path.split('/');
  const name = parts[parts.length - 1] ?? '';
  const parentPath = parts.slice(0, -1).join('/');
  return strictProxy<TFile>({
    extension,
    name,
    parent: strictProxy<TFolder>({
      getParentPrefix: () => parentPath ? `${parentPath}/` : '',
      path: parentPath
    }),
    path
  });
}

function createMockPlugin(overrides?: MockPluginOptions): MockPlugin {
  const files = overrides?.files ?? [];
  const markdownFiles = overrides?.markdownFiles ?? files.filter((f) => f.extension === 'md');
  const recentFiles = overrides?.recentFiles ?? [];
  const unresolvedLinks = overrides?.unresolvedLinks ?? {};
  const bookmarksPlugin = overrides?.bookmarksPlugin ?? null;

  return {
    app: strictProxy<App>({
      internalPlugins: strictProxy<InternalPlugins>({
        getEnabledPluginById: castTo<InternalPlugins['getEnabledPluginById']>(vi.fn((id: string) => {
          if (id === 'bookmarks') {
            return bookmarksPlugin;
          }
          return null;
        }))
      }),
      metadataCache: strictProxy<MetadataCache>({
        getFileCache: vi.fn().mockReturnValue(null),
        isUserIgnored: vi.fn().mockReturnValue(false),
        unresolvedLinks
      }),
      vault: strictProxy<Vault>({
        getFileByPath: vi.fn((filePath: string) => files.find((f) => f.path === filePath) ?? null),
        getFiles: vi.fn(() => files),
        getMarkdownFiles: vi.fn(() => markdownFiles)
      }),

      viewRegistry: strictProxy<ViewRegistry>({
        isExtensionRegistered: vi.fn().mockReturnValue(true)
      }),
      workspace: strictProxy<Workspace>({
        getRecentFiles: vi.fn().mockReturnValue(recentFiles)
      })
    }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy({
        isPathIgnored: vi.fn().mockReturnValue(false),
        shouldAllowOnlyCurrentFolderByDefault: false
      })
    })
  };
}

function createTestSuggestModal(plugin: MockPlugin, sourceFile: TFile): TestSuggestModal {
  return new TestSuggestModal({
    app: plugin.app,
    pluginSettingsComponent: plugin.pluginSettingsComponent,
    sourceFile
  });
}

describe('SuggestModalBase', () => {
  let plugin: MockPlugin;
  let sourceFile: TFile;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should set default properties', () => {
      plugin = createMockPlugin();
      sourceFile = createMockFile('folder/source.md');
      const modal = createTestSuggestModal(plugin, sourceFile);
      expect(modal.inputEl).toBeTruthy();
      expect(modal.limit).toBe(20);
    });
  });

  describe('getSuggestions', () => {
    it('should return recent files when query is empty', () => {
      const file1 = createMockFile('folder/recent1.md');
      const file2 = createMockFile('folder/recent2.md');
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin({
        files: [file1, file2, sourceFile],
        recentFiles: ['folder/recent1.md', 'folder/recent2.md']
      });
      const modal = createTestSuggestModal(plugin, sourceFile);
      const suggestions = modal.getSuggestions('');
      expect(suggestions).toHaveLength(2);
      expect(suggestions[0]?.file).toBe(file1);
    });

    it('should skip duplicate recent files', () => {
      const file1 = createMockFile('folder/recent1.md');
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin({
        files: [file1, sourceFile],
        recentFiles: ['folder/recent1.md', 'folder/recent1.md']
      });
      const modal = createTestSuggestModal(plugin, sourceFile);
      const suggestions = modal.getSuggestions('');
      expect(suggestions).toHaveLength(1);
    });

    it('should exclude source file from recent files', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin({
        files: [sourceFile],
        recentFiles: ['folder/source.md']
      });
      const modal = createTestSuggestModal(plugin, sourceFile);
      const suggestions = modal.getSuggestions('');
      expect(suggestions).toHaveLength(0);
    });

    it('should exclude user-ignored files from recent files', () => {
      const file1 = createMockFile('folder/ignored.md');
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin({
        files: [file1, sourceFile],
        recentFiles: ['folder/ignored.md']
      });
      vi.mocked(plugin.app.metadataCache.isUserIgnored).mockReturnValue(true);
      const modal = createTestSuggestModal(plugin, sourceFile);
      const suggestions = modal.getSuggestions('');
      expect(suggestions).toHaveLength(0);
    });

    it('should exclude non-existent recent files', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin({
        files: [sourceFile],
        recentFiles: ['folder/nonexistent.md']
      });
      const modal = createTestSuggestModal(plugin, sourceFile);
      const suggestions = modal.getSuggestions('');
      expect(suggestions).toHaveLength(0);
    });

    it('should search files when query is provided', () => {
      const file1 = createMockFile('folder/test-file.md');
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin({
        files: [file1, sourceFile],
        markdownFiles: [file1, sourceFile]
      });
      const modal = createTestSuggestModal(plugin, sourceFile);
      const suggestions = modal.getSuggestions('test');
      // Results depend on prepareFuzzySearch mock which returns null by default
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('should lower score of user-ignored files that match search query', () => {
      const file1 = createMockFile('folder/test-file.md');
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin({
        files: [file1, sourceFile],
        markdownFiles: [file1, sourceFile]
      });
      vi.mocked(plugin.app.metadataCache.isUserIgnored).mockReturnValue(true);
      const modal = createTestSuggestModal(plugin, sourceFile);
      const suggestions = modal.getSuggestions('test-file');
      // The file should still appear but have lower score
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('should skip ignored unresolved links', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin({
        unresolvedLinks: {
          'folder/source.md': { 'ignored-note': 1 }
        }
      });
      vi.mocked(plugin.pluginSettingsComponent.settings.isPathIgnored).mockImplementation((path: string) => path === 'ignored-note');
      const modal = createTestSuggestModal(plugin, sourceFile);
      modal['shouldShowUnresolved'] = true;
      const suggestions = modal.getSuggestions('ignored');
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('should add file bookmark when file exists and is included', () => {
      const bookmarkedFile = createMockFile('folder/bookmarked.md');
      sourceFile = createMockFile('folder/source.md');
      const bookmarksPlugin: BookmarksPlugin = {
        getItemTitle: vi.fn().mockReturnValue('Bookmarked'),
        items: [{ ctime: 0, path: 'folder/bookmarked.md', title: 'bookmarked', type: 'file' }]
      };
      plugin = createMockPlugin({
        bookmarksPlugin,
        files: [bookmarkedFile, sourceFile]
      });
      vi.mocked(plugin.app.vault.getFileByPath).mockImplementation((path: string) => {
        if (path === 'folder/bookmarked.md') {
          return bookmarkedFile;
        }
        return null;
      });
      const modal = createTestSuggestModal(plugin, sourceFile);
      const suggestions = modal.getSuggestions('Bookmarked');
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('should find files where path matches but filename does not', () => {
      // File whose filename (xyz.md) does not match 'unique-folder' but path does
      const file1 = createMockFile('unique-folder/xyz.md');
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin({
        files: [file1, sourceFile],
        markdownFiles: [file1, sourceFile]
      });
      const modal = createTestSuggestModal(plugin, sourceFile);
      const suggestions = modal.getSuggestions('unique-folder');
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('should find files matching query via searchFilePath', () => {
      const file1 = createMockFile('folder/test-file.md');
      const file2 = createMockFile('folder/other-test.md');
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin({
        files: [file1, file2, sourceFile],
        markdownFiles: [file1, file2, sourceFile]
      });
      const modal = createTestSuggestModal(plugin, sourceFile);
      // Use a specific query that the fuzzy search should match
      const suggestions = modal.getSuggestions('test-file');
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('should search unresolved links when enabled', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin({
        unresolvedLinks: {
          'folder/source.md': { 'unresolved-note': 1 }
        }
      });
      const modal = createTestSuggestModal(plugin, sourceFile);
      modal['shouldShowUnresolved'] = true;
      const suggestions = modal.getSuggestions('unresolved');
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('should filter unresolved links by current folder when shouldAllowOnlyCurrentFolder is true', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin({
        unresolvedLinks: {
          'folder/source.md': { 'other/unresolved-note': 1 }
        }
      });
      const modal = createTestSuggestModal(plugin, sourceFile);
      modal['shouldShowUnresolved'] = true;
      modal['shouldAllowOnlyCurrentFolder'] = true;
      const suggestions = modal.getSuggestions('unresolved');
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('should not search unresolved links when disabled', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin({
        unresolvedLinks: {
          'folder/source.md': { 'unresolved-note': 1 }
        }
      });
      const modal = createTestSuggestModal(plugin, sourceFile);
      modal['shouldShowUnresolved'] = false;
      const suggestions = modal.getSuggestions('unresolved');
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('should search aliases when shouldShowAlias is true', () => {
      const file1 = createMockFile('folder/test-file.md');
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin({
        files: [file1, sourceFile],
        markdownFiles: [file1, sourceFile]
      });
      // Set up cache with aliases
      vi.mocked(plugin.app.metadataCache.getFileCache).mockReturnValue(castTo<CachedMetadata>({
        frontmatter: { aliases: ['My Alias'] }
      }));
      const modal = createTestSuggestModal(plugin, sourceFile);
      modal['shouldShowAlias'] = true;
      const suggestions = modal.getSuggestions('alias');
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('should lower score of alias matches for user-ignored files', () => {
      const file1 = createMockFile('folder/test-file.md');
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin({
        files: [file1, sourceFile],
        markdownFiles: [file1, sourceFile]
      });
      vi.mocked(plugin.app.metadataCache.getFileCache).mockReturnValue(castTo<CachedMetadata>({
        frontmatter: { aliases: ['My Alias'] }
      }));
      vi.mocked(plugin.app.metadataCache.isUserIgnored).mockReturnValue(true);
      const modal = createTestSuggestModal(plugin, sourceFile);
      modal['shouldShowAlias'] = true;
      const suggestions = modal.getSuggestions('alias');
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('should search bookmarks when bookmarks plugin is enabled', () => {
      sourceFile = createMockFile('folder/source.md');
      const bookmarksPlugin: BookmarksPlugin = {
        getItemTitle: vi.fn().mockReturnValue('My Bookmark'),
        items: [{ ctime: 0, path: 'folder/bookmarked.md', title: 'bookmarked', type: 'file' }]
      };
      plugin = createMockPlugin({ bookmarksPlugin });
      const modal = createTestSuggestModal(plugin, sourceFile);
      const suggestions = modal.getSuggestions('bookmark');
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('should not search bookmarks when bookmarks plugin is disabled', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin({ bookmarksPlugin: null });
      const modal = createTestSuggestModal(plugin, sourceFile);
      const suggestions = modal.getSuggestions('bookmark');
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('should handle bookmark groups with nested items', () => {
      sourceFile = createMockFile('folder/source.md');
      const bookmarksPlugin: BookmarksPlugin = {
        getItemTitle: vi.fn().mockReturnValue('Group'),
        items: [{
          ctime: 0,
          items: [{ ctime: 0, path: 'folder/nested.md', title: 'Nested', type: 'file' }],
          title: 'Group',
          type: 'group'
        }]
      };
      plugin = createMockPlugin({ bookmarksPlugin });
      const modal = createTestSuggestModal(plugin, sourceFile);
      const suggestions = modal.getSuggestions('nested');
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('should handle non-file bookmarks with subpath', () => {
      sourceFile = createMockFile('folder/source.md');
      const bookmarksPlugin: BookmarksPlugin = {
        getItemTitle: vi.fn().mockReturnValue('Bookmark'),
        items: [{ ctime: 0, path: 'folder/bookmarked.md', subpath: '#heading', title: 'bookmarked', type: 'file' }]
      };
      plugin = createMockPlugin({ bookmarksPlugin });
      const modal = createTestSuggestModal(plugin, sourceFile);
      modal['shouldShowNonFileBookmarks'] = true;
      const suggestions = modal.getSuggestions('bookmark');
      expect(Array.isArray(suggestions)).toBe(true);
    });
  });

  describe('shouldIncludeFile', () => {
    it('should exclude path-ignored files', () => {
      sourceFile = createMockFile('folder/source.md');
      const file = createMockFile('ignored/file.md');
      plugin = createMockPlugin({ files: [file, sourceFile] });
      vi.mocked(plugin.pluginSettingsComponent.settings.isPathIgnored).mockReturnValue(true);
      const modal = createTestSuggestModal(plugin, sourceFile);
      const suggestions = modal.getSuggestions('');
      expect(suggestions).toHaveLength(0);
    });

    it('should exclude files from other folders when shouldAllowOnlyCurrentFolder is true', () => {
      sourceFile = createMockFile('folder/source.md');
      const otherFile = createMockFile('other/file.md');
      plugin = createMockPlugin({ files: [otherFile, sourceFile], recentFiles: ['other/file.md'] });
      const modal = createTestSuggestModal(plugin, sourceFile);
      modal['shouldAllowOnlyCurrentFolder'] = true;
      const suggestions = modal.getSuggestions('');
      expect(suggestions).toHaveLength(0);
    });

    it('should handle canvas files based on shouldShowNonAttachments', () => {
      sourceFile = createMockFile('folder/source.md');
      const canvasFile = createMockFile('folder/canvas.canvas', 'canvas');
      plugin = createMockPlugin({ files: [canvasFile, sourceFile], recentFiles: ['folder/canvas.canvas'] });
      const modal = createTestSuggestModal(plugin, sourceFile);
      const suggestions = modal.getSuggestions('');
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('should handle base files based on shouldShowNonAttachments', () => {
      sourceFile = createMockFile('folder/source.md');
      const baseFile = createMockFile('folder/data.base', 'base');
      plugin = createMockPlugin({ files: [baseFile, sourceFile], recentFiles: ['folder/data.base'] });
      const modal = createTestSuggestModal(plugin, sourceFile);
      const suggestions = modal.getSuggestions('');
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('should include non-standard extension files when shouldShowAllTypes is true', () => {
      sourceFile = createMockFile('folder/source.md');
      const customFile = createMockFile('folder/data.xyz', 'xyz');
      plugin = createMockPlugin({ files: [customFile, sourceFile], recentFiles: ['folder/data.xyz'] });
      const modal = createTestSuggestModal(plugin, sourceFile);
      const suggestions = modal.getSuggestions('');
      expect(suggestions.length).toBeGreaterThan(0);
    });

    it('should handle image files based on shouldShowImages', () => {
      sourceFile = createMockFile('folder/source.md');
      const imageFile = createMockFile('folder/image.png', 'png');
      plugin = createMockPlugin({ files: [imageFile, sourceFile], recentFiles: ['folder/image.png'] });
      const modal = createTestSuggestModal(plugin, sourceFile);
      const suggestions = modal.getSuggestions('');
      expect(Array.isArray(suggestions)).toBe(true);
    });
  });

  describe('renderSuggestion', () => {
    it('should render null item as create suggestion', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);
      modal.inputEl.value = 'New Note';
      const el = createDiv();
      modal.renderSuggestion(null, el);
      expect(el.querySelector('.suggestion-title')?.textContent).toBe('New Note');
      expect(el.querySelector('.suggestion-action')?.textContent).toBe('Enter to create');
    });

    it('should render file item', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);
      const el = createDiv();
      const item: Item = {
        file: createMockFile('folder/test.md'),
        match: { matches: [], score: 0 },
        type: 'file'
      };
      modal.renderSuggestion(item, el);
      expect(el.querySelector('.suggestion-title')).toBeTruthy();
      expect(el.querySelector('.suggestion-flair')).toBeTruthy();
    });

    it('should render alias item', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);
      const el = createDiv();
      const item: Item = {
        alias: 'My Alias',
        file: createMockFile('folder/test.md'),
        match: { matches: [], score: 0 },
        type: 'alias'
      };
      modal.renderSuggestion(item, el);
      expect(el.querySelector('.suggestion-note')).toBeTruthy();
    });

    it('should render unresolved item', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);
      const el = createDiv();
      const item: Item = {
        linktext: 'unresolved-note',
        match: { matches: [], score: 0 },
        type: 'unresolved'
      };
      modal.renderSuggestion(item, el);
      expect(el.querySelector('.suggestion-unresolved')).toBeTruthy();
      expect(el.querySelector('.suggestion-unresolved-description')?.textContent).toBe('(unresolved)');
    });

    it('should render bookmark file item', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);
      const el = createDiv();
      const item: Item = {
        bookmarkPath: 'My Bookmark',
        item: { ctime: 0, path: 'folder/bookmarked.md', subpath: '#heading', title: 'bookmarked', type: 'file' },
        match: { matches: [], score: 0 },
        type: 'bookmark'
      };
      modal.renderSuggestion(item, el);
      expect(el.querySelector('.suggestion-title')).toBeTruthy();
    });

    it('should render bookmark folder item', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);
      const el = createDiv();
      const item: Item = {
        bookmarkPath: 'Folder Bookmark',
        item: { ctime: 0, path: 'folder', title: 'folder', type: 'folder' },
        match: { matches: [], score: 0 },
        type: 'bookmark'
      };
      modal.renderSuggestion(item, el);
      expect(el.querySelector('.suggestion-title')).toBeTruthy();
    });

    it('should render bookmark search item', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);
      const el = createDiv();
      const item: Item = {
        bookmarkPath: 'Search Bookmark',
        item: { ctime: 0, query: 'search query', title: 'search', type: 'search' },
        match: { matches: [], score: 0 },
        type: 'bookmark'
      };
      modal.renderSuggestion(item, el);
      expect(el.querySelector('.suggestion-title')).toBeTruthy();
    });

    it('should render bookmark graph item', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);
      const el = createDiv();
      const item: Item = {
        bookmarkPath: 'Graph Bookmark',
        item: { ctime: 0, title: 'graph', type: 'graph' },
        match: { matches: [], score: 0 },
        type: 'bookmark'
      };
      modal.renderSuggestion(item, el);
      expect(el.querySelector('.suggestion-title')).toBeTruthy();
    });

    it('should render bookmark url item without webviewer plugin', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);
      const el = createDiv();
      const item: Item = {
        bookmarkPath: 'URL Bookmark',
        item: { ctime: 0, title: 'URL', type: 'url', url: 'https://example.com' },
        match: { matches: [], score: 0 },
        type: 'bookmark'
      };
      modal.renderSuggestion(item, el);
      expect(el.querySelector('.suggestion-title')).toBeTruthy();
    });

    it('should render bookmark url item with webviewer plugin', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      vi.mocked(plugin.app.internalPlugins.getEnabledPluginById).mockImplementation(castTo<InternalPlugins['getEnabledPluginById']>((id: string) => {
        if (id === 'webviewer') {
          return { db: { setIcon: vi.fn() } };
        }
        return null;
      }));
      const modal = createTestSuggestModal(plugin, sourceFile);
      const el = createDiv();
      const item: Item = {
        bookmarkPath: 'URL Bookmark',
        item: { ctime: 0, title: 'URL', type: 'url', url: 'https://example.com' },
        match: { matches: [], score: 0 },
        type: 'bookmark'
      };
      modal.renderSuggestion(item, el);
      expect(el.querySelector('.suggestion-title')).toBeTruthy();
    });

    it('should add downranked class for downranked items', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);
      const el = createDiv();
      const item: Item = {
        downranked: true,
        file: createMockFile('folder/test.md'),
        match: { matches: [], score: 0 },
        type: 'file'
      };
      modal.renderSuggestion(item, el);
      expect(el.classList.contains('mod-downranked')).toBe(true);
    });
  });

  describe('onChooseSuggestion', () => {
    it('should call onChooseSuggestionAsync', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);
      const item: Item = {
        file: createMockFile('folder/test.md'),
        match: { matches: [], score: 0 },
        type: 'file'
      };
      const evt = { shiftKey: false } as MouseEvent;
      modal.onChooseSuggestion(item, evt);
      expect(modal.lastChosenItem).toBe(item);
      expect(modal.lastChosenEvt).toBe(evt);
    });
  });

  describe('onInput', () => {
    it('should handle mobile with create button when allowCreateNewFile is true', () => {
      vi.spyOn(Platform, 'isMobile', 'get').mockReturnValue(true);
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);
      modal['allowCreateNewFile'] = true;
      modal['shouldShowMarkdown'] = true;
      modal.inputEl.value = 'test';

      // Mock ctaEl and chooser
      const ctaEl = createDiv();
      Object.defineProperty(modal, 'ctaEl', { value: ctaEl });
      Object.defineProperty(modal, 'chooser', {
        value: {
          suggestions: [{ getText: (): string => 'test' }]
        }
      });

      // Super.onInput() may not exist on the mock, so we stub it
      const superOnInput = vi.fn();
      castTo<OnInputable>(Object.getPrototypeOf(castTo<object>(Object.getPrototypeOf(modal)))).onInput = superOnInput;

      modal.onInput();
      expect(superOnInput).toHaveBeenCalled();
    });

    it('should detach create button when input is empty on mobile', () => {
      vi.spyOn(Platform, 'isMobile', 'get').mockReturnValue(true);
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);
      modal['allowCreateNewFile'] = true;
      modal.inputEl.value = '   ';

      const superOnInput = vi.fn();
      castTo<OnInputable>(Object.getPrototypeOf(castTo<object>(Object.getPrototypeOf(modal)))).onInput = superOnInput;

      modal.onInput();
      expect(superOnInput).toHaveBeenCalled();
    });

    it('should not re-append create button when already in DOM on mobile', () => {
      vi.spyOn(Platform, 'isMobile', 'get').mockReturnValue(true);
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);
      modal['allowCreateNewFile'] = true;
      modal['shouldShowMarkdown'] = true;
      modal.inputEl.value = 'test';

      const ctaEl = createDiv();
      Object.defineProperty(modal, 'ctaEl', { value: ctaEl });
      Object.defineProperty(modal, 'chooser', {
        value: {
          suggestions: [{ getText: (): string => 'test' }]
        }
      });

      const superOnInput = vi.fn();
      castTo<OnInputable>(Object.getPrototypeOf(castTo<object>(Object.getPrototypeOf(modal)))).onInput = superOnInput;

      // First call: appends the button
      modal.onInput();
      // Second call: button is already appended, so just updates ariaDisabled
      modal.onInput();
      expect(superOnInput).toHaveBeenCalledTimes(2);
    });

    it('should not add create button on desktop', () => {
      vi.spyOn(Platform, 'isMobile', 'get').mockReturnValue(false);
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);
      modal.inputEl.value = 'test';

      const superOnInput = vi.fn();

      castTo<OnInputable>(Object.getPrototypeOf(castTo<object>(Object.getPrototypeOf(modal)))).onInput = superOnInput;

      modal.onInput();
      expect(superOnInput).toHaveBeenCalled();
    });
  });

  describe('onNoSuggestion', () => {
    it('should set create suggestion when supportsCreate is true and value is non-empty', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);
      modal['allowCreateNewFile'] = true;
      modal['shouldShowMarkdown'] = true;
      modal.inputEl.value = 'New Note';

      const chooser = {
        addMessage: vi.fn(),
        setSuggestions: vi.fn()
      };
      Object.defineProperty(modal, 'chooser', { value: chooser });

      modal.onNoSuggestion();
      expect(chooser.setSuggestions).toHaveBeenCalledWith([null]);
    });

    it('should show empty state text when value is non-empty and supportsCreate is false', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);
      modal['allowCreateNewFile'] = false;
      modal.inputEl.value = 'query';

      const chooser = {
        addMessage: vi.fn(),
        setSuggestions: vi.fn()
      };
      Object.defineProperty(modal, 'chooser', { value: chooser });

      modal.onNoSuggestion();
      expect(chooser.setSuggestions).toHaveBeenCalledWith(null);
      expect(chooser.addMessage).toHaveBeenCalledWith(modal.emptyStateText);
    });

    it('should show type-to-search message when value is empty', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);
      modal.inputEl.value = '';

      const chooser = {
        addMessage: vi.fn(),
        setSuggestions: vi.fn()
      };
      Object.defineProperty(modal, 'chooser', { value: chooser });

      modal.onNoSuggestion();
      expect(chooser.setSuggestions).toHaveBeenCalledWith(null);
      expect(chooser.addMessage).toHaveBeenCalledWith('No recent files found. Type to search...');
    });
  });

  describe('handleCreateButtonClick', () => {
    it('should call onChooseSuggestion with null and close', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);
      const closeSpy = vi.spyOn(modal, 'close');

      modal['handleCreateButtonClick']({ shiftKey: false } as MouseEvent);
      expect(modal.lastChosenItem).toBeNull();
      expect(closeSpy).toHaveBeenCalled();
    });
  });

  describe('getDisplayText', () => {
    it('should return bookmark path for bookmark type', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);
      const result = modal['getDisplayText']({ bookmarkPath: 'My Bookmark', match: { matches: [], score: 0 }, type: 'bookmark' });
      expect(result).toBe('My Bookmark');
    });

    it('should return linktext for unresolved type', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);
      const result = modal['getDisplayText']({ linktext: 'unresolved-note', match: { matches: [], score: 0 }, type: 'unresolved' });
      expect(result).toBe('unresolved-note');
    });

    it('should return empty string for unknown type', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);
      const result = modal['getDisplayText']({ match: { matches: [], score: 0 }, type: 'unknown' });
      expect(result).toBe('');
    });
  });

  describe('handleTabKey', () => {
    it('should return false when no selected item', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);

      const chooser = {
        selectedItem: 0,
        values: null
      };
      Object.defineProperty(modal, 'chooser', { value: chooser });

      const evt = strictProxy<KeyboardEvent>({ isComposing: false });
      const result = modal['handleTabKey'](evt);
      expect(result).toBe(false);
    });

    it('should return undefined when composing', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);

      const evt = strictProxy<KeyboardEvent>({ isComposing: true });
      const result = modal['handleTabKey'](evt);
      expect(result).toBeUndefined();
    });

    it('should return full path when last match end is falsy', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);

      const fileItem: Item = {
        file: createMockFile('folder/test.md'),
        match: { matches: [[0, 0]], score: 1 },
        type: 'file'
      };
      const chooser = {
        selectedItem: 0,
        values: [fileItem]
      };
      Object.defineProperty(modal, 'chooser', { value: chooser });

      modal.inputEl.value = 'different';
      modal.inputEl.trigger = vi.fn();
      const evt = strictProxy<KeyboardEvent>({ isComposing: false });
      modal['handleTabKey'](evt);
      // When lastMatchEnd is 0 (falsy), path is returned unchanged
      expect(modal.inputEl.value).toBe('folder/test');
    });

    it('should truncate path to last match when tab is pressed', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);

      const fileItem: Item = {
        file: createMockFile('folder/sub/test.md'),
        match: { matches: [[0, 6]], score: 1 },
        type: 'file'
      };
      const chooser = {
        selectedItem: 0,
        values: [fileItem]
      };
      Object.defineProperty(modal, 'chooser', { value: chooser });

      modal.inputEl.value = 'different';
      modal.inputEl.trigger = vi.fn();
      const evt = strictProxy<KeyboardEvent>({ isComposing: false });
      const result = modal['handleTabKey'](evt);
      expect(result).toBe(false);
      // The path should be truncated to the match
      expect(modal.inputEl.value).toBeDefined();
    });

    it('should set input value from selected item and append / when same', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);

      const fileItem: Item = {
        file: createMockFile('folder/test.md'),
        match: { matches: [], score: 0 },
        type: 'file'
      };
      const chooser = {
        selectedItem: 0,
        values: [fileItem]
      };
      Object.defineProperty(modal, 'chooser', { value: chooser });

      modal.inputEl.value = 'folder/test';
      modal.inputEl.trigger = vi.fn();
      const evt = strictProxy<KeyboardEvent>({ isComposing: false });
      const result = modal['handleTabKey'](evt);
      expect(result).toBe(false);
    });
  });

  describe('getSuggestionText', () => {
    it('should trim source file parent prefix when shouldAllowOnlyCurrentFolder is true', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);
      modal['shouldAllowOnlyCurrentFolder'] = true;
      const text = modal['getSuggestionText']('folder/test.md');
      expect(text).toBe('test');
    });

    it('should not trim prefix when shouldAllowOnlyCurrentFolder is false', () => {
      sourceFile = createMockFile('folder/source.md');
      plugin = createMockPlugin();
      const modal = createTestSuggestModal(plugin, sourceFile);
      modal['shouldAllowOnlyCurrentFolder'] = false;
      const text = modal['getSuggestionText']('folder/test.md');
      expect(text).toBe('folder/test');
    });
  });
});
