import type {
  Editor,
  Notice,
  TFile
} from 'obsidian';

import type { Selection } from './composers/composer-base.ts';

/**
 * A selection marked by the `Mark selection to move` command, held until it is moved
 * (`Move marked selection here`) or the move is cancelled (`Cancel move`).
 */
export interface MarkedSelection {
  /**
   * Aborting this cancels the entire pending move: the mark handler wires the abort to
   * {@link MoveSelectionBuffer.clear}, which releases the held lock, drops the mark, and hides the
   * notice. Aborted by the `Unlock active note` command and by the lock indicator's right-click unlock.
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
   * The permanent notice reminding the user a selection is marked, hidden by {@link MoveSelectionBuffer.clear}.
   */
  readonly notice: Notice;

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
    this.markedSelection.notice.hide();
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
    return this.isOffsetInsideMarkedSelection(editor.posToOffset(editor.getCursor()));
  }

  /**
   * Checks whether the given offset is strictly inside any marked selection range. Only meaningful when
   * the offset refers to the note the selection was marked in. Used to reject an insert point (cursor
   * or a derived top/bottom offset) that falls inside the text being moved, which would corrupt it.
   *
   * @param offset - The offset to check.
   * @returns Whether the offset is inside a marked selection.
   */
  public isOffsetInsideMarkedSelection(offset: number): boolean {
    if (!this.markedSelection) {
      return false;
    }
    return this.markedSelection.capturedSelections.some(
      (selection) => offset > selection.startOffset && offset < selection.endOffset
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
