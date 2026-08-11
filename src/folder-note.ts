import type {
  App,
  TFile,
  TFolder
} from 'obsidian';

import { normalizePath } from 'obsidian';
import { join } from 'obsidian-dev-utils/path';

import { FolderNoteLocation } from './plugin-settings.ts';
import { resolveFolderTemplateTokens } from './template-tokens.ts';

/**
 * A folder-note setup with {@link FolderNoteLocation.Auto} already resolved to a concrete answer.
 */
export interface FolderNoteConfig {
  readonly location: FolderNoteLocation.InsideFolder | FolderNoteLocation.None | FolderNoteLocation.ParentFolder;

  /**
   * The note's name template, in THIS plugin's token vocabulary — `{{folderName}}` names the note after its
   * folder, a literal like `!` or `index` gives every folder note the same name.
   */
  readonly nameTemplate: string;
}

/**
 * Parameters for {@link resolveFolderNoteConfig}.
 */
export interface ResolveFolderNoteConfigParams {
  readonly app: App;

  /**
   * The `folderNoteLocation` setting.
   */
  readonly location: FolderNoteLocation;

  /**
   * The `folderNoteNameTemplate` setting.
   */
  readonly nameTemplate: string;
}

/**
 * Parameters for {@link resolveFolderNote}.
 */
export interface ResolveFolderNoteParams {
  readonly app: App;

  /**
   * The folder whose folder note is wanted. Read AFTER any rename: the note is named from the folder's
   * CURRENT name, and a `folder-notes` install with `syncFolderName` on will have renamed it already.
   */
  readonly folder: TFolder;

  /**
   * The `folderNoteLocation` setting.
   */
  readonly location: FolderNoteLocation;

  /**
   * The `folderNoteNameTemplate` setting.
   */
  readonly nameTemplate: string;
}

const FOLDER_NOTES_FOLDER_NAME_TOKEN_REG_EXP = /\{\{folder_name\}\}/gi;
const FOLDER_NOTES_PLUGIN_ID = 'folder-notes';

/**
 * What {@link FolderNoteLocation.Auto} falls back to: the layout every folder-note plugin supports, and the
 * one `folder-notes` itself ships as its default.
 */
const FALLBACK_FOLDER_NOTE_CONFIG: FolderNoteConfig = {
  location: FolderNoteLocation.InsideFolder,
  nameTemplate: '{{folderName}}'
};

const MARKDOWN_EXTENSION = '.md';

/**
 * Finds a folder's folder note — the one note whose properties describe the folder itself, and therefore
 * the only note a folder rename or renumber may rewrite (issue #216).
 *
 * @param params - The folder and the folder-note settings.
 * @returns The folder note, or `null` when the vault has no folder notes, the folder is the vault root
 * (nothing can sit beside it), or the note simply does not exist.
 */
export function resolveFolderNote(params: ResolveFolderNoteParams): null | TFile {
  const {
    app,
    folder,
    location,
    nameTemplate
  } = params;

  const config = resolveFolderNoteConfig({ app, location, nameTemplate });
  if (config.location === FolderNoteLocation.None) {
    return null;
  }

  const parentFolderPath = config.location === FolderNoteLocation.ParentFolder ? folder.parent?.path : folder.path;
  if (parentFolderPath === undefined) {
    return null;
  }

  const noteName = resolveFolderTemplateTokens({ sourceFolder: folder, template: config.nameTemplate }).trim();
  if (!noteName) {
    return null;
  }

  return app.vault.getFileByPath(normalizePath(join(parentFolderPath, `${noteName}${MARKDOWN_EXTENSION}`)));
}

/**
 * Resolves {@link FolderNoteLocation.Auto} into a concrete folder-note setup.
 *
 * `Auto` reads the installed `folder-notes` plugin **at every use rather than copying its values into this
 * plugin's own `data.json`** — a copy would silently go stale the moment that plugin is reconfigured, and
 * it would need a settings migration to seed. Anything else is the user's explicit choice and the other
 * plugin is not consulted at all.
 *
 * `folder-notes`' `vaultFolder` storage (every folder note in one central folder) has no counterpart here
 * and falls back rather than guessing: with the notes pooled, the note belonging to a folder is no longer
 * derivable from that folder's path alone.
 *
 * @param params - The settings and the app to read the other plugin from.
 * @returns The resolved setup.
 */
export function resolveFolderNoteConfig(params: ResolveFolderNoteConfigParams): FolderNoteConfig {
  const {
    app,
    location,
    nameTemplate
  } = params;

  if (location !== FolderNoteLocation.Auto) {
    return { location, nameTemplate };
  }

  return readFolderNotesPluginConfig(app) ?? FALLBACK_FOLDER_NOTE_CONFIG;
}

/**
 * Reads the installed `folder-notes` plugin's own configuration, if it is installed and configured the way
 * it documents.
 *
 * Every value is read as `unknown` and checked, rather than asserted into a shape: this is another
 * plugin's private settings object, so a version that renames or drops a key must degrade to the fallback
 * instead of throwing inside a reorder.
 *
 * @param app - The Obsidian application instance.
 * @returns The configuration, or `null` when the plugin is absent, not configured, or set to a storage
 * location with no counterpart here.
 */
function readFolderNotesPluginConfig(app: App): FolderNoteConfig | null {
  const folderNotesPlugin = app.plugins.plugins[FOLDER_NOTES_PLUGIN_ID];
  // Narrowed with `in` rather than asserted into a shape: that keeps every value below typed `unknown`,
  // Which is exactly what a foreign plugin's private settings are.
  if (!folderNotesPlugin || !('settings' in folderNotesPlugin)) {
    return null;
  }

  const folderNotesSettings = folderNotesPlugin.settings;
  if (typeof folderNotesSettings !== 'object' || folderNotesSettings === null) {
    return null;
  }

  const location = toFolderNoteLocation('storageLocation' in folderNotesSettings ? folderNotesSettings.storageLocation : null);
  if (!location) {
    return null;
  }

  const folderNoteName = 'folderNoteName' in folderNotesSettings ? folderNotesSettings.folderNoteName : null;
  if (typeof folderNoteName !== 'string' || !folderNoteName) {
    return null;
  }

  return {
    location,
    // Their template language has exactly one token; every other character is a literal, so translating it
    // Is the whole of the translation.
    nameTemplate: folderNoteName.replaceAll(FOLDER_NOTES_FOLDER_NAME_TOKEN_REG_EXP, '{{folderName}}')
  };
}

/**
 * Maps `folder-notes`' `storageLocation` onto this plugin's own location.
 *
 * @param storageLocation - The value read out of that plugin's settings.
 * @returns The location, or `null` for `vaultFolder` and for anything that is not one of its values.
 */
function toFolderNoteLocation(storageLocation: unknown): FolderNoteConfig['location'] | null {
  switch (storageLocation) {
    case 'insideFolder': {
      return FolderNoteLocation.InsideFolder;
    }
    case 'parentFolder': {
      return FolderNoteLocation.ParentFolder;
    }
    default: {
      return null;
    }
  }
}
