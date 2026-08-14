/**
 * @file
 *
 * The ONE place that knows how the plugin opens a file once an operation has finished.
 *
 * Four flows end by putting the user in the note they just produced — a single-note merge
 * (`shouldOpenNoteAfterMerge`), a split/extract (`shouldOpenTargetNoteAfterSplit`), a folder merged into a
 * single file (issue #212) and a folder merged into another folder (issue #215) — and they had drifted into
 * two copies of the same four lines before the last two arrived.
 *
 * Clicking a folder in an operation notice opens that folder's folder note on demand (issue #234) and wants
 * the same settle for the same reason — but since `obsidian-dev-utils` 94.2.0 that click is
 * `renderInternalLink`'s, and it settles for itself. This helper is the operation flows' alone again.
 *
 * The settle delay is the part worth centralizing: the open runs immediately after a transaction that has
 * just created, rewritten and trashed notes, and opening into the middle of Obsidian's own reaction to that
 * showed the note before its metadata caught up.
 *
 * What is NOT here: the batch flows' per-note `shouldOpenAfterMerge: false` (issue #106 — a folder merge must
 * not flicker the active tab through every merged note). This helper is the SINGLE open layered on top of
 * that suppression, so a caller that opens one file at the end of a batch is doing the right thing and a
 * caller that calls it in a loop is not.
 */

import type {
  App,
  TFile
} from 'obsidian';

/**
 * How long to let Obsidian settle before opening the file. The operation has just mutated the vault, so the
 * metadata cache and the file explorer are still catching up when the transaction returns; opening into that
 * showed the note mid-update. Carried over unchanged from the merge/split composers, where it has held since
 * they first opened their targets.
 */
const DELAY_BEFORE_OPEN_IN_MILLISECONDS = 200;

/**
 * Parameters for {@link openFileAfterOperation}.
 */
export interface OpenFileAfterOperationParams {
  readonly app: App;

  /**
   * The file to open — the note the operation produced, already at its final path (a flow that renames its
   * result must open it AFTER the rename; a `TFile` reference survives one, a captured path does not).
   */
  readonly file: TFile;
}

/**
 * Opens the file an operation produced in the active leaf, once the vault has settled.
 *
 * An operation calls this only once COMPLETED — a cancelled or rolled-back one must leave the user where
 * they were, so every such caller sits after its transaction has committed.
 *
 * @param params - The app and the file to open.
 * @returns A {@link Promise} that resolves once the file is open.
 */
export async function openFileAfterOperation(params: OpenFileAfterOperationParams): Promise<void> {
  const { app, file } = params;
  await sleep(DELAY_BEFORE_OPEN_IN_MILLISECONDS);
  await app.workspace.getLeaf().openFile(file, {
    active: true
  });
}
