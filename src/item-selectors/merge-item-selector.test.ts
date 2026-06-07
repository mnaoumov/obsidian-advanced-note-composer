import type {
  App,
  TFile,
  TFolder
} from 'obsidian';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { Item } from '../modals/suggest-modal-base.ts';
import type { Plugin } from '../plugin.ts';

import { MergeItemSelector } from './merge-item-selector.ts';

function mockItem(partial: Record<string, unknown>): Item {
  return castTo<Item>(partial);
}

vi.mock('obsidian-dev-utils/path', () => ({
  join: vi.fn((...args: string[]) => args.join('/'))
}));

function createMockFile(path: string): TFile {
  return strictProxy<TFile>({
    path
  });
}

function createMockPlugin(overrides: Record<string, unknown> = {}): Plugin {
  const mockFile = createMockFile('folder/new-file.md');
  return strictProxy<Plugin>({
    app: strictProxy<App>({
      fileManager: strictProxy({
        createNewMarkdownFile: vi.fn().mockResolvedValue(mockFile),
        getNewFileParent: vi.fn().mockReturnValue(strictProxy<TFolder>({ path: 'folder' }))
      }),
      metadataCache: strictProxy({
        getFirstLinkpathDest: vi.fn().mockReturnValue(null)
      }),
      vault: strictProxy({
        getFileByPath: vi.fn()
      })
    }),
    pluginSettingsComponent: strictProxy({
      settings: {
        isPathIgnored: vi.fn().mockReturnValue(false),
        ...overrides
      }
    })
  });
}

describe('MergeItemSelector', () => {
  describe('selectItem', () => {
    it('should create new file when isMod is true', async () => {
      const plugin = createMockPlugin();
      const sourceFile = createMockFile('source.md');

      const selector = new MergeItemSelector({
        inputValue: 'new note',
        isMod: true,
        item: null,
        plugin,
        sourceFile
      });

      const result = await selector.selectItem();

      expect(result.isNewTargetFile).toBe(true);
      expect(plugin.app.fileManager.createNewMarkdownFile).toHaveBeenCalled();
    });

    it('should use linktext when item type is unresolved', async () => {
      const plugin = createMockPlugin();
      const sourceFile = createMockFile('source.md');
      const item = strictProxy<Item>({
        linktext: 'unresolved-link',
        type: 'unresolved'
      });

      const selector = new MergeItemSelector({
        inputValue: 'ignored',
        isMod: false,
        item,
        plugin,
        sourceFile
      });

      const result = await selector.selectItem();

      expect(result.isNewTargetFile).toBe(true);
      expect(plugin.app.fileManager.getNewFileParent).toHaveBeenCalledWith('source.md', 'unresolved-link');
      expect(plugin.app.fileManager.createNewMarkdownFile).toHaveBeenCalled();
    });

    it('should use empty string when unresolved item has no linktext', async () => {
      const plugin = createMockPlugin();
      const sourceFile = createMockFile('source.md');
      const item = mockItem({ type: 'unresolved' });

      const selector = new MergeItemSelector({
        inputValue: 'ignored',
        isMod: false,
        item,
        plugin,
        sourceFile
      });

      const result = await selector.selectItem();

      expect(result.isNewTargetFile).toBe(true);
      expect(plugin.app.fileManager.getNewFileParent).toHaveBeenCalledWith('source.md', '');
    });

    it('should return existing file when isMod and path is ignored', async () => {
      const existingFile = createMockFile('folder/existing.md');
      const plugin = createMockPlugin({
        isPathIgnored: vi.fn().mockReturnValue(true)
      });
      vi.mocked(plugin.app.metadataCache.getFirstLinkpathDest).mockReturnValue(existingFile);
      const sourceFile = createMockFile('source.md');

      const selector = new MergeItemSelector({
        inputValue: 'existing',
        isMod: true,
        item: null,
        plugin,
        sourceFile
      });

      const result = await selector.selectItem();

      expect(result.isNewTargetFile).toBe(false);
      expect(result.targetFile).toBe(existingFile);
    });

    it('should return bookmark file when item type is bookmark with file type', async () => {
      const bookmarkFile = createMockFile('bookmark-target.md');
      const plugin = createMockPlugin();
      vi.mocked(plugin.app.vault.getFileByPath).mockReturnValue(bookmarkFile);
      const sourceFile = createMockFile('source.md');
      const item = strictProxy<Item>({
        item: { path: 'bookmark-target.md', type: 'file' },
        type: 'bookmark'
      });

      const selector = new MergeItemSelector({
        inputValue: '',
        isMod: false,
        item,
        plugin,
        sourceFile
      });

      const result = await selector.selectItem();

      expect(result.isNewTargetFile).toBe(false);
      expect(result.targetFile).toBe(bookmarkFile);
    });

    it('should throw when bookmark file is not found', async () => {
      const plugin = createMockPlugin();
      vi.mocked(plugin.app.vault.getFileByPath).mockReturnValue(null);
      const sourceFile = createMockFile('source.md');
      const item = strictProxy<Item>({
        item: { path: 'missing.md', type: 'file' },
        type: 'bookmark'
      });

      const selector = new MergeItemSelector({
        inputValue: '',
        isMod: false,
        item,
        plugin,
        sourceFile
      });

      await expect(selector.selectItem()).rejects.toThrow('Bookmark file not found');
    });

    it('should return existing file when item has file property', async () => {
      const existingFile = createMockFile('existing.md');
      const plugin = createMockPlugin();
      const sourceFile = createMockFile('source.md');
      const item = strictProxy<Item>({
        file: existingFile,
        type: 'file'
      });

      const selector = new MergeItemSelector({
        inputValue: '',
        isMod: false,
        item,
        plugin,
        sourceFile
      });

      const result = await selector.selectItem();

      expect(result.isNewTargetFile).toBe(false);
      expect(result.targetFile).toBe(existingFile);
    });

    it('should throw when no valid file is selected', async () => {
      const plugin = createMockPlugin();
      const sourceFile = createMockFile('source.md');
      const item = mockItem({ file: null, item: { type: 'folder' }, type: 'bookmark' });

      const selector = new MergeItemSelector({
        inputValue: '',
        isMod: false,
        item,
        plugin,
        sourceFile
      });

      await expect(selector.selectItem()).rejects.toThrow('No valid file selected');
    });

    it('should use empty path when bookmark item has no path', async () => {
      const bookmarkFile = createMockFile('found.md');
      const plugin = createMockPlugin();
      vi.mocked(plugin.app.vault.getFileByPath).mockReturnValue(bookmarkFile);
      const sourceFile = createMockFile('source.md');
      const item = mockItem({ item: { type: 'file' }, type: 'bookmark' });

      const selector = new MergeItemSelector({
        inputValue: '',
        isMod: false,
        item,
        plugin,
        sourceFile
      });

      const result = await selector.selectItem();

      expect(plugin.app.vault.getFileByPath).toHaveBeenCalledWith('');
      expect(result.targetFile).toBe(bookmarkFile);
    });

    it('should throw when item is null and isMod is false', async () => {
      const plugin = createMockPlugin();
      const sourceFile = createMockFile('source.md');

      const selector = new MergeItemSelector({
        inputValue: '',
        isMod: false,
        item: null,
        plugin,
        sourceFile
      });

      await expect(selector.selectItem()).rejects.toThrow('No valid file selected');
    });
  });
});
