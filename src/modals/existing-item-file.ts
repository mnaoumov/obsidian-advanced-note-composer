/**
 * @file
 *
 * The one answer to "does this picker row name a note that already exists?".
 *
 * It was `SplitItemSelector`'s private `resolveExistingTargetFile`, and became shared when the split
 * picker needed the same answer at CHOOSING time (issue #257): a click on a row that names an existing
 * note is unambiguous even while the picker is in `Create` mode with nothing typed, which is the one case
 * where a click used to do nothing at all.
 */

import type {
  App,
  TFile
} from 'obsidian';

import type { Item } from './suggest-modal-base.ts';

/**
 * The existing note a picker row names, or `null` when it names none.
 *
 * A bookmark carries its path rather than a `file` (`SuggestModalBase` offers bookmarked notes in the
 * split picker too), so it is resolved the same way `MergeItemSelector` resolves it — reading only
 * `item.file` would silently treat a bookmarked note as "nothing that exists".
 *
 * @param app - The app.
 * @param item - The chosen row, or `null` when the choice was made from what was typed.
 * @returns The existing note, or `null`.
 */
export function resolveExistingItemFile(app: App, item: Item | null | undefined): null | TFile {
  if (item?.file) {
    return item.file;
  }

  if (item?.type === 'bookmark' && item.item?.type === 'file') {
    return app.vault.getFileByPath(item.item.path ?? '');
  }

  return null;
}
