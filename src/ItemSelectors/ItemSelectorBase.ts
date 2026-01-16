import type { App, TFile } from "obsidian";

export interface SelectItemResult {
  targetFile: TFile;
  isNewTargetFile: boolean;
}

import type { Plugin } from "../Plugin.ts";
import type { Item } from "../Modals/SuggestModalBase.ts";

export interface ItemSelectorBaseOptions {
  plugin: Plugin;
  sourceFile: TFile;
  item: Item | null;
  isMod: boolean;
  inputValue: string;
}

export abstract class ItemSelectorBase {
  protected readonly app: App;
  protected readonly plugin: Plugin;
  protected readonly sourceFile: TFile;
  protected readonly item: Item | null;
  protected readonly isMod: boolean;
  protected readonly inputValue: string;

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
