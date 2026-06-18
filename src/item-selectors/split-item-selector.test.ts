import type {
  App,
  TFile
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

import type { Frontmatter } from '../composers/composer-base.ts';
import type { Item } from '../modals/suggest-modal-base.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';

import { FrontmatterTitleMode } from '../plugin-settings.ts';
import { SplitItemSelector } from './split-item-selector.ts';

function mockItem(partial: Record<string, unknown>): Item {
  return castTo<Item>(partial);
}

const mockAddAlias = vi.fn();

vi.mock('obsidian-dev-utils/obsidian/file-manager', () => ({
  addAlias: (...args: unknown[]): unknown => mockAddAlias(...args)
}));

vi.mock('obsidian-dev-utils/string', () => ({
  trimEnd: vi.fn((str: string, suffix: string) => {
    if (str.endsWith(suffix)) {
      return str.slice(0, -suffix.length);
    }
    return str;
  })
}));

vi.mock('../filename-validation.ts', () => ({
  INVALID_CHARACTERS_REG_EXP: /[*\\<>:|?#^[\]"]+/g,
  TRAILING_DOTS_OR_SPACES_REG_EXP: /[ .]+$/g
}));

vi.mock('../plugin-settings.ts', () => ({
  FrontmatterTitleMode: {
    None: 'None',
    UseAlways: 'UseAlways',
    UseForInvalidTitleOnly: 'UseForInvalidTitleOnly'
  }
}));

interface SettingsOverrides {
  frontmatterTitleMode?: string;
  isPathIgnored?: ReturnType<typeof vi.fn>;
  replacement?: string;
  shouldAddInvalidTitleToNoteAlias?: boolean;
  shouldReplaceInvalidTitleCharacters?: boolean;
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
      processFrontMatter
    }),
    metadataCache: strictProxy({
      getFirstLinkpathDest: vi.fn().mockReturnValue(null)
    })
  });
}

function createMockFile(basename: string, path?: string): TFile {
  return strictProxy<TFile>({
    basename,
    path: path ?? `folder/${basename}.md`
  });
}

function createMockPluginSettingsComponent(settingsOverrides: SettingsOverrides = {}): PluginSettingsComponent {
  return strictProxy<PluginSettingsComponent>({
    settings: castTo<PluginSettings>({
      frontmatterTitleMode: FrontmatterTitleMode.UseForInvalidTitleOnly,
      isPathIgnored: vi.fn().mockReturnValue(false),
      replacement: '_',
      shouldAddInvalidTitleToNoteAlias: true,
      shouldReplaceInvalidTitleCharacters: true,
      ...settingsOverrides
    })
  });
}

describe('SplitItemSelector', () => {
  describe('selectItem', () => {
    it('should create new file when isMod is true', async () => {
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent();
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'new note',
        isMod: true,
        item: strictProxy<Item>({ type: 'file' }),
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
      });

      const result = await selector.selectItem();

      expect(result.isNewTargetFile).toBe(true);
    });

    it('should create new file when item is null', async () => {
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent();
      const sourceFile = createMockFile('source', 'source.md');

      const selector = new SplitItemSelector({
        app,
        inputValue: 'new note',
        isMod: false,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
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
        isMod: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
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
        isMod: false,
        item,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
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
        isMod: false,
        item,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
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
        isMod: false,
        item,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
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
        isMod: false,
        item,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
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
        isMod: false,
        item,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
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
        isMod: false,
        item,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
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
        isMod: false,
        item,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
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
        isMod: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
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
        isMod: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
      });

      await selector.selectItem();

      expect(mockAddAlias).toHaveBeenCalledWith(app, invalidFile, 'invalid*name');
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
        isMod: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
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
        isMod: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
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
        isMod: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
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
        isMod: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
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
        isMod: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
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
        isMod: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
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
        isMod: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
      });

      await expect(selector.selectItem()).rejects.toThrow('Invalid frontmatter title mode: InvalidMode');
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
        isMod: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: true,
        shouldTreatTitleAsPath: true,
        sourceFile
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
        isMod: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: true,
        shouldTreatTitleAsPath: true,
        sourceFile
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
        isMod: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
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
        isMod: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
      });

      await selector.selectItem();

      expect(app.fileManager.createNewMarkdownFileFromLinktext).toHaveBeenCalledWith(
        'Untitled.md',
        'source.md'
      );
    });

    it('should replace forward slashes with backslashes when shouldTreatTitleAsPath is false', async () => {
      const fixedFile = createMockFile('a\\b', 'folder/a\\b.md');
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
        isMod: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: false,
        sourceFile
      });

      await selector.selectItem();

      expect(app.fileManager.createNewMarkdownFileFromLinktext).toHaveBeenCalledWith(
        'a\\b.md',
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
        isMod: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
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
        isMod: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
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
        isMod: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
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
        isMod: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
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
        isMod: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
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
        isMod: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
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
        isMod: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
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
        isMod: true,
        item: null,
        pluginSettingsComponent,
        shouldAllowOnlyCurrentFolder: false,
        shouldTreatTitleAsPath: true,
        sourceFile
      });

      await selector.selectItem();

      expect(app.fileManager.createNewMarkdownFileFromLinktext).toHaveBeenCalledWith(
        'f___n.md',
        'source.md'
      );
    });
  });
});
