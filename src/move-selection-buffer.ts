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
   * Aborting this cancels the entire pending move: the held lock is taken with `shouldReleaseOnAbort`
   * and an `onUnlockRequested` callback that calls {@link MoveSelectionBuffer.clear}, so the abort
   * releases the held lock, drops the mark, and hides the notice. Aborted by the `Unlock active note`
   * command and by the lock indicator's right-click unlock. Also serves as the mark's unique identity
   * used to guard against a stale controller clearing a newer mark.
   */
  readonly abortController: AbortController;

  /**
   * The marked selection offsets, captured from the source editor at mark time.
   */
  readonly capturedSelections: Selection[];

  /**
   * The persistent source-selection highlight, removed by {@link MoveSelectionBuffer.clear}.
   */
  readonly highlight: Disposable;

  /**
   * The held source-note lock, disposed by {@link MoveSelectionBuffer.clear}.
   */
  readonly lock: Disposable;

  /**
   * The permanent notice reminding the user a selection is marked, hidden by {@link MoveSelectionBuffer.clear}.
   * `null` when the `Smart cut & paste` notice is disabled via settings, in which case nothing is shown.
   */
  readonly notice: Notice | null;

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

interface MoveSelectionBufferIsRangeOverlappingMarkedSelectionParams {
  readonly endOffset: number;
  readonly startOffset: number;
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
    this.markedSelection.highlight[Symbol.dispose]();
    const notice = this.markedSelection.notice;
    this.markedSelection = null;
    notice?.hide();
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
    return this.isRangeOverlappingMarkedSelection({ endOffset: offset, startOffset: offset });
  }

  /**
   * Checks whether the given `[startOffset, endOffset]` range overlaps any marked selection. Only
   * meaningful when the offsets refer to the note the selection was marked in. Used to reject an insert
   * range (a derived top/bottom offset, or a replace-over-selection range at the cursor) that overlaps
   * the text being moved, which would corrupt it. A zero-length range (`startOffset === endOffset`)
   * overlaps only when it is strictly inside a marked selection.
   *
   * @param params - The parameters.
   * @returns Whether the range overlaps a marked selection.
   */
  public isRangeOverlappingMarkedSelection(params: MoveSelectionBufferIsRangeOverlappingMarkedSelectionParams): boolean {
    const { endOffset, startOffset } = params;
    if (!this.markedSelection) {
      return false;
    }
    return this.markedSelection.capturedSelections.some(
      (selection) => startOffset < selection.endOffset && selection.startOffset < endOffset
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
