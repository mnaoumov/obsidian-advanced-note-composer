import type { FuzzyMatch } from 'obsidian';
import type { PromiseResolve } from 'obsidian-dev-utils/Async';

import {
  FuzzySuggestModal,
  TFile
} from 'obsidian';
import { isChildOrSelf } from 'obsidian-dev-utils/obsidian/Vault';

import type { Plugin } from '../Plugin.ts';

class SwapFileModal extends FuzzySuggestModal<TFile> {
  private isSelected = false;

  public constructor(
    private readonly plugin: Plugin,
    private readonly sourceFile: TFile,
    private readonly promiseResolve: PromiseResolve<null | TFile>
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
    this.isSelected = true;
    this.promiseResolve(item);
  }

  public override onClose(): void {
    super.onClose();
    if (!this.isSelected) {
      this.promiseResolve(null);
    }
  }

  public override selectSuggestion(value: FuzzyMatch<TFile>, evt: KeyboardEvent | MouseEvent): void {
    this.isSelected = true;
    super.selectSuggestion(value, evt);
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

export async function selectFileForSwap(plugin: Plugin, sourceFile: TFile): Promise<null | TFile> {
  return new Promise<null | TFile>((resolve) => {
    const modal = new SwapFileModal(plugin, sourceFile, resolve);
    modal.open();
  });
}
