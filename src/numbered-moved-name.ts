/**
 * @file
 *
 * Numbering an item that a move or a flatten RELOCATES, so it continues the numbering the destination
 * folder's children already carry (issue #273).
 *
 * It is the relocation counterpart of `numbered-note-name.ts` / `move-into-own-folder.ts`, which number what
 * a split CREATES (issue #269), and it differs from them in the two ways a move differs from a creation:
 *
 * - the item already has a name, and that name may already carry an index — `3. B` moving into a folder
 *   whose highest number is `7` must become `8. B`, never `8. 3. B`. Stripping the old index is exactly what
 *   a reorder does, so the same {@link parseNumberedName} / `renderNumberedName` pair does it here;
 * - several items can move at once. `Flatten folder...` promotes every child of a folder in one pass, so the
 *   numbers have to ADVANCE across the batch rather than every item asking the vault the same question.
 */

import type {
  TAbstractFile,
  TFolder
} from 'obsidian';

import { isFile } from 'obsidian-dev-utils/obsidian/file-system';

import {
  resolveNextSiblingIndex,
  resolveSequenceKind
} from './next-sibling-index.ts';
import { parseNumberedName } from './numbered-name.ts';
import {
  BASE_TOKEN_KEYS,
  renderNumberedName,
  ReorderItemKind
} from './reorder-items.ts';

/**
 * Parameters for {@link createMovedNameSequence}.
 */
export interface CreateMovedNameSequenceParams {
  /**
   * `numberedMovedFolderNameTemplate`, as typed. Empty is the opt-out and leaves every moved folder named
   * exactly as it is today.
   */
  readonly folderNameTemplate: string;

  /**
   * `numberedMovedNoteNameTemplate`, as typed. Empty is the opt-out, as above.
   */
  readonly noteNameTemplate: string;

  /**
   * The folder the items are moving INTO — the one whose existing numbering is continued.
   */
  readonly targetFolder: TFolder;
}

/**
 * Hands out the name each relocated item should take, in the order they are relocated.
 */
export interface MovedNameSequence {
  /**
   * The name the item should be given in the destination folder, extension included for a file.
   *
   * Calling it CONSUMES a number, so it must be called exactly once per item and in move order. An item that
   * belongs to no sequence — an attachment, or any non-markdown file — and an item whose kind has no
   * template configured both come back with the name they already have, and consume nothing.
   *
   * @param abstractFile - The item about to be moved.
   * @returns The name to move it under, before de-duplication.
   */
  resolveName: (this: void, abstractFile: TAbstractFile) => string;
}

/**
 * An item's name split into the part a number is written around and the part that is carried across
 * untouched.
 */
interface ItemName {
  readonly baseName: string;

  /**
   * Leading dot included, or an empty string for a folder. Never templated.
   */
  readonly extension: string;
}

/**
 * Builds the numbering for ONE relocation — a single `Move folder to...`, or one whole `Flatten folder...`
 * pass — over one destination folder.
 *
 * The index is `1 + max` over the destination's already-numbered children OF THE SAME KIND, so the `1, 3, 4`
 * of issue #269 continues at `5` here too: a gap is never backfilled, and the number an item vacates in the
 * folder it LEFT is simply left vacant (closing that gap is what `Reorder sibling folders` is for, and it is
 * opt-in there).
 *
 * That starting point is read from the vault ONCE per kind and then counted UP, rather than re-read per
 * item, and the counter is the load-bearing part. The two callers stand on opposite sides of the write: the
 * flatten EXECUTOR renames into a vault that is changing under it, while the confirmation PREVIEW has no
 * vault state to read at all, because nothing has happened yet. A re-scan would answer correctly for the
 * first and repeat itself forever for the second, leaving the dialog promising names the flatten would not
 * give. One counter answers both identically — the same reason `flatten-preview.ts` already tracks the paths
 * it has handed out.
 *
 * @param params - The destination folder and the two templates.
 * @returns The sequence, which must be asked for each item in move order.
 */
export function createMovedNameSequence(params: CreateMovedNameSequenceParams): MovedNameSequence {
  const { folderNameTemplate, noteNameTemplate, targetFolder } = params;
  const nameTemplates: Record<ReorderItemKind, string> = {
    [ReorderItemKind.File]: noteNameTemplate,
    [ReorderItemKind.Folder]: folderNameTemplate
  };
  const nextIndexes = new Map<ReorderItemKind, number>();

  return {
    resolveName(abstractFile: TAbstractFile): string {
      // The SAME classification the sibling scan uses (`next-sibling-index.ts`), so an item can never be
      // Given a number that no later scan would read back — an attachment is not part of a note sequence.
      const kind = resolveSequenceKind(abstractFile);
      if (kind === null) {
        return abstractFile.name;
      }

      const nameTemplate = nameTemplates[kind];
      if (!nameTemplate) {
        return abstractFile.name;
      }

      const { baseName: currentBaseName, extension } = resolveItemName(abstractFile);
      // Read back through the very template that will write the new one, so an item that already carries an
      // Index is RENUMBERED rather than prefixed a second time. An item that never had one simply keeps its
      // Whole name as the base.
      const { baseName } = parseNumberedName({
        baseTokenKey: BASE_TOKEN_KEYS[kind],
        name: currentBaseName,
        nameTemplate
      });

      const index = nextIndexes.get(kind) ?? resolveNextSiblingIndex({ kind, nameTemplate, parentFolder: targetFolder });
      nextIndexes.set(kind, index + 1);

      const renderedName = renderNumberedName({
        baseName,
        extension,
        index,
        kind,
        nameTemplate,
        parentFolder: targetFolder.name,
        parentFolderPath: targetFolder.path
      }).trim();

      // A template rendering to nothing leaves the item exactly as it was. The settings validator makes that
      // Unreachable from the UI — it requires `{{index}}` and the base token — but this module takes the
      // Template as a parameter, so the name is never allowed to become an empty string.
      return renderedName ? `${renderedName}${extension}` : abstractFile.name;
    }
  };
}

/**
 * Splits an item's name the way its kind's template expects it: a file's basename and extension, a folder's
 * whole name and nothing.
 *
 * @param abstractFile - The item being moved.
 * @returns The base name and the extension.
 */
function resolveItemName(abstractFile: TAbstractFile): ItemName {
  return isFile(abstractFile)
    ? { baseName: abstractFile.basename, extension: `.${abstractFile.extension}` }
    : { baseName: abstractFile.name, extension: '' };
}
