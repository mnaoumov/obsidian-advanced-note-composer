/**
 * @file
 *
 * Wrapping a freshly-created note in a brand-new folder named after it — the `Should split into folder`
 * behavior (issue #79), and since issue #255 the ONE implementation of it.
 *
 * It was `SplitItemSelector`'s private pair. `Create empty note in folder...` had deliberately opted out
 * of the setting (`relocateNote: null`), on the reading that a setting "named for splitting" must not wrap
 * an explorer-created note. #255 asked for the opposite, in as many words — the reporter wants that
 * command to produce a folder note — so both callers now share this module rather than the folder logic
 * being written twice.
 */

import type {
  App,
  TFile
} from 'obsidian';

import { normalizePath } from 'obsidian';
import { createFolderSafe } from 'obsidian-dev-utils/obsidian/vault';
import { trimEnd } from 'obsidian-dev-utils/string';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import { getAvailableFolderPath } from './available-folder-path.ts';
import { fixFileName } from './filename-validation.ts';
import { resolveTemplateTokens } from './template-tokens.ts';

/**
 * Parameters for {@link moveIntoOwnFolder}.
 */
export interface MoveIntoOwnFolderParams {
  readonly app: App;

  /**
   * The just-created note to move into its own folder (mutated in place by the rename).
   */
  readonly file: TFile;

  readonly pluginSettingsComponent: PluginSettingsComponent;

  /**
   * The note the operation started from, which the note-name template's source-flavored tokens resolve
   * against. `null` for a creation that has no source note at all — the explorer's
   * `Create empty note in folder...` — where those tokens resolve to nothing, exactly as they do for every
   * other template that command applies.
   */
  readonly sourceFile: null | TFile;
}

/**
 * Relocates a freshly-created note into a brand-new folder named after it, so it lives at
 * `<dir>/<name>/<name>.md` instead of `<dir>/<name>.md` (issue #79). The folder name is de-duplicated
 * against existing siblings. The note keeps its own base name inside the new folder unless the
 * `splitIntoFolderNoteNameTemplate` setting overrides it (issue #153). The note is brand-new and empty, so
 * the move carries no links or backlinks to fix.
 *
 * @param params - The parameters.
 * @returns The overriding base name the note was given inside the folder, or `null` when it kept the
 * folder's name.
 */
export async function moveIntoOwnFolder(params: MoveIntoOwnFolderParams): Promise<null | string> {
  const { app, file } = params;
  const parentPath = file.parent?.path ?? '';
  const originalBasename = file.basename;
  const desiredFolderPath = normalizePath(parentPath ? `${parentPath}/${originalBasename}` : originalBasename);
  const folderPath = getAvailableFolderPath(app, desiredFolderPath);
  await createFolderSafe(app, folderPath);
  const noteBasename = resolveNoteBasenameInOwnFolder(params, folderPath);
  // The folder was just created and is therefore empty, so the note can never collide inside it.
  await app.fileManager.renameFile(file, normalizePath(`${folderPath}/${noteBasename}.md`));
  return noteBasename === originalBasename ? null : noteBasename;
}

/**
 * Resolves the base name a note gets inside its own folder from the `splitIntoFolderNoteNameTemplate`
 * setting (issue #153), so every folder split can produce e.g. `<dir>/<name>/Overview.md`. Tokens are
 * resolved against the note as it exists *before* the move, so `{{newTitle}}` is the folder's name. An
 * empty setting, a template resolving to nothing, or a name that still spans folders after sanitization
 * all fall back to the folder's name (today's behavior).
 *
 * The `Name transform template` deliberately does NOT run here (issue #196): `{{newTitle}}` is the note
 * whose name the transform already produced, so running it again would apply the rewrite twice.
 *
 * The folder-flavored tokens (`{{folderName}}`, `{{index}}`, ... — issue #227) are pointed at
 * `folderPath` explicitly, because at this moment the note has NOT been renamed into that folder yet:
 * left to resolve against the note's own parent they would name the folder ABOVE the one being created,
 * which is never what a note-name template inside it means. `{{parentFolder}}` is deliberately left
 * alone and still names that folder above — it is a shipped token in a shipped template.
 *
 * @param params - The parameters of the move.
 * @param folderPath - The folder the note is about to be moved into.
 * @returns The base name to give the note inside its folder, without the `.md` extension.
 */
function resolveNoteBasenameInOwnFolder(params: MoveIntoOwnFolderParams, folderPath: string): string {
  const {
    file,
    pluginSettingsComponent,
    sourceFile
  } = params;
  const template = pluginSettingsComponent.settings.splitIntoFolderNoteNameTemplate;
  if (!template) {
    return file.basename;
  }

  const resolved = resolveTemplateTokens({
    content: '',
    folderNameTemplate: pluginSettingsComponent.settings.reorderedFolderNameTemplate,
    folderPath,
    sourceFile,
    targetFile: file,
    template
  });

  const noteName = trimEnd({ $string: resolved.trim(), suffix: '.md' }).trim();
  if (!noteName) {
    return file.basename;
  }

  const { settings } = pluginSettingsComponent;
  const fixedNoteName = fixFileName({
    fileName: noteName,
    replacement: settings.replacement,
    shouldReplaceInvalidCharacters: settings.shouldReplaceInvalidTitleCharacters,
    shouldTreatTitleAsPath: false
  });
  // Only reachable when `shouldReplaceInvalidTitleCharacters` is off, leaving a separator in place.
  // Renaming into the folder that separator implies would fail, since it does not exist.
  if (fixedNoteName.includes('/') || fixedNoteName.includes('\\')) {
    return file.basename;
  }

  return fixedNoteName;
}
