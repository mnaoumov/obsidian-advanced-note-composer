import type {
  App,
  TFile
} from 'obsidian';

import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';
import type { Item } from '../ui/suggest-modal-base.ts';

export interface ItemSelectorBaseConstructorParams {
  readonly app: App;
  readonly inputValue: string;
  readonly isModifier: boolean;
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
  protected readonly isModifier: boolean;
  protected readonly item: Item | null;
  protected readonly pluginSettingsComponent: PluginSettingsComponent;
  protected readonly sourceFile: TFile;

  public constructor(params: ItemSelectorBaseConstructorParams) {
    this.app = params.app;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.sourceFile = params.sourceFile;
    this.item = params.item;
    this.isModifier = params.isModifier;
    this.inputValue = params.inputValue;
  }
  public abstract selectItem(): Promise<SelectItemResult>;
}
