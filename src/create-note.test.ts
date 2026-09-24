import type {
  App,
  TFile
} from 'obsidian';

import { noopAsync } from 'obsidian-dev-utils/function';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { Frontmatter } from './frontmatter-merge.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';
import type { PluginSettings } from './plugin-settings.ts';

import {
  createNoteFromTypedName,
  resolveTypedNoteName
} from './create-note.ts';
import { FrontmatterTitleMode } from './plugin-settings.ts';

const mockAddAlias = vi.fn();

vi.mock('obsidian-dev-utils/obsidian/file-manager', () => ({
  addAlias: (...$arguments: unknown[]): unknown => mockAddAlias(...$arguments)
}));

vi.mock('./plugin-settings.ts', () => ({
  FrontmatterTitleMode: {
    None: 'None',
    UseAlways: 'UseAlways',
    UseForInvalidTitleOnly: 'UseForInvalidTitleOnly'
  }
}));

interface SettingsOverrides {
  frontmatterTitleMode?: string;
  nameTransformTemplate?: string;
  numberedSplitNoteNameTemplate?: string;
  replacement?: string;
  shouldAddInvalidTitleToNoteAlias?: boolean;
  shouldReplaceInvalidTitleCharacters?: boolean;
  shouldTitleCaseCreatedNoteName?: boolean;
}

function createMockApp(createdFile: TFile): App {
  return strictProxy<App>({
    fileManager: strictProxy({
      createNewMarkdownFileFromLinktext: vi.fn().mockResolvedValue(createdFile),
      processFrontMatter: vi.fn().mockImplementation((_file: TFile, callback: (frontmatter: Frontmatter) => void): Promise<void> => {
        callback(frontmatterWrites);
        return noopAsync();
      }),
      // Auto-numbering (issue #269) renames the created note in place; every other flow here leaves it
      // where it was made.
      renameFile: vi.fn(() => noopAsync())
    }),
    vault: strictProxy({
      // Obsidian's own de-duplication, which auto-numbering (issue #269) goes through before renaming.
      // Nothing collides in these fixtures, so it hands the desired path straight back.
      getAvailablePath: vi.fn((basePath: string, extension: string) => `${basePath}.${extension}`)
    })
  });
}

/**
 * A created note, carrying the empty parent folder auto-numbering (issue #269) scans for siblings. What
 * the scan itself makes of a POPULATED folder is `next-sibling-index.test.ts`'s subject; what matters here
 * is only whether the numbering runs at all.
 *
 * @param basename - The note's basename.
 * @returns The mock note.
 */
function createMockFile(basename: string): TFile {
  return strictProxy<TFile>({
    basename,
    extension: 'md',
    name: `${basename}.md`,
    parent: strictProxy({
      children: [],
      getParentPrefix: (): string => 'Parent/',
      name: 'Parent',
      path: 'Parent'
    }),
    path: `Parent/${basename}.md`
  });
}

function createMockPluginSettingsComponent(settingsOverrides: SettingsOverrides = {}): PluginSettingsComponent {
  return strictProxy<PluginSettingsComponent>({
    settings: castTo<PluginSettings>({
      frontmatterTitleMode: FrontmatterTitleMode.UseForInvalidTitleOnly,
      nameTransformTemplate: '',
      numberedSplitNoteNameTemplate: '',
      replacement: '_',
      shouldAddInvalidTitleToNoteAlias: true,
      shouldReplaceInvalidTitleCharacters: true,
      shouldTitleCaseCreatedNoteName: false,
      ...settingsOverrides
    })
  });
}

let frontmatterWrites: Frontmatter;

beforeEach(() => {
  frontmatterWrites = castTo<Frontmatter>({});
  vi.clearAllMocks();
});

