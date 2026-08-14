/**
 * @file
 *
 * This plugin's `Folder note` SETTINGS, expressed as `obsidian-dev-utils`' folder-note parameters.
 *
 * The folder-note concept itself — where a folder's note lives, how the installed `folder-notes` plugin is
 * read under `Auto`, which file that resolves to — moved into `obsidian-dev-utils/obsidian/folder-note` in
 * 94.2.0 (G52/G61: it is not this plugin's to own, and `renderInternalLink` needed the same answer). What is
 * left here is the only half that IS this plugin's: two settings, and the token vocabulary their name
 * template is written in.
 *
 * The mapping is one-way and tiny by design — a caller that needs a folder note asks through here rather
 * than assembling the pair itself, which is how one of the two settings ends up read from somewhere else.
 */

import type {
  App,
  TFile,
  TFolder
} from 'obsidian';
import type {
  FolderNoteConfig,
  FolderNoteLocation
} from 'obsidian-dev-utils/obsidian/folder-note';
import type { RenderInternalLinkFolderNoteOptions } from 'obsidian-dev-utils/obsidian/markdown';

import {
  resolveFolderNote,
  resolveFolderNoteConfig
} from 'obsidian-dev-utils/obsidian/folder-note';

import { resolveFolderTemplateTokens } from './template-tokens.ts';

/**
 * The two settings that answer which note is a folder's folder note.
 *
 * Declared structurally rather than as the whole `PluginSettings`: it is what every folder-note caller
 * actually needs, it keeps them off settings that have nothing to do with folder notes, and a caller holding
 * the deep-readonly settings can pass them straight in.
 */
export interface FolderNoteSettings {
  /**
   * The `folderNoteLocation` setting.
   */
  readonly folderNoteLocation: FolderNoteLocation;

  /**
   * The `folderNoteNameTemplate` setting.
   */
  readonly folderNoteNameTemplate: string;
}

/**
 * Parameters for {@link resolveFolderNoteConfigFromSettings}.
 */
export interface ResolveFolderNoteConfigFromSettingsParams {
  readonly app: App;

  /**
   * The settings that say which note is a folder's folder note.
   */
  readonly settings: FolderNoteSettings;
}

/**
 * Parameters for {@link resolveFolderNoteFromSettings}.
 */
export interface ResolveFolderNoteFromSettingsParams {
  readonly app: App;

  /**
   * The folder whose folder note is wanted. Read AFTER any rename: the note is named from the folder's
   * CURRENT name, and a `folder-notes` install with `syncFolderName` on will have renamed it already.
   */
  readonly folder: TFolder;

  /**
   * The settings that say which note is a folder's folder note.
   */
  readonly settings: FolderNoteSettings;
}

/**
 * Translates the plugin's `Folder note` settings into the bag dev-utils resolves a folder note with — the
 * same bag `renderInternalLink` takes for a FOLDER link, which is why this is options and not an already
 * resolved config.
 *
 * **Both settings are read LAZILY** — the location through a getter, the name through the callback — so the
 * bag can be built when a notice is RENDERED while the settings behind it are read when the folder note is
 * actually resolved. That matters twice over: a notice outlives the operation that showed it, so the answer
 * must be the one the settings give at CLICK time; and building the bag then costs nothing to a link that
 * names a FILE, which never resolves a folder note at all.
 *
 * `extensions` and `isHidden` are deliberately left at their defaults: this plugin has no setting for either,
 * and under `Auto` — the default — dev-utils takes the installed `folder-notes` plugin's answer whole, which
 * includes both.
 *
 * @param settings - The settings that say which note is a folder's folder note.
 * @returns The options.
 */
export function buildFolderNoteOptions(settings: FolderNoteSettings): RenderInternalLinkFolderNoteOptions {
  return {
    get location(): FolderNoteLocation {
      return settings.folderNoteLocation;
    },
    // The name is a TEMPLATE here, in this plugin's own token vocabulary, where dev-utils takes a callback:
    // It has no vocabulary to impose, and rendering the template is exactly what this module exists for.
    // Ignored under `Auto`, which names the note the way the installed plugin does.
    resolveName: (folder: TFolder): string => resolveFolderTemplateTokens({ sourceFolder: folder, template: settings.folderNoteNameTemplate })
  };
}

/**
 * Resolves the plugin's `Folder note` settings into a concrete folder-note setup.
 *
 * Wanted by the flows that RENAME a folder note rather than merely find it: they name the note the folder
 * will have after the rename, which is {@link FolderNoteConfig.resolveName} applied to the renamed folder.
 *
 * @param params - The app and the settings.
 * @returns The resolved setup.
 */
export function resolveFolderNoteConfigFromSettings(params: ResolveFolderNoteConfigFromSettingsParams): FolderNoteConfig {
  const { app, settings } = params;
  return resolveFolderNoteConfig({ app, ...buildFolderNoteOptions(settings) });
}

/**
 * Finds a folder's folder note using the plugin's own `Folder note` settings — the one note whose properties
 * describe the folder itself, and therefore the only note a folder rename or renumber may rewrite (issue
 * #216).
 *
 * Never creates: a folder with no folder note answers `null`, and so does a vault whose folder notes are
 * turned off entirely.
 *
 * @param params - The folder and the settings.
 * @returns The folder note, or `null` when this folder has none.
 */
export function resolveFolderNoteFromSettings(params: ResolveFolderNoteFromSettingsParams): null | TFile {
  const {
    app,
    folder,
    settings
  } = params;

  return resolveFolderNote({
    app,
    config: resolveFolderNoteConfigFromSettings({ app, settings }),
    folder
  });
}
