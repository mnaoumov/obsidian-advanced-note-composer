import type {
  App as AppOriginal,
  TFolder
} from 'obsidian';

import { FolderNoteLocation } from 'obsidian-dev-utils/obsidian/folder-note';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { FolderNoteSettings } from './folder-note.ts';

import {
  buildFolderNoteOptions,
  resolveFolderNoteConfigFromSettings,
  resolveFolderNoteFromSettings,
  resolveFolderOfFolderNote
} from './folder-note.ts';

/*
 * What is left to test here is the MAPPING — this plugin's two settings, and the token vocabulary its name
 * template is written in, expressed as `obsidian-dev-utils`' folder-note parameters. Where a folder note
 * lives, how the installed `folder-notes` plugin is read under `Auto` and which file that resolves to are
 * dev-utils' own, tested in its own suite; asserting them again here would only pin someone else's behavior.
 */

const DEFAULT_NAME_TEMPLATE = '{{folderName}}';

let app: AppOriginal;

function getFolder(path: string): TFolder {
  return ensureNonNullable(app.vault.getFolderByPath(path));
}

function initApp(files: Record<string, string>): void {
  app = App.createConfigured__({ files }).asOriginalType__();
}

function settingsFor(folderNoteLocation: FolderNoteLocation, folderNoteNameTemplate = DEFAULT_NAME_TEMPLATE): FolderNoteSettings {
  return { folderNoteLocation, folderNoteNameTemplate };
}

describe('buildFolderNoteOptions', () => {
  it('should pass the location setting through as it stands', () => {
    // Including `Auto`: it is dev-utils' own member, so the mapping has nothing to translate — which is the
    // whole point of dropping the plugin-local enum.
    expect(buildFolderNoteOptions(settingsFor(FolderNoteLocation.Auto)).location).toBe(FolderNoteLocation.Auto);
    expect(buildFolderNoteOptions(settingsFor(FolderNoteLocation.ParentFolder)).location).toBe(FolderNoteLocation.ParentFolder);
  });

  it('should name the note by rendering the template in this plugin\'s own token vocabulary', () => {
    initApp({ 'alpha/bravo/charlie/note.md': '' });
    const folder = getFolder('alpha/bravo/charlie');

    // The vocabulary is what dev-utils deliberately does not have — it takes a callback precisely so the
    // caller's tokens stay the caller's.
    expect(buildFolderNoteOptions(settingsFor(FolderNoteLocation.InsideFolder)).resolveName?.(folder)).toBe('charlie');
    expect(buildFolderNoteOptions(settingsFor(FolderNoteLocation.InsideFolder, '{{parentFolder}} - {{folderName}}')).resolveName?.(folder))
      .toBe('bravo - charlie');
  });

  it('should name every folder note alike when the template names no token', () => {
    initApp({ 'alpha/bravo/charlie/note.md': '' });

    expect(buildFolderNoteOptions(settingsFor(FolderNoteLocation.InsideFolder, '!')).resolveName?.(getFolder('alpha/bravo/charlie'))).toBe('!');
  });
});

describe('resolveFolderNoteConfigFromSettings', () => {
  it('should resolve a chosen location into a setup that names the note from the template', () => {
    initApp({ 'alpha/bravo/charlie/note.md': '' });

    const config = resolveFolderNoteConfigFromSettings({ app, settings: settingsFor(FolderNoteLocation.ParentFolder, 'index') });

    expect(config.location).toBe(FolderNoteLocation.ParentFolder);
    // The rename flows call exactly this, against the folder's NEW name, to name the note it must move to.
    expect(config.resolveName(getFolder('alpha/bravo/charlie'))).toBe('index');
  });
});

describe('resolveFolderNoteFromSettings', () => {
  function resolve(files: Record<string, string>, folderPath: string, settings: FolderNoteSettings): null | string {
    initApp(files);
    return resolveFolderNoteFromSettings({
      app,
      folder: getFolder(folderPath),
      settings
    })?.path ?? null;
  }

  it('should find a note named after its folder, inside it', () => {
    expect(resolve({ 'alpha/bravo/charlie/charlie.md': '' }, 'alpha/bravo/charlie', settingsFor(FolderNoteLocation.InsideFolder))).toBe(
      'alpha/bravo/charlie/charlie.md'
    );
  });

  it('should find a fixed-name note beside the folder', () => {
    expect(resolve(
      {
        'alpha/bravo/charlie/other.md': '',
        'alpha/bravo/index.md': ''
      },
      'alpha/bravo/charlie',
      settingsFor(FolderNoteLocation.ParentFolder, 'index')
    )).toBe('alpha/bravo/index.md');
  });

  it('should find nothing when this vault has no folder notes', () => {
    expect(resolve({ 'alpha/bravo/charlie/charlie.md': '' }, 'alpha/bravo/charlie', settingsFor(FolderNoteLocation.None))).toBeNull();
  });

  it('should find nothing when the folder simply has no folder note, and create nothing looking', () => {
    expect(resolve({ 'alpha/bravo/charlie/other.md': '' }, 'alpha/bravo/charlie', settingsFor(FolderNoteLocation.InsideFolder))).toBeNull();
  });
});

describe('resolveFolderOfFolderNote', () => {
  function resolve(files: Record<string, string>, filePath: string, settings: FolderNoteSettings): null | string {
    initApp(files);
    return resolveFolderOfFolderNote({
      app,
      config: resolveFolderNoteConfigFromSettings({ app, settings }),
      file: ensureNonNullable(app.vault.getFileByPath(filePath))
    })?.path ?? null;
  }

  it('should answer the folder a note named after it describes, from inside', () => {
    expect(resolve({ 'alpha/bravo/bravo.md': '' }, 'alpha/bravo/bravo.md', settingsFor(FolderNoteLocation.InsideFolder))).toBe('alpha/bravo');
  });

  it('should answer nothing for a note that merely sits in the folder', () => {
    expect(resolve(
      {
        'alpha/bravo/bravo.md': '',
        'alpha/bravo/other.md': ''
      },
      'alpha/bravo/other.md',
      settingsFor(FolderNoteLocation.InsideFolder)
    )).toBeNull();
  });

  it('should follow the name template rather than the folder name', () => {
    const files = {
      'alpha/bravo/bravo.md': '',
      'alpha/bravo/index.md': ''
    };
    expect(resolve(files, 'alpha/bravo/index.md', settingsFor(FolderNoteLocation.InsideFolder, 'index'))).toBe('alpha/bravo');
    expect(resolve(files, 'alpha/bravo/bravo.md', settingsFor(FolderNoteLocation.InsideFolder, 'index'))).toBeNull();
  });

  it('should answer nothing for a folder note kept beside its folder, whose path already is the folder\'s', () => {
    expect(resolve(
      {
        'alpha/bravo.md': '',
        'alpha/bravo/other.md': ''
      },
      'alpha/bravo.md',
      settingsFor(FolderNoteLocation.ParentFolder)
    )).toBeNull();
  });

  it('should answer nothing when this vault has no folder notes', () => {
    expect(resolve({ 'alpha/bravo/bravo.md': '' }, 'alpha/bravo/bravo.md', settingsFor(FolderNoteLocation.None))).toBeNull();
  });

  it('should answer nothing for a note at the vault root', () => {
    expect(resolve({ 'alpha.md': '' }, 'alpha.md', settingsFor(FolderNoteLocation.InsideFolder, 'alpha'))).toBeNull();
  });
});
