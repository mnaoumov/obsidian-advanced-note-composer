import type {
  App,
  TFile
} from 'obsidian';

import type { Item } from '../modals/suggest-modal-base.ts';
import type { Plugin } from '../plugin.ts';

export interface ItemSelectorBaseConstructorParams {
  readonly inputValue: string;
  readonly isMod: boolean;
  readonly item: Item | null;
  readonly plugin: Plugin;
  readonly sourceFile: TFile;
}

export interface SelectItemResult {
  isNewTargetFile: boolean;
  targetFile: TFile;
}

export abstract class ItemSelectorBase {
  protected readonly app: App;
  protected readonly inputValue: string;
  protected readonly isMod: boolean;
  protected readonly item: Item | null;
  protected readonly plugin: Plugin;
  protected readonly sourceFile: TFile;

  public constructor(params: ItemSelectorBaseConstructorParams) {
    this.app = params.plugin.app;
    this.plugin = params.plugin;
    this.sourceFile = params.sourceFile;
    this.item = params.item;
    this.isMod = params.isMod;
    this.inputValue = params.inputValue;
  }
  public abstract selectItem(): Promise<SelectItemResult>;
}
