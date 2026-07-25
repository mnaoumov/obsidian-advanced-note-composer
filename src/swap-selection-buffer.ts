import type { TFile } from 'obsidian';

/**
 * A selection marked by the `Swap selections: Mark selection to swap` command, held until it is swapped
 * with another selection (`Swap selections: Swap with marked selection`) or a new selection is marked.
 */
export interface MarkedSwapSelection {
  /**
   * The exclusive end offset of the marked selection in the source note.
   */
  readonly endOffset: number;

  /**
   * The marked text.
   */
  readonly selectedText: string;

  /**
   * The note the selection was marked in.
   */
  readonly sourceFile: TFile;

  /**
   * The source note's modification time at mark time, used as a staleness guard so a stale offset can
   * never corrupt an edited source note.
   */
  readonly sourceMtime: number;

  /**
   * The inclusive start offset of the marked selection in the source note.
   */
  readonly startOffset: number;
}

/**
 * Holds the transient (non-persisted) selection marked for swapping, shared between the mark and swap
 * command handlers. Unlike {@link import('./move-selection-buffer.ts').MoveSelectionBuffer}, no lock,
 * notice, or highlight is held while a selection is marked — the swap acquires its own locks when it
 * runs.
 */
export class SwapSelectionBuffer {
  private markedSelection: MarkedSwapSelection | null = null;

  /**
   * Clears the mark. A no-op when nothing is marked.
   */
  public clear(): void {
    this.markedSelection = null;
  }

  /**
   * Gets the currently marked selection, or `null` when nothing is marked.
   *
   * @returns The marked selection, or `null`.
   */
  public get(): MarkedSwapSelection | null {
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
   * Replaces any existing mark with the given one.
   *
   * @param markedSelection - The selection to mark.
   */
  public mark(markedSelection: MarkedSwapSelection): void {
    this.markedSelection = markedSelection;
  }
}
