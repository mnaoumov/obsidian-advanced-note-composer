import type { FuzzyMatch } from 'obsidian';

import {
  FuzzySuggestModal,
  TFolder
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/Async';
import { isChildOrSelf } from 'obsidian-dev-utils/obsidian/Vault';

import type { Plugin } from '../Plugin.ts';

export class SwapFolderModal extends FuzzySuggestModal<TFolder> {
  public constructor(
    private readonly plugin: Plugin,
    private readonly sourceFolder: TFolder,
    private readonly callback: (targetFolder: TFolder) => Promise<void>
  ) {
    super(plugin.app);
    this.setPlaceholder('Select folder to swap with...');
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
      await this.callback(item);
    });
  }

  private isAllowedTargetFolder(folder: TFolder): boolean {
    if (isChildOrSelf(this.app, this.sourceFolder, folder)) {
      return false;
    }

    if (isChildOrSelf(this.app, folder, this.sourceFolder)) {
      return false;
    }

    return !this.plugin.settings.isPathIgnored(folder.path);
  }
}
