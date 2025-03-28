import type {
  SuggestModal,
  TFile
} from 'obsidian';

import type { SuggestModalItem } from './SuggestModalItem.ts';

export interface ModalBase extends SuggestModal<SuggestModalItem> {
  getSuggestions(query: string): Promise<SuggestModalItem[]> | SuggestModalItem[];

  onChooseSuggestion(item: SuggestModalItem, evt: KeyboardEvent | MouseEvent): void;
  renderSuggestion(value: SuggestModalItem, el: HTMLElement): void;
  setCurrentFile(file: TFile): void;
}
