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
import type { Plugin } from '../plugin.ts';
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

  public getPlugin(): Plugin {
    return this.plugin;
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
    const mockPlugin = strictProxy<Plugin>({
      app: mockApp
    });
    const mockSourceFile = strictProxy<TFile>({
      path: 'test.md'
    });
    const mockItem = strictProxy<Item>({
      type: 'file'
    });

    const params: ItemSelectorBaseConstructorParams = {
      inputValue: 'test input',
      isMod: true,
      item: mockItem,
      plugin: mockPlugin,
      sourceFile: mockSourceFile
    };

    const selector = new ConcreteItemSelector(params);

    expect(selector.getApp()).toBe(mockApp);
    expect(selector.getPlugin()).toBe(mockPlugin);
    expect(selector.getSourceFile()).toBe(mockSourceFile);
    expect(selector.getItem()).toBe(mockItem);
    expect(selector.getIsMod()).toBe(true);
    expect(selector.getInputValue()).toBe('test input');
  });

  it('should handle null item', () => {
    const mockApp = strictProxy<App>({});
    const mockPlugin = strictProxy<Plugin>({
      app: mockApp
    });
    const mockSourceFile = strictProxy<TFile>({
      path: 'test.md'
    });

    const params: ItemSelectorBaseConstructorParams = {
      inputValue: '',
      isMod: false,
      item: null,
      plugin: mockPlugin,
      sourceFile: mockSourceFile
    };

    const selector = new ConcreteItemSelector(params);

    expect(selector.getItem()).toBeNull();
  });

  it('should delegate selectItem to subclass', async () => {
    const mockApp = strictProxy<App>({});
    const mockPlugin = strictProxy<Plugin>({
      app: mockApp
    });
    const mockSourceFile = strictProxy<TFile>({
      path: 'test.md'
    });

    const params: ItemSelectorBaseConstructorParams = {
      inputValue: '',
      isMod: false,
      item: null,
      plugin: mockPlugin,
      sourceFile: mockSourceFile
    };

    const selector = new ConcreteItemSelector(params);
    const result = await selector.selectItem();

    expect(result.isNewTargetFile).toBe(false);
    expect(result.targetFile).toBe(mockSourceFile);
  });
});
