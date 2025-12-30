import type { FuzzyMatch } from 'obsidian';

import {
  FuzzySuggestModal,
  TFile
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/Async';
import { isChildOrSelf } from 'obsidian-dev-utils/obsidian/Vault';

import type { Plugin } from '../Plugin.ts';

export class SwapFileModal extends FuzzySuggestModal<TFile> {
  public constructor(
    private readonly plugin: Plugin,
    private readonly sourceFile: TFile,
    private readonly callback: (targetFile: TFile) => Promise<void>
  ) {
    super(plugin.app);
    this.setPlaceholder('Select file to swap with...');
  }

  public override getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles().filter((file) => this.isAllowedTargetFile(file));
  }

  public override getItemText(item: TFile): string {
    return item.path;
  }

  public override getSuggestions(query: string): FuzzyMatch<TFile>[] {
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

    const recentFiles: TFile[] = [];
    const recentFilesSet = new Set<TFile>();

    for (const filePath of recentFilePaths) {
      const recentFile = this.app.vault.getFileByPath(filePath);
      if (!recentFile) {
        continue;
      }
      if (!this.isAllowedTargetFile(recentFile)) {
        continue;
      }
      if (recentFilesSet.has(recentFile)) {
        continue;
      }

      recentFilesSet.add(recentFile);
      recentFiles.push(recentFile);
    }

    const recentSuggestions = recentFiles.map((recenTFile) => ({
      item: recenTFile,
      match: {
        matches: [],
        score: 0
      }
    }));

    const otherSuggestions = suggestions.filter((suggestion) => !recentFilesSet.has(suggestion.item));

    return [...recentSuggestions, ...otherSuggestions];
  }

  public override onChooseItem(item: TFile): void {
    invokeAsyncSafely(async () => {
      await this.callback(item);
    });
  }

  private isAllowedTargetFile(file: TFile): boolean {
    if (isChildOrSelf(this.app, this.sourceFile, file)) {
      return false;
    }

    if (isChildOrSelf(this.app, file, this.sourceFile)) {
      return false;
    }

    return !this.plugin.settings.isPathIgnored(file.path);
  }
}
