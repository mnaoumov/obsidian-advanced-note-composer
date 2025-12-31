import type { FuzzyMatch } from 'obsidian';

import {
  FuzzySuggestModal,
  TFolder
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/Async';
import { isChildOrSelf } from 'obsidian-dev-utils/obsidian/Vault';

import type { Plugin } from '../Plugin.ts';

import { SuggestModalCommandBuilder } from './SuggestModalCommandBuilder.ts';

export class SwapFolderModal extends FuzzySuggestModal<TFolder> {
  private shouldIncludeChildFolders = false;
  private shouldIncludeParentFolders = false;
  private shouldSwapEntireFolderStructure = false;

  public constructor(
    private readonly plugin: Plugin,
    private readonly sourceFolder: TFolder,
    private readonly callback: (targetFolder: TFolder, shouldSwapEntireFolderStructure: boolean) => Promise<void>
  ) {
    super(plugin.app);
    this.setPlaceholder('Select folder to swap with...');
    this.shouldIncludeChildFolders = plugin.settings.shouldIncludeChildFoldersWhenSwappingByDefault;
    this.shouldIncludeParentFolders = plugin.settings.shouldIncludeParentFoldersWhenSwappingByDefault;
    this.shouldSwapEntireFolderStructure = plugin.settings.shouldSwapEntireFolderStructureByDefault;

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
      purpose: 'Include child folders'
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
      purpose: 'Include parent folders'
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
      purpose: 'Include parent folders'
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

    const recentSuggestions = recentFolders.map((recenTFolder) => ({
      item: recenTFolder,
      match: {
        matches: [],
        score: 0
      }
    }));

    const otherSuggestions = suggestions.filter((suggestion) => !recentFoldersSet.has(suggestion.item));

    return [...recentSuggestions, ...otherSuggestions];
  }

  public override onChooseItem(item: TFolder): void {
    invokeAsyncSafely(async () => {
      await this.callback(item, this.shouldSwapEntireFolderStructure);
    });
  }

  private isAllowedTargetFolder(folder: TFolder): boolean {
    if (folder === this.sourceFolder) {
      return false;
    }

    if (!this.shouldIncludeParentFolders && isChildOrSelf(this.app, this.sourceFolder, folder)) {
      return false;
    }

    if (!this.shouldIncludeChildFolders && isChildOrSelf(this.app, folder, this.sourceFolder)) {
      return false;
    }

    return !this.plugin.settings.isPathIgnored(folder.path);
  }
}