describe('createNoteFromTypedName', () => {
  it('should create the note under the given folder prefix and source path', async () => {
    const createdFile = createMockFile('Ghost');
    const app = createMockApp(createdFile);

    const file = await createNoteFromTypedName({
      app,
      contextFile: null,
      fileName: 'Ghost',
      folderPrefix: '/Parent/',
      pluginSettingsComponent: createMockPluginSettingsComponent(),
      relocateNote: null,
      shouldCleanTypedName: false,
      shouldTreatTitleAsPath: false,
      sourcePath: ''
    });

    expect(file).toBe(createdFile);
    expect(app.fileManager.createNewMarkdownFileFromLinktext).toHaveBeenCalledWith('/Parent/Ghost.md', '');
    // The typed name survived, so nothing has to be recorded anywhere else.
    expect(mockAddAlias).not.toHaveBeenCalled();
    expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
  });

  it('should trim a typed .md extension rather than creating `Ghost.md.md`', async () => {
    const app = createMockApp(createMockFile('Ghost'));

    await createNoteFromTypedName({
      app,
      contextFile: null,
      fileName: 'Ghost.md',
      folderPrefix: '',
      pluginSettingsComponent: createMockPluginSettingsComponent(),
      relocateNote: null,
      shouldCleanTypedName: false,
      shouldTreatTitleAsPath: false,
      sourcePath: 'source.md'
    });

    expect(app.fileManager.createNewMarkdownFileFromLinktext).toHaveBeenCalledWith('Ghost.md', 'source.md');
  });

  it('should record the typed name as an alias when sanitization changed it', async () => {
    const app = createMockApp(createMockFile('a_b'));

    await createNoteFromTypedName({
      app,
      contextFile: null,
      fileName: 'a:b',
      folderPrefix: '',
      pluginSettingsComponent: createMockPluginSettingsComponent(),
      relocateNote: null,
      shouldCleanTypedName: false,
      shouldTreatTitleAsPath: false,
      sourcePath: ''
    });

    expect(mockAddAlias).toHaveBeenCalledWith(expect.objectContaining({ alias: 'a:b', resourceLockComponent: null }));
    // `UseForInvalidTitleOnly` — an invalid title is exactly when the frontmatter title is written.
    expect(frontmatterWrites.title).toBe('a:b');
  });

  it('should skip the alias when the setting is off', async () => {
    const app = createMockApp(createMockFile('a_b'));

    await createNoteFromTypedName({
      app,
      contextFile: null,
      fileName: 'a:b',
      folderPrefix: '',
      pluginSettingsComponent: createMockPluginSettingsComponent({ shouldAddInvalidTitleToNoteAlias: false }),
      relocateNote: null,
      shouldCleanTypedName: false,
      shouldTreatTitleAsPath: false,
      sourcePath: ''
    });

    expect(mockAddAlias).not.toHaveBeenCalled();
  });

  it('should judge the title by the name the relocation left behind', async () => {
    // What `SplitItemSelector`'s own-folder move does: the note is renamed to `Overview`, so the typed name
    // is no longer its title and has to be recorded (issue #153).
    const app = createMockApp(createMockFile('Ghost'));
    const relocateNote = vi.fn().mockResolvedValue('Overview');

    await createNoteFromTypedName({
      app,
      contextFile: null,
      fileName: 'Ghost',
      folderPrefix: '',
      pluginSettingsComponent: createMockPluginSettingsComponent(),
      relocateNote,
      shouldCleanTypedName: false,
      shouldTreatTitleAsPath: false,
      sourcePath: ''
    });

    expect(relocateNote).toHaveBeenCalledOnce();
    expect(mockAddAlias).toHaveBeenCalledWith(expect.objectContaining({ alias: 'Ghost' }));
    expect(frontmatterWrites.title).toBe('Ghost');
  });

  it('should keep the typed title when the relocation kept the name', async () => {
    const app = createMockApp(createMockFile('Ghost'));

    await createNoteFromTypedName({
      app,
      contextFile: null,
      fileName: 'Ghost',
      folderPrefix: '',
      pluginSettingsComponent: createMockPluginSettingsComponent(),
      relocateNote: vi.fn().mockResolvedValue(null),
      shouldCleanTypedName: false,
      shouldTreatTitleAsPath: false,
      sourcePath: ''
    });

    expect(mockAddAlias).not.toHaveBeenCalled();
  });

  it('should always write the frontmatter title in UseAlways mode', async () => {
    const app = createMockApp(createMockFile('Ghost'));

    await createNoteFromTypedName({
      app,
      contextFile: null,
      fileName: 'Ghost',
      folderPrefix: '',
      pluginSettingsComponent: createMockPluginSettingsComponent({ frontmatterTitleMode: FrontmatterTitleMode.UseAlways }),
      relocateNote: null,
      shouldCleanTypedName: false,
      shouldTreatTitleAsPath: false,
      sourcePath: ''
    });

    expect(frontmatterWrites.title).toBe('Ghost');
  });

  it('should never write the frontmatter title in None mode', async () => {
    const app = createMockApp(createMockFile('a_b'));

    await createNoteFromTypedName({
      app,
      contextFile: null,
      fileName: 'a:b',
      folderPrefix: '',
      pluginSettingsComponent: createMockPluginSettingsComponent({ frontmatterTitleMode: FrontmatterTitleMode.None }),
      relocateNote: null,
      shouldCleanTypedName: false,
      shouldTreatTitleAsPath: false,
      sourcePath: ''
    });

    expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
  });

  it('should throw for an unknown frontmatter title mode', async () => {
    const app = createMockApp(createMockFile('Ghost'));

    await expect(createNoteFromTypedName({
      app,
      contextFile: null,
      fileName: 'Ghost',
      folderPrefix: '',
      pluginSettingsComponent: createMockPluginSettingsComponent({ frontmatterTitleMode: 'nonsense' }),
      relocateNote: null,
      shouldCleanTypedName: false,
      shouldTreatTitleAsPath: false,
      sourcePath: ''
    })).rejects.toThrow('Invalid frontmatter title mode: nonsense');
  });

  describe('numberedSplitNoteNameTemplate', () => {
    it('should number the created note when it did not go into a folder of its own', async () => {
      const app = createMockApp(createMockFile('Ghost'));

      await createNoteFromTypedName({
        app,
        contextFile: null,
        fileName: 'Ghost',
        folderPrefix: '',
        pluginSettingsComponent: createMockPluginSettingsComponent({ numberedSplitNoteNameTemplate: '{{index}}. {{safeName}}' }),
        relocateNote: null,
        shouldCleanTypedName: false,
        shouldTreatTitleAsPath: false,
        sourcePath: ''
      });

      expect(app.fileManager.renameFile).toHaveBeenCalledWith(expect.anything(), 'Parent/1. Ghost.md');
    });

    it('should leave the note unnumbered when it DID go into a folder of its own', async () => {
      // Issue #269's "instead": the number belongs on the folder there, and `move-into-own-folder.ts` is
      // what puts it on. Numbering both would write it twice into the same path.
      const app = createMockApp(createMockFile('Ghost'));

      await createNoteFromTypedName({
        app,
        contextFile: null,
        fileName: 'Ghost',
        folderPrefix: '',
        pluginSettingsComponent: createMockPluginSettingsComponent({ numberedSplitNoteNameTemplate: '{{index}}. {{safeName}}' }),
        relocateNote: vi.fn().mockResolvedValue(null),
        shouldCleanTypedName: false,
        shouldTreatTitleAsPath: false,
        sourcePath: ''
      });

      expect(app.fileManager.renameFile).not.toHaveBeenCalled();
    });

    it('should leave the note alone when the template is empty, which is the opt-out', async () => {
      const app = createMockApp(createMockFile('Ghost'));

      await createNoteFromTypedName({
        app,
        contextFile: null,
        fileName: 'Ghost',
        folderPrefix: '',
        pluginSettingsComponent: createMockPluginSettingsComponent(),
        relocateNote: null,
        shouldCleanTypedName: false,
        shouldTreatTitleAsPath: false,
        sourcePath: ''
      });

      expect(app.fileManager.renameFile).not.toHaveBeenCalled();
    });
  });

  describe('typed-name cleaning (issue #283)', () => {
    it('should collapse the spacing and keep the casing when title-casing is off', async () => {
      const app = createMockApp(createMockFile('tEsT HellO'));

      await createNoteFromTypedName({
        app,
        contextFile: null,
        fileName: '  tEsT      HellO  ',
        folderPrefix: '/Parent/',
        pluginSettingsComponent: createMockPluginSettingsComponent(),
        relocateNote: null,
        shouldCleanTypedName: true,
        shouldTreatTitleAsPath: false,
        sourcePath: ''
      });

      expect(app.fileManager.createNewMarkdownFileFromLinktext).toHaveBeenCalledWith('/Parent/tEsT HellO.md', '');
      // The cleaned name IS the typed name from here on, so it is not an invalid title to record.
      expect(mockAddAlias).not.toHaveBeenCalled();
    });

    it('should Title Case the name when shouldTitleCaseCreatedNoteName is on, keeping an acronym', async () => {
      const app = createMockApp(createMockFile('Test Hello API'));

      await createNoteFromTypedName({
        app,
        contextFile: null,
        fileName: 'tEsT      HellO API',
        folderPrefix: '/Parent/',
        pluginSettingsComponent: createMockPluginSettingsComponent({ shouldTitleCaseCreatedNoteName: true }),
        relocateNote: null,
        shouldCleanTypedName: true,
        shouldTreatTitleAsPath: false,
        sourcePath: ''
      });

      expect(app.fileManager.createNewMarkdownFileFromLinktext).toHaveBeenCalledWith('/Parent/Test Hello API.md', '');
    });

    it('should record the CLEANED name as the frontmatter title', async () => {
      const app = createMockApp(createMockFile('Test Hello'));

      await createNoteFromTypedName({
        app,
        contextFile: null,
        fileName: 'tEsT      HellO',
        folderPrefix: '',
        pluginSettingsComponent: createMockPluginSettingsComponent({
          frontmatterTitleMode: FrontmatterTitleMode.UseAlways,
          shouldTitleCaseCreatedNoteName: true
        }),
        relocateNote: null,
        shouldCleanTypedName: true,
        shouldTreatTitleAsPath: false,
        sourcePath: ''
      });

      expect(frontmatterWrites.title).toBe('Test Hello');
    });

    it('should leave the name untouched when the caller does not ask for cleaning', async () => {
      const app = createMockApp(createMockFile('tEsT HellO'));

      await createNoteFromTypedName({
        app,
        contextFile: null,
        fileName: 'tEsT  HellO',
        folderPrefix: '',
        pluginSettingsComponent: createMockPluginSettingsComponent({ shouldTitleCaseCreatedNoteName: true }),
        relocateNote: null,
        shouldCleanTypedName: false,
        shouldTreatTitleAsPath: false,
        sourcePath: ''
      });

      expect(app.fileManager.createNewMarkdownFileFromLinktext).toHaveBeenCalledWith('tEsT  HellO.md', '');
    });
  });
});

describe('resolveTypedNoteName', () => {
  it('should strip leading and trailing dots and a typed .md extension', () => {
    expect(resolveTypedNoteName({
      fileName: '..Ghost  note..md',
      pluginSettingsComponent: createMockPluginSettingsComponent(),
      shouldCleanTypedName: true
    })).toBe('Ghost note');
  });

  it('should keep a name that cleans to nothing as typed, rather than making it empty', () => {
    expect(resolveTypedNoteName({
      fileName: '...',
      pluginSettingsComponent: createMockPluginSettingsComponent(),
      shouldCleanTypedName: true
    })).toBe('...');
  });
});
