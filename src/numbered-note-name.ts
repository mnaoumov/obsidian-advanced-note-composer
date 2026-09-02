/**
 * @file
 *
 * Numbering the NOTE a split creates, so it continues the numbering its sibling notes already carry
 * (issue #269).
 *
 * It is the other half of `move-into-own-folder.ts`'s folder numbering, and the two are mutually
 * exclusive by design: the reporter asked for the number to go on the folder "instead" whenever
 * `Should split into folder` puts the note in one, because numbering both would write the number twice
 * into the same path.
 */

import type {
  App,
  TFile
} from 'obsidian';

import { normalizePath } from 'obsidian';
import { getAvailablePath } from 'obsidian-dev-utils/obsidian/vault';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import { resolveNextSiblingIndex } from './next-sibling-index.ts';
import { ReorderItemKind } from './reorder-items.ts';
import { resolveReorderedFileTemplateTokens } from './template-tokens.ts';

/**
 * Parameters for {@link applyNumberedNoteName}.
 */
export interface ApplyNumberedNoteNameParams {
  readonly app: App;

  /**
   * The just-created note to renumber (mutated in place by the rename).
   */
  readonly file: TFile;

  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Renames a freshly-created note so its name carries the next number in its folder's note sequence
 * (issue #269) — `1 + max` over the already-numbered sibling NOTES, so the reporter's own `1, 3, 4`
 * continues at `5`: a gap is never backfilled, and a deleted note in the middle can never cause a
 * collision. Numbered FOLDERS beside it are a separate sequence and are not consulted, and neither is an
 * attachment.
 *
 * It runs AFTER the note exists rather than on the typed name, and that is what makes it correct rather
 * than merely convenient: only by then has the destination been settled by everything that has a say in it
 * — a picked folder, a `/` in the typed name under `shouldTreatTitleAsPath`, Obsidian's own
 * `Default location for new notes`, and its de-duplication of a colliding name. Reading `file.parent` is
 * therefore the only way to scan the siblings the note actually landed among.
 *
 * An empty `numberedSplitNoteNameTemplate` — the default — is the opt-out and leaves the note untouched.
 *
 * @param params - The created note and the settings the template is read from.
 * @returns Nothing; the note is renamed in place.
 */
export async function applyNumberedNoteName(params: ApplyNumberedNoteNameParams): Promise<void> {
  const { app, file, pluginSettingsComponent } = params;
  const template = pluginSettingsComponent.settings.numberedSplitNoteNameTemplate;
  if (!template) {
    return;
  }

  const parentFolder = file.parent ?? app.vault.getRoot();
  const renderedName = resolveReorderedFileTemplateTokens({
    template,
    tokens: {
      extension: `.${file.extension}`,
      index: resolveNextSiblingIndex({ kind: ReorderItemKind.File, nameTemplate: template, parentFolder }),
      // The template IS the name, so the tokens naming its result resolve to nothing — the same rule
      // `Create folder with notes...` follows for its own name template, and the settings validator
      // Rejects both keys here.
      name: '',
      parentFolder: parentFolder.name,
      parentFolderPath: parentFolder.path,
      path: '',
      safeName: file.basename
    }
  }).trim();

  if (!renderedName || renderedName === file.basename) {
    return;
  }

  const desiredPath = normalizePath(`${parentFolder.getParentPrefix()}${renderedName}.${file.extension}`);
  await app.fileManager.renameFile(file, getAvailablePath(app, desiredPath));
}
