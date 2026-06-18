import type {
  App,
  TFile
} from 'obsidian';

import type { Item } from '../modals/suggest-modal-base.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

export interface ItemSelectorBaseConstructorParams {
  readonly app: App;
  readonly inputValue: string;
  readonly isMod: boolean;
  readonly item: Item | null;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly sourceFile: TFile;
}

export interface SelectItemResult {
  readonly isNewTargetFile: boolean;
  readonly targetFile: TFile;
}

export abstract class ItemSelectorBase {
  protected readonly app: App;
  protected readonly inputValue: string;
  protected readonly isMod: boolean;
  protected readonly item: Item | null;
  protected readonly pluginSettingsComponent: PluginSettingsComponent;
  protected readonly sourceFile: TFile;

  public constructor(params: ItemSelectorBaseConstructorParams) {
    this.app = params.app;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.sourceFile = params.sourceFile;
    this.item = params.item;
    this.isMod = params.isMod;
    this.inputValue = params.inputValue;
  }
  public abstract selectItem(): Promise<SelectItemResult>;
}
