import type {
  App as AppOriginal,
  TFolder
} from 'obsidian';
import type { GenericObject } from 'obsidian-dev-utils/type-guards';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { FolderNoteConfig } from './folder-note.ts';

import {
  resolveFolderNote,
  resolveFolderNoteConfig
} from './folder-note.ts';
import { FolderNoteLocation } from './plugin-settings.ts';

const DEFAULT_NAME_TEMPLATE = '{{folderName}}';

let app: AppOriginal;

function configFor(location: FolderNoteLocation, folderNotesSettings?: unknown, nameTemplate = DEFAULT_NAME_TEMPLATE): FolderNoteConfig {
  initApp({ 'alpha/bravo/charlie/charlie.md': '' }, folderNotesSettings);
  return resolveFolderNoteConfig({ app, location, nameTemplate });
}

function getFolder(path: string): TFolder {
  return ensureNonNullable(app.vault.getFolderByPath(path));
}

function initApp(files: Record<string, string>, folderNotesSettings?: unknown): void {
  app = App.createConfigured__({ files }).asOriginalType__();
  // `app.plugins` always exists in Obsidian, so it is always mocked here; what varies is whether the
  // Folder-notes plugin is among the loaded ones.
  castTo<GenericObject>(app)['plugins'] = {
    plugins: folderNotesSettings === undefined ? {} : { 'folder-notes': { settings: folderNotesSettings } }
  };
}

describe('resolveFolderNoteConfig', () => {
  it('should take the plugin\'s own setting when it names a location', () => {
    expect(configFor(FolderNoteLocation.InsideFolder, undefined, '!')).toEqual({
      location: FolderNoteLocation.InsideFolder,
      nameTemplate: '!'
    });
  });

  it('should report None as itself, so the caller writes no properties at all', () => {
    expect(configFor(FolderNoteLocation.None)).toEqual({
      location: FolderNoteLocation.None,
      nameTemplate: DEFAULT_NAME_TEMPLATE
    });
  });

  it('should fall back to a note named after its folder, inside it, when Auto finds no folder-notes plugin', () => {
    expect(configFor(FolderNoteLocation.Auto)).toEqual({
      location: FolderNoteLocation.InsideFolder,
      nameTemplate: DEFAULT_NAME_TEMPLATE
    });
  });

  it('should read the installed folder-notes plugin under Auto, translating its own token', () => {
    expect(configFor(FolderNoteLocation.Auto, { folderNoteName: '{{folder_name}}', storageLocation: 'insideFolder' })).toEqual({
      location: FolderNoteLocation.InsideFolder,
      nameTemplate: DEFAULT_NAME_TEMPLATE
    });
  });

  it('should read a fixed folder-note name from the installed plugin', () => {
    expect(configFor(FolderNoteLocation.Auto, { folderNoteName: 'index', storageLocation: 'insideFolder' })).toEqual({
      location: FolderNoteLocation.InsideFolder,
      nameTemplate: 'index'
    });
  });

  it('should read the outside-the-folder location from the installed plugin', () => {
    expect(configFor(FolderNoteLocation.Auto, { folderNoteName: '{{folder_name}}', storageLocation: 'parentFolder' })).toEqual({
      location: FolderNoteLocation.ParentFolder,
      nameTemplate: DEFAULT_NAME_TEMPLATE
    });
  });

  it('should fall back when the installed plugin keeps its folder notes in one central folder, which is unsupported', () => {
    expect(configFor(FolderNoteLocation.Auto, { folderNoteName: '{{folder_name}}', storageLocation: 'vaultFolder' })).toEqual({
      location: FolderNoteLocation.InsideFolder,
      nameTemplate: DEFAULT_NAME_TEMPLATE
    });
  });

  it('should fall back when the installed plugin\'s storage location is not one it documents', () => {
    expect(configFor(FolderNoteLocation.Auto, { folderNoteName: 42, storageLocation: null })).toEqual({
      location: FolderNoteLocation.InsideFolder,
      nameTemplate: DEFAULT_NAME_TEMPLATE
    });
  });

  it('should fall back when the installed plugin has no settings object at all', () => {
    expect(configFor(FolderNoteLocation.Auto, 'not an object')).toEqual({
      location: FolderNoteLocation.InsideFolder,
      nameTemplate: DEFAULT_NAME_TEMPLATE
    });
  });

  it('should fall back when the installed plugin\'s settings carry neither key', () => {
    expect(configFor(FolderNoteLocation.Auto, {})).toEqual({
      location: FolderNoteLocation.InsideFolder,
      nameTemplate: DEFAULT_NAME_TEMPLATE
    });
  });

  it('should fall back when the installed plugin names no folder note at all', () => {
    expect(configFor(FolderNoteLocation.Auto, { storageLocation: 'insideFolder' })).toEqual({
      location: FolderNoteLocation.InsideFolder,
      nameTemplate: DEFAULT_NAME_TEMPLATE
    });
  });

  it('should fall back when the installed plugin\'s folder-note name is not a usable string', () => {
    expect(configFor(FolderNoteLocation.Auto, { folderNoteName: '', storageLocation: 'insideFolder' })).toEqual({
      location: FolderNoteLocation.InsideFolder,
      nameTemplate: DEFAULT_NAME_TEMPLATE
    });
  });

  it('should ignore the plugin entirely when the location was chosen explicitly', () => {
    expect(configFor(FolderNoteLocation.InsideFolder, { folderNoteName: 'index', storageLocation: 'parentFolder' }, '!')).toEqual({
      location: FolderNoteLocation.InsideFolder,
      nameTemplate: '!'
    });
  });
});

