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

import { createNoteFromTypedName } from './create-note.ts';
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
  replacement?: string;
  shouldAddInvalidTitleToNoteAlias?: boolean;
  shouldReplaceInvalidTitleCharacters?: boolean;
}

function createMockApp(createdFile: TFile): App {
  return strictProxy<App>({
    fileManager: strictProxy({
      createNewMarkdownFileFromLinktext: vi.fn().mockResolvedValue(createdFile),
      processFrontMatter: vi.fn().mockImplementation((_file: TFile, callback: (frontmatter: Frontmatter) => void): Promise<void> => {
        callback(frontmatterWrites);
        return noopAsync();
      })
    })
  });
}

function createMockFile(basename: string): TFile {
  return strictProxy<TFile>({
    basename,
    name: `${basename}.md`,
    path: `Parent/${basename}.md`
  });
}

function createMockPluginSettingsComponent(settingsOverrides: SettingsOverrides = {}): PluginSettingsComponent {
  return strictProxy<PluginSettingsComponent>({
    settings: castTo<PluginSettings>({
      frontmatterTitleMode: FrontmatterTitleMode.UseForInvalidTitleOnly,
      nameTransformTemplate: '',
      replacement: '_',
      shouldAddInvalidTitleToNoteAlias: true,
      shouldReplaceInvalidTitleCharacters: true,
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
      shouldTreatTitleAsPath: false,
      sourcePath: ''
    });

    expect(mockAddAlias).not.toHaveBeenCalled();
  });

  it('should judge the title by the name the relocation left behind', async () => {
    // What `SplitItemSelector`'s own-folder move does: the note is renamed to `Overview`, so the typed name
    // Is no longer its title and has to be recorded (issue #153).
    const app = createMockApp(createMockFile('Ghost'));
    const relocateNote = vi.fn().mockResolvedValue('Overview');

    await createNoteFromTypedName({
      app,
      contextFile: null,
      fileName: 'Ghost',
      folderPrefix: '',
      pluginSettingsComponent: createMockPluginSettingsComponent(),
      relocateNote,
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
      shouldTreatTitleAsPath: false,
      sourcePath: ''
    })).rejects.toThrow('Invalid frontmatter title mode: nonsense');
  });
});
