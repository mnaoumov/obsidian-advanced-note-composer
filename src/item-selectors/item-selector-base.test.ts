import type {
  App,
  TFile
} from 'obsidian';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { Item } from '../modals/suggest-modal-base.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type {
  ItemSelectorBaseConstructorParams,
  SelectItemResult
} from './item-selector-base.ts';

import { ItemSelectorBase } from './item-selector-base.ts';

class ConcreteItemSelector extends ItemSelectorBase {
  public getApp(): App {
    return this.app;
  }

  public getInputValue(): string {
    return this.inputValue;
  }

  public getIsMod(): boolean {
    return this.isMod;
  }

  public getItem(): Item | null {
    return this.item;
  }

  public getPluginSettingsComponent(): PluginSettingsComponent {
    return this.pluginSettingsComponent;
  }

  public getSourceFile(): TFile {
    return this.sourceFile;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- Mock implementation returns synchronously.
  public override async selectItem(): Promise<SelectItemResult> {
    return {
      isNewTargetFile: false,
      targetFile: this.sourceFile
    };
  }
}

describe('ItemSelectorBase', () => {
  it('should assign all fields from params', () => {
    const mockApp = strictProxy<App>({});
    const mockPluginSettingsComponent = strictProxy<PluginSettingsComponent>({});
    const mockSourceFile = strictProxy<TFile>({
      path: 'test.md'
    });
    const mockItem = strictProxy<Item>({
      type: 'file'
    });

    const params: ItemSelectorBaseConstructorParams = {
      app: mockApp,
      inputValue: 'test input',
      isMod: true,
      item: mockItem,
      pluginSettingsComponent: mockPluginSettingsComponent,
      sourceFile: mockSourceFile
    };

    const selector = new ConcreteItemSelector(params);

    expect(selector.getApp()).toBe(mockApp);
    expect(selector.getPluginSettingsComponent()).toBe(mockPluginSettingsComponent);
    expect(selector.getSourceFile()).toBe(mockSourceFile);
    expect(selector.getItem()).toBe(mockItem);
    expect(selector.getIsMod()).toBe(true);
    expect(selector.getInputValue()).toBe('test input');
  });

  it('should handle null item', () => {
    const mockApp = strictProxy<App>({});
    const mockPluginSettingsComponent = strictProxy<PluginSettingsComponent>({});
    const mockSourceFile = strictProxy<TFile>({
      path: 'test.md'
    });

    const params: ItemSelectorBaseConstructorParams = {
      app: mockApp,
      inputValue: '',
      isMod: false,
      item: null,
      pluginSettingsComponent: mockPluginSettingsComponent,
      sourceFile: mockSourceFile
    };

    const selector = new ConcreteItemSelector(params);

    expect(selector.getItem()).toBeNull();
  });

  it('should delegate selectItem to subclass', async () => {
    const mockApp = strictProxy<App>({});
    const mockPluginSettingsComponent = strictProxy<PluginSettingsComponent>({});
    const mockSourceFile = strictProxy<TFile>({
      path: 'test.md'
    });

    const params: ItemSelectorBaseConstructorParams = {
      app: mockApp,
      inputValue: '',
      isMod: false,
      item: null,
      pluginSettingsComponent: mockPluginSettingsComponent,
      sourceFile: mockSourceFile
    };

    const selector = new ConcreteItemSelector(params);
    const result = await selector.selectItem();

    expect(result.isNewTargetFile).toBe(false);
    expect(result.targetFile).toBe(mockSourceFile);
  });
});
