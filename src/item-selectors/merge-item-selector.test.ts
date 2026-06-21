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
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { MergeItemSelector } from './merge-item-selector.ts';

function createMockApp(): App {
  const mockFile = createMockFile('folder/new-file.md');
  return strictProxy<App>({
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
  });
}

function createMockFile(path: string): TFile {
  return strictProxy<TFile>({
    path
  });
}

function createMockPluginSettingsComponent(overrides: Record<string, unknown> = {}): PluginSettingsComponent {
  return strictProxy<PluginSettingsComponent>({
    settings: castTo({
      isPathIgnored: vi.fn().mockReturnValue(false),
      ...overrides
    })
  });
}

function mockItem(partial: Record<string, unknown>): Item {
  return castTo<Item>(partial);
}

describe('MergeItemSelector', () => {
  describe('selectItem', () => {
    it('should create new file when isMod is true', async () => {
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent();
      const sourceFile = createMockFile('source.md');

      const selector = new MergeItemSelector({
        app,
        inputValue: 'new note',
        isMod: true,
        item: null,
        pluginSettingsComponent,
        sourceFile
      });

      const result = await selector.selectItem();

      expect(result.isNewTargetFile).toBe(true);
      expect(app.fileManager.createNewMarkdownFile).toHaveBeenCalled();
    });

    it('should use linktext when item type is unresolved', async () => {
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent();
      const sourceFile = createMockFile('source.md');
      const item = strictProxy<Item>({
        linktext: 'unresolved-link',
        type: 'unresolved'
      });

      const selector = new MergeItemSelector({
        app,
        inputValue: 'ignored',
        isMod: false,
        item,
        pluginSettingsComponent,
        sourceFile
      });

      const result = await selector.selectItem();

      expect(result.isNewTargetFile).toBe(true);
      expect(app.fileManager.getNewFileParent).toHaveBeenCalledWith('source.md', 'unresolved-link');
      expect(app.fileManager.createNewMarkdownFile).toHaveBeenCalled();
    });

    it('should use empty string when unresolved item has no linktext', async () => {
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent();
      const sourceFile = createMockFile('source.md');
      const item = mockItem({ type: 'unresolved' });

      const selector = new MergeItemSelector({
        app,
        inputValue: 'ignored',
        isMod: false,
        item,
        pluginSettingsComponent,
        sourceFile
      });

      const result = await selector.selectItem();

      expect(result.isNewTargetFile).toBe(true);
      expect(app.fileManager.getNewFileParent).toHaveBeenCalledWith('source.md', '');
    });

    it('should return existing file when isMod and path is ignored', async () => {
      const existingFile = createMockFile('folder/existing.md');
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        isPathIgnored: vi.fn().mockReturnValue(true)
      });
      vi.mocked(app.metadataCache.getFirstLinkpathDest).mockReturnValue(existingFile);
      const sourceFile = createMockFile('source.md');

      const selector = new MergeItemSelector({
        app,
        inputValue: 'existing',
        isMod: true,
        item: null,
        pluginSettingsComponent,
        sourceFile
      });

      const result = await selector.selectItem();

      expect(result.isNewTargetFile).toBe(false);
      expect(result.targetFile).toBe(existingFile);
    });

    it('should return bookmark file when item type is bookmark with file type', async () => {
      const bookmarkFile = createMockFile('bookmark-target.md');
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent();
      vi.mocked(app.vault.getFileByPath).mockReturnValue(bookmarkFile);
      const sourceFile = createMockFile('source.md');
      const item = strictProxy<Item>({
        item: { path: 'bookmark-target.md', type: 'file' },
        type: 'bookmark'
      });

      const selector = new MergeItemSelector({
        app,
        inputValue: '',
        isMod: false,
        item,
        pluginSettingsComponent,
        sourceFile
      });

      const result = await selector.selectItem();

      expect(result.isNewTargetFile).toBe(false);
      expect(result.targetFile).toBe(bookmarkFile);
    });

    it('should throw when bookmark file is not found', async () => {
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent();
      vi.mocked(app.vault.getFileByPath).mockReturnValue(null);
      const sourceFile = createMockFile('source.md');
      const item = strictProxy<Item>({
        item: { path: 'missing.md', type: 'file' },
        type: 'bookmark'
      });

      const selector = new MergeItemSelector({
        app,
        inputValue: '',
        isMod: false,
        item,
        pluginSettingsComponent,
        sourceFile
      });

      await expect(selector.selectItem()).rejects.toThrow('Bookmark file not found');
    });

    it('should return existing file when item has file property', async () => {
      const existingFile = createMockFile('existing.md');
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent();
      const sourceFile = createMockFile('source.md');
      const item = strictProxy<Item>({
        file: existingFile,
        type: 'file'
      });

      const selector = new MergeItemSelector({
        app,
        inputValue: '',
        isMod: false,
        item,
        pluginSettingsComponent,
        sourceFile
      });

      const result = await selector.selectItem();

      expect(result.isNewTargetFile).toBe(false);
      expect(result.targetFile).toBe(existingFile);
    });

    it('should throw when no valid file is selected', async () => {
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent();
      const sourceFile = createMockFile('source.md');
      const item = mockItem({ file: null, item: { type: 'folder' }, type: 'bookmark' });

      const selector = new MergeItemSelector({
        app,
        inputValue: '',
        isMod: false,
        item,
        pluginSettingsComponent,
        sourceFile
      });

      await expect(selector.selectItem()).rejects.toThrow('No valid file selected');
    });

    it('should use empty path when bookmark item has no path', async () => {
      const bookmarkFile = createMockFile('found.md');
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent();
      vi.mocked(app.vault.getFileByPath).mockReturnValue(bookmarkFile);
      const sourceFile = createMockFile('source.md');
      const item = mockItem({ item: { type: 'file' }, type: 'bookmark' });

      const selector = new MergeItemSelector({
        app,
        inputValue: '',
        isMod: false,
        item,
        pluginSettingsComponent,
        sourceFile
      });

      const result = await selector.selectItem();

      expect(app.vault.getFileByPath).toHaveBeenCalledWith('');
      expect(result.targetFile).toBe(bookmarkFile);
    });

    it('should throw when item is null and isMod is false', async () => {
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent();
      const sourceFile = createMockFile('source.md');

      const selector = new MergeItemSelector({
        app,
        inputValue: '',
        isMod: false,
        item: null,
        pluginSettingsComponent,
        sourceFile
      });

      await expect(selector.selectItem()).rejects.toThrow('No valid file selected');
    });
  });
});
