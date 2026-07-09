import type {
  Editor,
  TFile
} from 'obsidian';

import type { Selection } from './composers/composer-base.ts';

/**
 * A selection marked by the `Mark selection to move` command, held until it is moved
 * (`Move marked selection here`) or the move is cancelled (`Cancel move`).
 */
export interface MarkedSelection {
  /**
   * Aborts the held source-note lock (also aborted by the built-in `Unlock active note` command).
   */
  readonly abortController: AbortController;

  /**
   * The marked selection offsets, captured from the source editor at mark time.
   */
  readonly capturedSelections: Selection[];

  /**
   * The held source-note lock, disposed by {@link MoveSelectionBuffer.clear}.
   */
  readonly lock: Disposable;

  /**
   * The marked text.
   */
  readonly selectedText: string;

  /**
   * The note the selection was marked in.
   */
  readonly sourceFile: TFile;

  /**
   * The source note's modification time at mark time, used as a defense-in-depth staleness guard.
   */
  readonly sourceMtime: number;
}

/**
 * Holds the transient (non-persisted) selection marked for moving, shared between the mark, move, and
 * cancel command handlers.
 */
export class MoveSelectionBuffer {
  private markedSelection: MarkedSelection | null = null;

  /**
   * Clears the mark and releases the held source-note lock. A no-op when nothing is marked.
   */
  public clear(): void {
    if (!this.markedSelection) {
      return;
    }
    this.markedSelection.lock[Symbol.dispose]();
    this.markedSelection = null;
  }

  /**
   * Gets the currently marked selection, or `null` when nothing is marked.
   *
   * @returns The marked selection, or `null`.
   */
  public get(): MarkedSelection | null {
    return this.markedSelection;
  }

  /**
   * Checks whether a selection is currently marked.
   *
   * @returns Whether a selection is marked.
   */
  public hasMark(): boolean {
    return this.markedSelection !== null;
  }

  /**
   * Checks whether the given editor's cursor is strictly inside any marked selection range. Only
   * meaningful when the editor shows the note the selection was marked in.
   *
   * @param editor - The editor to check the cursor of.
   * @returns Whether the cursor is inside a marked selection.
   */
  public isCursorInsideMarkedSelection(editor: Editor): boolean {
    if (!this.markedSelection) {
      return false;
    }
    const cursorOffset = editor.posToOffset(editor.getCursor());
    return this.markedSelection.capturedSelections.some(
      (selection) => cursorOffset > selection.startOffset && cursorOffset < selection.endOffset
    );
  }

  /**
   * Replaces any existing mark (releasing its lock) with the given one.
   *
   * @param markedSelection - The selection to mark.
   */
  public mark(markedSelection: MarkedSelection): void {
    this.clear();
    this.markedSelection = markedSelection;
  }
}
