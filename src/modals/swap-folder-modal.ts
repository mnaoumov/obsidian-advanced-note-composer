import type {
  App,
  FuzzyMatch
} from 'obsidian';
import type { PromiseResolve } from 'obsidian-dev-utils/async';

import {
  FuzzySuggestModal,
  TFolder
} from 'obsidian';
import { isChildOrSelf } from 'obsidian-dev-utils/obsidian/vault';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { SuggestModalCommandBuilder } from './suggest-modal-command-builder.ts';

interface SelectTargetFolderForSwapParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly sourceFolder: TFolder;
}

interface SwapFolderModalConstructorParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly promiseResolve: PromiseResolve<null | SwapFolderModalResult>;
  readonly sourceFolder: TFolder;
}

interface SwapFolderModalResult {
  readonly shouldSwapEntireFolderStructure: boolean;
  readonly targetFolder: TFolder;
}

/* v8 ignore stop */

/* v8 ignore start -- SwapFolderModal is an internal UI class tested through exported functions. */
class SwapFolderModal extends FuzzySuggestModal<TFolder> {
  private isSelected = false;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly promiseResolve: PromiseResolve<null | SwapFolderModalResult>;
  private shouldIncludeChildFolders = false;
  private shouldIncludeParentFolders = false;
  private shouldSwapEntireFolderStructure = false;
  private readonly sourceFolder: TFolder;

  public constructor(params: SwapFolderModalConstructorParams) {
    super(params.app);

    this.promiseResolve = params.promiseResolve;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.sourceFolder = params.sourceFolder;

    this.setPlaceholder('Select folder to swap with...');
    this.shouldIncludeChildFolders = this.pluginSettingsComponent.settings.shouldIncludeChildFoldersWhenSwappingByDefault;
    this.shouldIncludeParentFolders = this.pluginSettingsComponent.settings.shouldIncludeParentFoldersWhenSwappingByDefault;
    this.shouldSwapEntireFolderStructure = this.pluginSettingsComponent.settings.shouldSwapEntireFolderStructureByDefault;

    const builder = new SuggestModalCommandBuilder();
    builder.addCheckbox({
      key: '1',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.shouldIncludeChildFolders = value;
        this.updateSuggestions();
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.shouldIncludeChildFolders;
      },
      purpose: 'Include child folders in selector'
    });
    builder.addCheckbox({
      key: '2',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.shouldIncludeParentFolders = value;
        this.updateSuggestions();
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.shouldIncludeParentFolders;
      },
      purpose: 'Include parent folders in selector'
    });
    builder.addCheckbox({
      key: '3',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.shouldSwapEntireFolderStructure = value;
        this.updateSuggestions();
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.shouldSwapEntireFolderStructure;
      },
      purpose: 'Should swap entire folder structure'
    });
    builder.build(this);
  }

  public override getItems(): TFolder[] {
    return this.app.vault.getAllFolders().filter((folder) => this.isAllowedTargetFolder(folder));
  }

  public override getItemText(item: TFolder): string {
    return item.path;
  }

  public override getSuggestions(query: string): FuzzyMatch<TFolder>[] {
    const suggestions = super.getSuggestions(query);
    if (query) {
      return suggestions;
    }
    const recentFolderPaths = this.app.workspace.getRecentFiles({
      showCanvas: true,
      showImages: true,
      showMarkdown: true,
      showNonAttachments: true,
      showNonImageAttachments: true
    });
    const recentFolders: TFolder[] = [];
    const recentFoldersSet = new Set<TFolder>();
    for (const folderPath of recentFolderPaths) {
      const recentFile = this.app.vault.getFileByPath(folderPath);
      const recentFolder = recentFile?.parent;
      if (!recentFolder) {
        continue;
      }
      if (!this.isAllowedTargetFolder(recentFolder)) {
        continue;
      }
      if (recentFoldersSet.has(recentFolder)) {
        continue;
      }
      recentFoldersSet.add(recentFolder);
      recentFolders.push(recentFolder);
    }
    const recentSuggestions = recentFolders.map((recenTFolder) => ({ item: recenTFolder, match: { matches: [], score: 0 } }));
    const otherSuggestions = suggestions.filter((suggestion) => !recentFoldersSet.has(suggestion.item));
    return [...recentSuggestions, ...otherSuggestions];
  }

  public override onChooseItem(item: TFolder): void {
    this.isSelected = true;
    this.promiseResolve({ shouldSwapEntireFolderStructure: this.shouldSwapEntireFolderStructure, targetFolder: item });
  }

  public override onClose(): void {
    super.onClose();
    if (!this.isSelected) {
      this.promiseResolve(null);
    }
  }

  public override selectSuggestion(value: FuzzyMatch<TFolder>, evt: KeyboardEvent | MouseEvent): void {
    this.isSelected = true;
    super.selectSuggestion(value, evt);
  }

  private isAllowedTargetFolder(folder: TFolder): boolean {
    if (folder === this.sourceFolder) {
      return false;
    }
    if (!this.shouldIncludeParentFolders && isChildOrSelf({ app: this.app, childPathOrFile: this.sourceFolder, parentPathOrFile: folder })) {
      return false;
    }
    if (!this.shouldIncludeChildFolders && isChildOrSelf({ app: this.app, childPathOrFile: folder, parentPathOrFile: this.sourceFolder })) {
      return false;
    }
    return !this.pluginSettingsComponent.settings.isPathIgnored(folder.path);
  }
}

export async function selectTargetFolderForSwap(params: SelectTargetFolderForSwapParams): Promise<null | SwapFolderModalResult> {
  return new Promise<null | SwapFolderModalResult>((promiseResolve) => {
    const modal = new SwapFolderModal({
      ...params,
      promiseResolve
    });
    modal.open();
  });
}
