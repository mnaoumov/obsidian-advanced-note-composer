import type {
  App,
  TFile,
  TFolder
} from 'obsidian';

import { noopAsync } from 'obsidian-dev-utils/function';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { Frontmatter } from '../frontmatter-merge.ts';
import type { Item } from '../modals/suggest-modal-base.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';

import {
  FrontmatterTitleMode,
  SplitTargetMode
} from '../plugin-settings.ts';
import { SplitItemSelector } from './split-item-selector.ts';

function mockItem(partial: Record<string, unknown>): Item {
  return castTo<Item>(partial);
}

const mockAddAlias = vi.fn();

vi.mock('obsidian-dev-utils/obsidian/file-manager', () => ({
  addAlias: (...$arguments: unknown[]): unknown => mockAddAlias(...$arguments)
}));

vi.mock('../plugin-settings.ts', () => ({
  FrontmatterTitleMode: {
    None: 'None',
    UseAlways: 'UseAlways',
    UseForInvalidTitleOnly: 'UseForInvalidTitleOnly'
  },
  SplitTargetMode: {
    Create: 'Create',
    Merge: 'Merge'
  }
}));

interface SettingsOverrides {
  frontmatterTitleMode?: string;
  isPathIgnored?: ReturnType<typeof vi.fn>;
  nameTransformTemplate?: string;
  replacement?: string;
  shouldAddInvalidTitleToNoteAlias?: boolean;
  shouldReplaceInvalidTitleCharacters?: boolean;
  shouldSplitIntoFolder?: boolean;
  splitIntoFolderNoteNameTemplate?: string;
}

function createMockApp(): App {
  const mockFile = createMockFile('new-file', 'folder/new-file.md');
  const processFrontMatter = vi.fn().mockImplementation(
    (_file: TFile, callback: (frontmatter: Frontmatter) => void): Promise<void> => {
      callback({ title: '' });
      return noopAsync();
    }
  );

  return strictProxy<App>({
    fileManager: strictProxy({
      createNewMarkdownFileFromLinktext: vi.fn().mockResolvedValue(mockFile),
      processFrontMatter,
      renameFile: vi.fn(() => noopAsync())
    }),
    metadataCache: strictProxy({
      // eslint-disable-next-line unicorn/name-replacements -- `getFirstLinkpathDest` is an Obsidian `MetadataCache` method name.
      getFirstLinkpathDest: vi.fn().mockReturnValue(null)
    }),
    vault: strictProxy({
      adapter: strictProxy({
        exists: vi.fn().mockResolvedValue(false)
      }),
      createFolder: vi.fn().mockResolvedValue(null),
      getAbstractFileByPath: vi.fn().mockReturnValue(null),
      getFileByPath: vi.fn().mockReturnValue(null)
    })
  });
}

function createMockFile(basename: string, path?: string, parentPath?: null | string): TFile {
  const resolvedPath = path ?? `folder/${basename}.md`;
  return strictProxy<TFile>({
    basename,
    name: `${basename}.md`,
    parent: parentPath === null
      ? null
      : strictProxy({ path: parentPath ?? 'folder' }),
    path: resolvedPath
  });
}

function createMockPluginSettingsComponent(settingsOverrides: SettingsOverrides = {}): PluginSettingsComponent {
  return strictProxy<PluginSettingsComponent>({
    settings: castTo<PluginSettings>({
      frontmatterTitleMode: FrontmatterTitleMode.UseForInvalidTitleOnly,
      isPathIgnored: vi.fn().mockReturnValue(false),
      nameTransformTemplate: '',
      reorderedFolderNameTemplate: '{{index}}. {{safeFolderName}}',
      replacement: '_',
      shouldAddInvalidTitleToNoteAlias: true,
      shouldReplaceInvalidTitleCharacters: true,
      shouldSplitIntoFolder: false,
      splitIntoFolderNoteNameTemplate: '',
      ...settingsOverrides
    })
  });
}

