import type {
  FuzzyMatch,
  TFolder
} from 'obsidian';

import {
  App,
  FuzzySuggestModal
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/Async';

export class MergeFolderModal extends FuzzySuggestModal<TFolder> {
  public constructor(app: App, private readonly sourceFolder: TFolder, private readonly callback: (targetFolder: TFolder) => Promise<void>) {
    super(app);
    this.setPlaceholder('Select folder to merge into...');
  }

  public override getItems(): TFolder[] {
    return this.app.vault.getAllFolders(true).filter((folder) => folder !== this.sourceFolder);
  }

  public override getItemText(item: TFolder): string {
    return item.path;
  }

  public override getSuggestions(query: string): FuzzyMatch<TFolder>[] {
    const suggestions = super.getSuggestions(query);
    if (query) {
      return suggestions;
    }

    const recentFilePaths = this.app.workspace.getRecentFiles({
      showCanvas: true,
      showImages: true,
      showMarkdown: true,
      showNonAttachments: true,
      showNonImageAttachments: true
    });

    const recentFolders: TFolder[] = [];
    const recentFoldersSet = new Set<TFolder>();

    for (const filePath of recentFilePaths) {
      const file = this.app.vault.getFileByPath(filePath);
      if (!file?.parent) {
        continue;
      }
      if (file.parent === this.sourceFolder) {
        continue;
      }
      if (recentFoldersSet.has(file.parent)) {
        continue;
      }
      recentFoldersSet.add(file.parent);
      recentFolders.push(file.parent);
    }

    const recentSuggestions = recentFolders.map((folder) => ({
      item: folder,
      match: {
        matches: [],
        score: 0
      }
    }));

    const otherSuggestions = suggestions.filter((suggestion) => !recentFoldersSet.has(suggestion.item));

    return [...recentSuggestions, ...otherSuggestions];
  }

  public override onChooseItem(item: TFolder): void {
    this.close();
    invokeAsyncSafely(async () => {
      await this.callback(item);
    });
  }
}
