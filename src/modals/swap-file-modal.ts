import type {
  App,
  FuzzyMatch
} from 'obsidian';
import type { PromiseResolve } from 'obsidian-dev-utils/async';

import {
  FuzzySuggestModal,
  TFile
} from 'obsidian';
import { isChildOrSelf } from 'obsidian-dev-utils/obsidian/vault';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { openMinimizableModal } from '../open-minimizable-modal.ts';

interface SelectFileForSwapParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly sourceFile: TFile;
}

interface SwapFileModalConstructorParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly promiseResolve: PromiseResolve<null | TFile>;
  readonly sourceFile: TFile;
}

/* v8 ignore stop */

/* v8 ignore start -- SwapFileModal is an internal UI class tested through exported functions. */
class SwapFileModal extends FuzzySuggestModal<TFile> {
  private isSelected = false;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly promiseResolve: PromiseResolve<null | TFile>;

  private readonly sourceFile: TFile;

  public constructor(params: SwapFileModalConstructorParams) {
    super(params.app);

    this.sourceFile = params.sourceFile;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.promiseResolve = params.promiseResolve;

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
    const recentSuggestions = recentFiles.map((recenTFile) => ({ item: recenTFile, match: { matches: [], score: 0 } }));
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
    if (isChildOrSelf({ app: this.app, childPathOrFile: this.sourceFile, parentPathOrFile: file })) {
      return false;
    }
    if (isChildOrSelf({ app: this.app, childPathOrFile: file, parentPathOrFile: this.sourceFile })) {
      return false;
    }
    return !this.pluginSettingsComponent.settings.isPathIgnored(file.path);
  }
}

export async function selectFileForSwap(params: SelectFileForSwapParams): Promise<null | TFile> {
  return new Promise<null | TFile>((promiseResolve) => {
    const modal = new SwapFileModal({
      ...params,
      promiseResolve
    });
    openMinimizableModal(modal);
  });
}