describe('SplitItemSelector', () => {
  describe('selectItem', () => {
    it('should create new file in create mode even when an existing note is highlighted', async () => {
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent();
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'new note',
        isModifier: false,
        item: strictProxy<Item>({ file: createMockFile('existing', 'folder/existing.md'), type: 'file' }),
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      const result = await selector.selectItem();

      expect(result.isNewTargetFile).toBe(true);
      expect(app.fileManager.createNewMarkdownFileFromLinktext).toHaveBeenCalled();
    });

    it('should ignore isModifier, which the create/merge switch replaced', async () => {
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent();
      const sourceFile = createMockFile('source', 'source.md');
      const existingFile = createMockFile('existing', 'folder/existing.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'new note',
        isModifier: true,
        item: strictProxy<Item>({ file: existingFile, type: 'file' }),
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Merge
      });

      const result = await selector.selectItem();

      expect(result.isNewTargetFile).toBe(false);
      expect(result.targetFile).toBe(existingFile);
    });

    it('should return the bookmarked note in merge mode', async () => {
      const bookmarkedFile = createMockFile('bookmarked', 'folder/bookmarked.md');
      const app = createMockApp();
      vi.mocked(app.vault.getFileByPath).mockReturnValue(bookmarkedFile);
      const pluginSettingsComponent = createMockPluginSettingsComponent();
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: '',
        isModifier: false,
        item: mockItem({
          item: { path: 'folder/bookmarked.md', type: 'file' },
          type: 'bookmark'
        }),
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Merge
      });

      const result = await selector.selectItem();

      expect(result.isNewTargetFile).toBe(false);
      expect(result.targetFile).toBe(bookmarkedFile);
    });

    it('should use an empty path when a bookmark item has none', async () => {
      const bookmarkedFile = createMockFile('bookmarked', 'folder/bookmarked.md');
      const app = createMockApp();
      vi.mocked(app.vault.getFileByPath).mockReturnValue(bookmarkedFile);
      const pluginSettingsComponent = createMockPluginSettingsComponent();
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: '',
        isModifier: false,
        item: mockItem({
          item: { type: 'file' },
          type: 'bookmark'
        }),
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Merge
      });

      await selector.selectItem();

      expect(app.vault.getFileByPath).toHaveBeenCalledWith('');
    });

    it('should throw in merge mode when the bookmarked note no longer exists', async () => {
      const app = createMockApp();
      vi.mocked(app.vault.getFileByPath).mockReturnValue(null);
      const pluginSettingsComponent = createMockPluginSettingsComponent();
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: '',
        isModifier: false,
        item: mockItem({
          item: { path: 'folder/gone.md', type: 'file' },
          type: 'bookmark'
        }),
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Merge
      });

      await expect(selector.selectItem()).rejects.toThrow('File not found');
    });

    it('should throw in merge mode when nothing is selected', async () => {
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent();
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'new note',
        isModifier: false,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Merge
      });

      await expect(selector.selectItem()).rejects.toThrow('File not found');
    });

    it('should throw in merge mode when an unresolved link is selected', async () => {
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent();
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'unresolved-link',
        isModifier: false,
        item: mockItem({ linktext: 'unresolved-link', type: 'unresolved' }),
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Merge
      });

      await expect(selector.selectItem()).rejects.toThrow('File not found');
    });

    it('should create new file when item is null', async () => {
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent();
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'new note',
        isModifier: false,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      const result = await selector.selectItem();

      expect(result.isNewTargetFile).toBe(true);
      expect(app.fileManager.createNewMarkdownFileFromLinktext).toHaveBeenCalled();
    });

    it('should return existing file when path is ignored', async () => {
      const existingFile = createMockFile('existing', 'folder/existing.md');
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        isPathIgnored: vi.fn().mockReturnValue(true)
      });
      vi.mocked(app.metadataCache.getFirstLinkpathDest).mockReturnValue(existingFile);
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'existing',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      const result = await selector.selectItem();

      expect(result.isNewTargetFile).toBe(false);
      expect(result.targetFile).toBe(existingFile);
    });

    it('should create file from linktext when item type is unresolved', async () => {
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent();
      const sourceFile = createMockFile('source', 'source.md');
      const item = strictProxy<Item>({
        linktext: 'unresolved-link',
        type: 'unresolved'
      });

      const selector = new SplitItemSelector({
        app,
        inputValue: 'ignored',
        isModifier: false,
        item,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      const result = await selector.selectItem();

      expect(result.isNewTargetFile).toBe(true);
    });

    it('should use empty string when unresolved item has no linktext', async () => {
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent();
      const sourceFile = createMockFile('source', 'source.md');
      const item = mockItem({ type: 'unresolved' });

      const selector = new SplitItemSelector({
        app,
        inputValue: 'ignored',
        isModifier: false,
        item,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      const result = await selector.selectItem();

      expect(result.isNewTargetFile).toBe(true);
    });

    it('should return existing file when item type is file with file property', async () => {
      const existingFile = createMockFile('existing', 'existing.md');
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent();
      const sourceFile = createMockFile('source', 'source.md');
      const item = strictProxy<Item>({
        file: existingFile,
        type: 'file'
      });

      const selector = new SplitItemSelector({
        app,
        inputValue: '',
        isModifier: false,
        item,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Merge
      });

      const result = await selector.selectItem();

      expect(result.isNewTargetFile).toBe(false);
      expect(result.targetFile).toBe(existingFile);
    });

    it('should return existing file when item type is alias with file property', async () => {
      const existingFile = createMockFile('existing', 'existing.md');
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent();
      const sourceFile = createMockFile('source', 'source.md');
      const item = strictProxy<Item>({
        file: existingFile,
        type: 'alias'
      });

      const selector = new SplitItemSelector({
        app,
        inputValue: '',
        isModifier: false,
        item,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Merge
      });

      const result = await selector.selectItem();

      expect(result.isNewTargetFile).toBe(false);
      expect(result.targetFile).toBe(existingFile);
    });

    it('should throw when item type is file without file property', async () => {
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent();
      const sourceFile = createMockFile('source', 'source.md');
      const item = mockItem({ type: 'file' });

      const selector = new SplitItemSelector({
        app,
        inputValue: '',
        isModifier: false,
        item,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Merge
      });

      await expect(selector.selectItem()).rejects.toThrow('File not found');
    });

    it('should throw when item type is alias without file property', async () => {
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent();
      const sourceFile = createMockFile('source', 'source.md');
      const item = mockItem({ type: 'alias' });

      const selector = new SplitItemSelector({
        app,
        inputValue: '',
        isModifier: false,
        item,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Merge
      });

      await expect(selector.selectItem()).rejects.toThrow('File not found');
    });

    it('should create new file for default case (unknown item type)', async () => {
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent();
      const sourceFile = createMockFile('source', 'source.md');
      const item = strictProxy<Item>({
        type: 'bookmark'
      });

      const selector = new SplitItemSelector({
        app,
        inputValue: 'new note',
        isModifier: false,
        item,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      const result = await selector.selectItem();

      expect(result.isNewTargetFile).toBe(true);
    });
  });

  describe('createNewMarkdownFileFromLinktext', () => {
    it('should trim .md extension from filename', async () => {
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        shouldAddInvalidTitleToNoteAlias: false
      });
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'test.md',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      await selector.selectItem();

      expect(app.fileManager.createNewMarkdownFileFromLinktext).toHaveBeenCalledWith(
        'test.md',
        'source.md'
      );
    });

    it('should add alias when title is invalid and shouldAddInvalidTitleToNoteAlias is true', async () => {
      const invalidFile = createMockFile('fixed_name', 'folder/fixed_name.md');
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        shouldAddInvalidTitleToNoteAlias: true
      });
      vi.mocked(app.fileManager.createNewMarkdownFileFromLinktext).mockResolvedValue(invalidFile);
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'invalid*name',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      await selector.selectItem();

      expect(mockAddAlias).toHaveBeenCalledWith({ alias: 'invalid*name', app, pathOrFile: invalidFile, resourceLockComponent: null });
    });

    it('should not add alias when title is valid', async () => {
      mockAddAlias.mockClear();
      const validFile = createMockFile('valid-name', 'folder/valid-name.md');
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        shouldAddInvalidTitleToNoteAlias: true
      });
      vi.mocked(app.fileManager.createNewMarkdownFileFromLinktext).mockResolvedValue(validFile);
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'valid-name',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      await selector.selectItem();

      expect(mockAddAlias).not.toHaveBeenCalled();
    });

    it('should not add alias when shouldAddInvalidTitleToNoteAlias is false', async () => {
      mockAddAlias.mockClear();
      const invalidFile = createMockFile('fixed_name', 'folder/fixed_name.md');
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        shouldAddInvalidTitleToNoteAlias: false
      });
      vi.mocked(app.fileManager.createNewMarkdownFileFromLinktext).mockResolvedValue(invalidFile);
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'invalid*name',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      await selector.selectItem();

      expect(mockAddAlias).not.toHaveBeenCalled();
    });

    it('should not add title to frontmatter when mode is None', async () => {
      const invalidFile = createMockFile('fixed_name', 'folder/fixed_name.md');
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        frontmatterTitleMode: 'None',
        shouldAddInvalidTitleToNoteAlias: false
      });
      vi.mocked(app.fileManager.createNewMarkdownFileFromLinktext).mockResolvedValue(invalidFile);
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'invalid*name',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      await selector.selectItem();

      expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
    });

    it('should add title to frontmatter when mode is UseAlways', async () => {
      const validFile = createMockFile('valid-name', 'folder/valid-name.md');
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        frontmatterTitleMode: 'UseAlways',
        shouldAddInvalidTitleToNoteAlias: false
      });
      vi.mocked(app.fileManager.createNewMarkdownFileFromLinktext).mockResolvedValue(validFile);
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'valid-name',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      await selector.selectItem();

      expect(app.fileManager.processFrontMatter).toHaveBeenCalledWith(validFile, expect.any(Function));
    });

    it('should add title to frontmatter when mode is UseForInvalidTitleOnly and title is invalid', async () => {
      const invalidFile = createMockFile('fixed_name', 'folder/fixed_name.md');
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        frontmatterTitleMode: 'UseForInvalidTitleOnly',
        shouldAddInvalidTitleToNoteAlias: false
      });
      vi.mocked(app.fileManager.createNewMarkdownFileFromLinktext).mockResolvedValue(invalidFile);
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'invalid*name',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      await selector.selectItem();

      expect(app.fileManager.processFrontMatter).toHaveBeenCalledWith(invalidFile, expect.any(Function));
    });

    it('should not add title to frontmatter when mode is UseForInvalidTitleOnly and title is valid', async () => {
      const validFile = createMockFile('valid-name', 'folder/valid-name.md');
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        frontmatterTitleMode: 'UseForInvalidTitleOnly',
        shouldAddInvalidTitleToNoteAlias: false
      });
      vi.mocked(app.fileManager.createNewMarkdownFileFromLinktext).mockResolvedValue(validFile);
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'valid-name',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      await selector.selectItem();

      expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
    });

    it('should throw for invalid frontmatter title mode', async () => {
      const invalidFile = createMockFile('fixed_name', 'folder/fixed_name.md');
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        frontmatterTitleMode: 'InvalidMode',
        shouldAddInvalidTitleToNoteAlias: false
      });
      vi.mocked(app.fileManager.createNewMarkdownFileFromLinktext).mockResolvedValue(invalidFile);
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'invalid*name',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      await expect(selector.selectItem()).rejects.toThrow('Invalid frontmatter title mode: InvalidMode');
    });

    it('should use the target parent override in preference to the source folder (issue #205)', async () => {
      // The recursive split's "Change target" names a root that is neither the source's own folder nor
      // Obsidian's default new-note location, so it has to beat both branches.
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        shouldAddInvalidTitleToNoteAlias: false
      });
      const sourceFile = strictProxy<TFile>({
        basename: 'source',
        parent: strictProxy({
          getParentPrefix: vi.fn().mockReturnValue('my-folder/')
        }),
        path: 'my-folder/source.md'
      });

      const selector = new SplitItemSelector({
        app,
        inputValue: 'new-note',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        // `true` would otherwise force `my-folder/`; the override wins.
        shouldAllowOnlyCurrentFolder: true,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create,
        targetParentFolderOverride: strictProxy<TFolder>({
          getParentPrefix: vi.fn().mockReturnValue('picked/')
        })
      });

      await selector.selectItem();

      expect(app.fileManager.createNewMarkdownFileFromLinktext).toHaveBeenCalledWith(
        '/picked/new-note.md',
        'my-folder/source.md'
      );
    });

    it('should use prefix when shouldAllowOnlyCurrentFolder is true', async () => {
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        shouldAddInvalidTitleToNoteAlias: false
      });
      const sourceFile = strictProxy<TFile>({
        basename: 'source',
        parent: strictProxy({
          getParentPrefix: vi.fn().mockReturnValue('my-folder/')
        }),
        path: 'my-folder/source.md'
      });

      const selector = new SplitItemSelector({
        app,
        inputValue: 'new-note',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: true,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      await selector.selectItem();

      expect(app.fileManager.createNewMarkdownFileFromLinktext).toHaveBeenCalledWith(
        '/my-folder/new-note.md',
        'my-folder/source.md'
      );
    });

    it('should use empty prefix when shouldAllowOnlyCurrentFolder is true but parent is null', async () => {
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        shouldAddInvalidTitleToNoteAlias: false
      });
      const sourceFile = strictProxy<TFile>({
        basename: 'source',
        parent: null,
        path: 'source.md'
      });

      const selector = new SplitItemSelector({
        app,
        inputValue: 'new-note',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: true,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      await selector.selectItem();

      expect(app.fileManager.createNewMarkdownFileFromLinktext).toHaveBeenCalledWith(
        '/new-note.md',
        'source.md'
      );
    });

    it('should set title on frontmatter object in processFrontMatter callback', async () => {
      const validFile = createMockFile('valid-name', 'folder/valid-name.md');
      const capturedFrontmatter: Frontmatter = { title: '' };
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        frontmatterTitleMode: 'UseAlways',
        shouldAddInvalidTitleToNoteAlias: false
      });
      vi.mocked(app.fileManager.processFrontMatter).mockImplementation(
        (_file: TFile, callback: (frontmatter: Frontmatter) => void): Promise<void> => {
          callback(capturedFrontmatter);
          return noopAsync();
        }
      );
      vi.mocked(app.fileManager.createNewMarkdownFileFromLinktext).mockResolvedValue(validFile);
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'valid-name',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      await selector.selectItem();

      expect(capturedFrontmatter.title).toBe('valid-name');
    });
  });

  describe('fixFileName', () => {
    it('should return Untitled for empty filename', async () => {
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        shouldAddInvalidTitleToNoteAlias: false
      });
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: '',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      await selector.selectItem();

      expect(app.fileManager.createNewMarkdownFileFromLinktext).toHaveBeenCalledWith(
        'Untitled.md',
        'source.md'
      );
    });

    it('should replace forward slashes with backslashes when shouldTreatTitleAsPath is false', async () => {
      const fixedFile = createMockFile(String.raw`a\b`, String.raw`folder/a\b.md`);
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        shouldAddInvalidTitleToNoteAlias: false,
        shouldReplaceInvalidTitleCharacters: false
      });
      vi.mocked(app.fileManager.createNewMarkdownFileFromLinktext).mockResolvedValue(fixedFile);
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'a/b',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: false,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      await selector.selectItem();

      expect(app.fileManager.createNewMarkdownFileFromLinktext).toHaveBeenCalledWith(
        String.raw`a\b.md`,
        'source.md'
      );
    });

    it('should return filename as-is when shouldReplaceInvalidTitleCharacters is false', async () => {
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        shouldAddInvalidTitleToNoteAlias: false,
        shouldReplaceInvalidTitleCharacters: false
      });
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'my-file',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      await selector.selectItem();

      expect(app.fileManager.createNewMarkdownFileFromLinktext).toHaveBeenCalledWith(
        'my-file.md',
        'source.md'
      );
    });

    it('should replace invalid characters with replacement string', async () => {
      const fixedFile = createMockFile('file_name', 'folder/file_name.md');
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        replacement: '_',
        shouldAddInvalidTitleToNoteAlias: false
      });
      vi.mocked(app.fileManager.createNewMarkdownFileFromLinktext).mockResolvedValue(fixedFile);
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'file*name',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      await selector.selectItem();

      expect(app.fileManager.createNewMarkdownFileFromLinktext).toHaveBeenCalledWith(
        'file_name.md',
        'source.md'
      );
    });

    it('should replace trailing dots and spaces', async () => {
      const fixedFile = createMockFile('file__', 'folder/file__.md');
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        replacement: '_',
        shouldAddInvalidTitleToNoteAlias: false
      });
      vi.mocked(app.fileManager.createNewMarkdownFileFromLinktext).mockResolvedValue(fixedFile);
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'file..',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      await selector.selectItem();

      expect(app.fileManager.createNewMarkdownFileFromLinktext).toHaveBeenCalledWith(
        'file__.md',
        'source.md'
      );
    });

    it('should fix leading dots', async () => {
      const fixedFile = createMockFile('_hidden', 'folder/_hidden.md');
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        replacement: '_',
        shouldAddInvalidTitleToNoteAlias: false
      });
      vi.mocked(app.fileManager.createNewMarkdownFileFromLinktext).mockResolvedValue(fixedFile);
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: '.hidden',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      await selector.selectItem();

      expect(app.fileManager.createNewMarkdownFileFromLinktext).toHaveBeenCalledWith(
        '_hidden.md',
        'source.md'
      );
    });

    it('should fix leading spaces', async () => {
      const fixedFile = createMockFile('_spaced', 'folder/_spaced.md');
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        replacement: '_',
        shouldAddInvalidTitleToNoteAlias: false
      });
      vi.mocked(app.fileManager.createNewMarkdownFileFromLinktext).mockResolvedValue(fixedFile);
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: ' spaced',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      await selector.selectItem();

      expect(app.fileManager.createNewMarkdownFileFromLinktext).toHaveBeenCalledWith(
        '_spaced.md',
        'source.md'
      );
    });

    it('should handle path with multiple segments', async () => {
      const fixedFile = createMockFile('file', 'folder/a/b/file.md');
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        replacement: '_',
        shouldAddInvalidTitleToNoteAlias: false
      });
      vi.mocked(app.fileManager.createNewMarkdownFileFromLinktext).mockResolvedValue(fixedFile);
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'a/b/file',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      await selector.selectItem();

      expect(app.fileManager.createNewMarkdownFileFromLinktext).toHaveBeenCalledWith(
        'a/b/file.md',
        'source.md'
      );
    });

    it('should filter out empty path segments', async () => {
      const fixedFile = createMockFile('file', 'folder/a/file.md');
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        replacement: '_',
        shouldAddInvalidTitleToNoteAlias: false
      });
      vi.mocked(app.fileManager.createNewMarkdownFileFromLinktext).mockResolvedValue(fixedFile);
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'a//file',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      await selector.selectItem();

      expect(app.fileManager.createNewMarkdownFileFromLinktext).toHaveBeenCalledWith(
        'a/file.md',
        'source.md'
      );
    });

    it('should replace multiple invalid characters with repeated replacement', async () => {
      const fixedFile = createMockFile('f___n', 'folder/f___n.md');
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        replacement: '_',
        shouldAddInvalidTitleToNoteAlias: false
      });
      vi.mocked(app.fileManager.createNewMarkdownFileFromLinktext).mockResolvedValue(fixedFile);
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'f***n',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      await selector.selectItem();

      expect(app.fileManager.createNewMarkdownFileFromLinktext).toHaveBeenCalledWith(
        'f___n.md',
        'source.md'
      );
    });
  });

  describe('shouldSplitIntoFolder', () => {
    it('should not move the new note into a folder when the setting is off', async () => {
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        shouldAddInvalidTitleToNoteAlias: false,
        shouldSplitIntoFolder: false
      });
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'new-note',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      await selector.selectItem();

      expect(app.fileManager.renameFile).not.toHaveBeenCalled();
      expect(app.vault.createFolder).not.toHaveBeenCalled();
    });

    it('should move the new note into a new folder named after it when the setting is on', async () => {
      const newFile = createMockFile('new-file', 'folder/new-file.md');
      const app = createMockApp();
      vi.mocked(app.fileManager.createNewMarkdownFileFromLinktext).mockResolvedValue(newFile);
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        shouldAddInvalidTitleToNoteAlias: false,
        shouldSplitIntoFolder: true
      });
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'new-file',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      await selector.selectItem();

      expect(app.vault.createFolder).toHaveBeenCalledWith('folder/new-file');
      expect(app.fileManager.renameFile).toHaveBeenCalledWith(newFile, 'folder/new-file/new-file.md');
    });

    it('should move the new note into a folder when the caller forces it, even with the setting off', async () => {
      // The recursive split (issue #79) builds a folder tree, which IS the feature, so it cannot be at the
      // Mercy of `Should split into folder`.
      const newFile = createMockFile('new-file', 'folder/new-file.md');
      const app = createMockApp();
      vi.mocked(app.fileManager.createNewMarkdownFileFromLinktext).mockResolvedValue(newFile);
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        shouldAddInvalidTitleToNoteAlias: false,
        shouldSplitIntoFolder: false
      });
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'new-file',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldForceSplitIntoFolder: true,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      await selector.selectItem();

      expect(app.vault.createFolder).toHaveBeenCalledWith('folder/new-file');
      expect(app.fileManager.renameFile).toHaveBeenCalledWith(newFile, 'folder/new-file/new-file.md');
    });

    it('should de-duplicate the folder name when a folder with that name already exists', async () => {
      const newFile = createMockFile('new-file', 'folder/new-file.md');
      const app = createMockApp();
      vi.mocked(app.fileManager.createNewMarkdownFileFromLinktext).mockResolvedValue(newFile);
      const occupiedPaths = new Set(['folder/new-file', 'folder/new-file 1']);
      vi.mocked(app.vault.getAbstractFileByPath).mockImplementation((path: string) => occupiedPaths.has(path) ? castTo<TFile>({}) : null);
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        shouldAddInvalidTitleToNoteAlias: false,
        shouldSplitIntoFolder: true
      });
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'new-file',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      await selector.selectItem();

      expect(app.vault.createFolder).toHaveBeenCalledWith('folder/new-file 2');
      expect(app.fileManager.renameFile).toHaveBeenCalledWith(newFile, 'folder/new-file 2/new-file.md');
    });

    it('should place the folder at the vault root when the new note has no parent', async () => {
      const newFile = createMockFile('new-file', 'new-file.md', null);
      const app = createMockApp();
      vi.mocked(app.fileManager.createNewMarkdownFileFromLinktext).mockResolvedValue(newFile);
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        shouldAddInvalidTitleToNoteAlias: false,
        shouldSplitIntoFolder: true
      });
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'new-file',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile,
        splitTargetMode: SplitTargetMode.Create
      });

      await selector.selectItem();

      expect(app.vault.createFolder).toHaveBeenCalledWith('new-file');
      expect(app.fileManager.renameFile).toHaveBeenCalledWith(newFile, 'new-file/new-file.md');
    });
  });

  describe('splitIntoFolderNoteNameTemplate', () => {
    interface CreateSelectorOptions {
      readonly inputValue?: string;

      /**
       * The base name of the note the picker creates, which is also the name its own folder takes. A
       * numbered one is what gives `{{index}}` / `{{safeFolderName}}` something to read (issue #227).
       */
      readonly newFileBasename?: string;

      readonly settingsOverrides?: SettingsOverrides;
    }

    interface CreateSelectorResult {
      readonly app: App;
      readonly newFile: TFile;
      readonly selector: SplitItemSelector;
    }

    function createSelector(options: CreateSelectorOptions = {}): CreateSelectorResult {
      const newFileBasename = options.newFileBasename ?? 'new-file';
      const newFile = createMockFile(newFileBasename, `folder/${newFileBasename}.md`);
      const app = createMockApp();
      vi.mocked(app.fileManager.createNewMarkdownFileFromLinktext).mockResolvedValue(newFile);
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        shouldAddInvalidTitleToNoteAlias: false,
        shouldSplitIntoFolder: true,
        ...options.settingsOverrides
      });

      const selector = new SplitItemSelector({
        app,
        inputValue: options.inputValue ?? 'new-file',
        isModifier: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile: createMockFile('source', 'source.md'),
        splitTargetMode: SplitTargetMode.Create
      });

      return { app, newFile, selector };
    }

    it('should name the note after the template instead of the folder', async () => {
      const { app, newFile, selector } = createSelector({ settingsOverrides: { splitIntoFolderNoteNameTemplate: 'Overview' } });

      await selector.selectItem();

      expect(app.vault.createFolder).toHaveBeenCalledWith('folder/new-file');
      expect(app.fileManager.renameFile).toHaveBeenCalledWith(newFile, 'folder/new-file/Overview.md');
    });

    it('should keep the folder name when the template is empty', async () => {
      const { app, newFile, selector } = createSelector({ settingsOverrides: { splitIntoFolderNoteNameTemplate: '' } });

      await selector.selectItem();

      expect(app.fileManager.renameFile).toHaveBeenCalledWith(newFile, 'folder/new-file/new-file.md');
    });

    it('should resolve the newTitle token to the folder name', async () => {
      const { app, newFile, selector } = createSelector({ settingsOverrides: { splitIntoFolderNoteNameTemplate: '{{newTitle}} index' } });

      await selector.selectItem();

      expect(app.fileManager.renameFile).toHaveBeenCalledWith(newFile, 'folder/new-file/new-file index.md');
    });

    it('should resolve the fromTitle token against the source note', async () => {
      const { app, newFile, selector } = createSelector({ settingsOverrides: { splitIntoFolderNoteNameTemplate: 'From {{fromTitle}}' } });

      await selector.selectItem();

      expect(app.fileManager.renameFile).toHaveBeenCalledWith(newFile, 'folder/new-file/From source.md');
    });

    // Issue #227. The note has not been renamed into its folder yet at this point, so a folder token left
    // To resolve against the note's own parent would name `folder` — the folder ABOVE the one being
    // Created, which is never what a name for a note inside it means.
    it('should resolve the folder tokens against the folder being created, not the note\'s current parent', async () => {
      const { app, newFile, selector } = createSelector({ settingsOverrides: { splitIntoFolderNoteNameTemplate: '{{folderName}} notes' } });

      await selector.selectItem();

      expect(app.fileManager.renameFile).toHaveBeenCalledWith(newFile, 'folder/new-file/new-file notes.md');
    });

    it('should read the index and un-numbered name of the folder being created', async () => {
      const { app, newFile, selector } = createSelector({
        newFileBasename: '7. Beta',
        settingsOverrides: { splitIntoFolderNoteNameTemplate: '{{index:00}} {{safeFolderName}}' }
      });

      await selector.selectItem();

      expect(app.fileManager.renameFile).toHaveBeenCalledWith(newFile, 'folder/7. Beta/07 Beta.md');
    });

    it('should trim a trailing markdown extension from the resolved name', async () => {
      const { app, newFile, selector } = createSelector({ settingsOverrides: { splitIntoFolderNoteNameTemplate: 'Overview.md' } });

      await selector.selectItem();

      expect(app.fileManager.renameFile).toHaveBeenCalledWith(newFile, 'folder/new-file/Overview.md');
    });

    it('should fall back to the folder name when the template resolves to blank', async () => {
      const { app, newFile, selector } = createSelector({ settingsOverrides: { splitIntoFolderNoteNameTemplate: '  {{content}}  ' } });

      await selector.selectItem();

      expect(app.fileManager.renameFile).toHaveBeenCalledWith(newFile, 'folder/new-file/new-file.md');
    });

    it('should replace invalid characters in the resolved name', async () => {
      const { app, newFile, selector } = createSelector({ settingsOverrides: { splitIntoFolderNoteNameTemplate: '{{newPath}}' } });

      await selector.selectItem();

      expect(app.fileManager.renameFile).toHaveBeenCalledWith(newFile, 'folder/new-file/folder_new-file.md');
    });

    it('should fall back to the folder name when sanitization is off and the resolved name spans folders', async () => {
      const { app, newFile, selector } = createSelector({
        settingsOverrides: {
          shouldReplaceInvalidTitleCharacters: false,
          splitIntoFolderNoteNameTemplate: '{{newPath}}'
        }
      });

      await selector.selectItem();

      expect(app.fileManager.renameFile).toHaveBeenCalledWith(newFile, 'folder/new-file/new-file.md');
    });

    it('should ignore the template when splitting into a folder is off', async () => {
      const { app, selector } = createSelector({
        settingsOverrides: {
          shouldSplitIntoFolder: false,
          splitIntoFolderNoteNameTemplate: 'Overview'
        }
      });

      await selector.selectItem();

      expect(app.fileManager.renameFile).not.toHaveBeenCalled();
    });

    it('should record the note name it would have had as an alias and a frontmatter title', async () => {
      mockAddAlias.mockClear();
      const { app, newFile, selector } = createSelector({
        settingsOverrides: {
          shouldAddInvalidTitleToNoteAlias: true,
          splitIntoFolderNoteNameTemplate: 'Overview'
        }
      });

      await selector.selectItem();

      expect(mockAddAlias).toHaveBeenCalledWith({ alias: 'new-file', app, pathOrFile: newFile, resourceLockComponent: null });
      expect(app.fileManager.processFrontMatter).toHaveBeenCalledWith(newFile, expect.any(Function));
    });

    it('should record no alias when the template reproduces the folder name', async () => {
      mockAddAlias.mockClear();
      const { app, selector } = createSelector({
        settingsOverrides: {
          shouldAddInvalidTitleToNoteAlias: true,
          splitIntoFolderNoteNameTemplate: '{{newTitle}}'
        }
      });

      await selector.selectItem();

      expect(mockAddAlias).not.toHaveBeenCalled();
      expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
    });
  });
});