describe('resolveFolderNote', () => {
  function resolve(files: Record<string, string>, folderPath: string, location: FolderNoteLocation, nameTemplate = DEFAULT_NAME_TEMPLATE): null | string {
    initApp(files);
    return resolveFolderNote({
      app,
      folder: getFolder(folderPath),
      location,
      nameTemplate
    })?.path ?? null;
  }

  it('should find a note named after its folder, inside it', () => {
    expect(resolve({ 'alpha/bravo/charlie/charlie.md': '' }, 'alpha/bravo/charlie', FolderNoteLocation.InsideFolder)).toBe(
      'alpha/bravo/charlie/charlie.md'
    );
  });

  it('should find a fixed-name note inside the folder', () => {
    expect(resolve({ 'alpha/bravo/charlie/!.md': '' }, 'alpha/bravo/charlie', FolderNoteLocation.InsideFolder, '!')).toBe(
      'alpha/bravo/charlie/!.md'
    );
  });

  it('should find a note sitting beside the folder', () => {
    expect(resolve(
      {
        'alpha/bravo/charlie.md': '',
        'alpha/bravo/charlie/note.md': ''
      },
      'alpha/bravo/charlie',
      FolderNoteLocation.ParentFolder
    )).toBe('alpha/bravo/charlie.md');
  });

  it('should find a note beside a top-level folder, at the vault root', () => {
    expect(resolve(
      {
        'charlie.md': '',
        'charlie/note.md': ''
      },
      'charlie',
      FolderNoteLocation.ParentFolder
    )).toBe('charlie.md');
  });

  it('should find nothing when folder notes are turned off', () => {
    expect(resolve({ 'alpha/bravo/charlie/charlie.md': '' }, 'alpha/bravo/charlie', FolderNoteLocation.None)).toBeNull();
  });

  it('should find nothing when the folder simply has no folder note', () => {
    expect(resolve({ 'alpha/bravo/charlie/other.md': '' }, 'alpha/bravo/charlie', FolderNoteLocation.InsideFolder)).toBeNull();
  });

  it('should find nothing when the name template resolves to nothing', () => {
    expect(resolve({ 'alpha/bravo/charlie/charlie.md': '' }, 'alpha/bravo/charlie', FolderNoteLocation.InsideFolder, ' '.repeat(3))).toBeNull();
  });

  it('should find nothing beside the vault root, which has no parent to hold a note', () => {
    initApp({ 'charlie/note.md': '' });
    expect(resolveFolderNote({
      app,
      folder: app.vault.getRoot(),
      location: FolderNoteLocation.ParentFolder,
      nameTemplate: DEFAULT_NAME_TEMPLATE
    })).toBeNull();
  });
});
