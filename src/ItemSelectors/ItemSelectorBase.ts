import type {
  App,
  TFile
} from 'obsidian';

import type { Item } from '../Modals/SuggestModalBase.ts';
import type { Plugin } from '../Plugin.ts';

export interface ItemSelectorBaseOptions {
  inputValue: string;
  isMod: boolean;
  item: Item | null;
  plugin: Plugin;
  sourceFile: TFile;
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

  public constructor(options: ItemSelectorBaseOptions) {
    this.app = options.plugin.app;
    this.plugin = options.plugin;
    this.sourceFile = options.sourceFile;
    this.item = options.item;
    this.isMod = options.isMod;
    this.inputValue = options.inputValue;
  }
  public abstract selectItem(): Promise<SelectItemResult>;
}
