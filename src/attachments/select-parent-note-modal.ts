/**
 * @file
 *
 * The picker `Inline attachment note into its parent` opens when more than one note links the attachment note:
 * which of them becomes the attachment's parent.
 */

import type { PromiseResolve } from '@mnaoumov/typescript-lib/async';
import type {
  App,
  FuzzyMatch,
  TFile
} from 'obsidian';

import { FuzzySuggestModal } from 'obsidian';

import { openModal } from '../ui/open-minimizable-modal.ts';

/**
 * Parameters for {@link selectParentNote}.
 */
export interface SelectParentNoteParams {
  /**
   * The Obsidian application instance.
   */
  readonly app: App;

  /**
   * The notes to choose from.
   */
  readonly candidates: readonly TFile[];
}

interface SelectParentNoteModalConstructorParams extends SelectParentNoteParams {
  readonly promiseResolve: PromiseResolve<null | TFile>;
}

/* v8 ignore start -- SelectParentNoteModal is an internal UI class exercised by the desktop integration test. */
class SelectParentNoteModal extends FuzzySuggestModal<TFile> {
  private readonly candidates: readonly TFile[];
  private isSelected = false;
  private readonly promiseResolve: PromiseResolve<null | TFile>;

  public constructor(params: SelectParentNoteModalConstructorParams) {
    super(params.app);
    this.candidates = params.candidates;
    this.promiseResolve = params.promiseResolve;
    this.setPlaceholder('Select the note the attachment moves into...');
  }

  public override getItems(): TFile[] {
    return [...this.candidates];
  }

  public override getItemText(item: TFile): string {
    return item.path;
  }

  public override onChooseItem(item: TFile): void {
    this.promiseResolve(item);
  }

  public override onClose(): void {
    super.onClose();
    if (!this.isSelected) {
      this.promiseResolve(null);
    }
  }

  public override selectSuggestion(value: FuzzyMatch<TFile>, $event: KeyboardEvent | MouseEvent): void {
    this.isSelected = true;
    super.selectSuggestion(value, $event);
  }
}

/**
 * Asks which note becomes the attachment's parent.
 *
 * @param params - The candidates.
 * @returns The chosen note, or `null` when the picker was dismissed.
 */
export async function selectParentNote(params: SelectParentNoteParams): Promise<null | TFile> {
  return await new Promise<null | TFile>((promiseResolve) => {
    openModal(new SelectParentNoteModal({ ...params, promiseResolve }));
  });
}
/* v8 ignore stop */
