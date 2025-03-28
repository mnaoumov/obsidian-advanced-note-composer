import type { TFile } from 'obsidian';

export interface SuggestModalItem {
  file: TFile;
  match: unknown;
  type: 'file';
}
