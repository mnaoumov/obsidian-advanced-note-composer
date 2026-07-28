import type {
  App,
  FuzzyMatch,
  TAbstractFile
} from 'obsidian';
import type { PromiseResolve } from 'obsidian-dev-utils/async';

import {
  FuzzySuggestModal,
  TFile
} from 'obsidian';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { isChildOrSelf } from 'obsidian-dev-utils/obsidian/vault';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { ConfirmDialogModalResult } from './confirm-dialog-modal.ts';

import {
  openMinimizableModal,
  openModal
} from '../open-minimizable-modal.ts';
import { reorderSuggestionsByRecentFiles } from '../recent-suggestions.ts';
import { ConfirmDialogModal } from './confirm-dialog-modal.ts';

interface BuildSwapConfirmContentParams {
  readonly app: App;
  readonly fragment: DocumentFragment;
  readonly source: TAbstractFile;
  readonly target: TAbstractFile;
}

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
    return reorderSuggestionsByRecentFiles({
      app: this.app,
      isAllowedFile: (file) => this.isAllowedTargetFile(file),
      query,
      suggestions: super.getSuggestions(query)
    });
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

/* v8 ignore stop */

export async function selectFileForSwap(params: SelectFileForSwapParams): Promise<null | TFile> {
  // The confirmation dialog can send the flow back to the file picker ("Change target"); loop until the
  // User confirms the swap or cancels.
  for (;;) {
    const targetFile = await new Promise<null | TFile>((promiseResolve) => {
      // The initial picker is opened plainly (no minimize button, issue #125): a target has not been
      // Chosen yet, so minimizing serves no purpose and risks the user forgetting which note the swap was
      // Triggered on.
      const modal = new SwapFileModal({
        ...params,
        promiseResolve
      });
      openModal(modal);
    });

    /* v8 ignore start -- requires SwapFileModal / ConfirmDialogModal to resolve with a selection, which is untestable in unit tests. */
    if (!targetFile) {
      return null;
    }
    if (!params.pluginSettingsComponent.settings.shouldAskBeforeSwapping) {
      return targetFile;
    }
    const confirmDialogResult = await new Promise<ConfirmDialogModalResult>((promiseResolve) => {
      openMinimizableModal(
        new ConfirmDialogModal({
          app: params.app,
          buildContent: (fragment): Promise<void> => buildSwapConfirmContent({ app: params.app, fragment, source: params.sourceFile, target: targetFile }),
          canReselectTarget: true,
          confirmButtonMobileText: 'Swap and don\'t ask again',
          confirmButtonText: 'Swap',
          promiseResolve,
          title: 'Swap files'
        })
      );
    });
    if (confirmDialogResult.shouldReselectTarget) {
      // Go back to the file picker to choose a different target.
      continue;
    }
    if (!confirmDialogResult.isConfirmed) {
      return null;
    }
    await params.pluginSettingsComponent.editAndSave((settings) => {
      settings.shouldAskBeforeSwapping = confirmDialogResult.shouldAskAgain;
    });
    return targetFile;
    /* v8 ignore stop */
  }
}

/* v8 ignore start -- builds the confirmation dialog DOM; exercised via desktop integration tests, not unit tests. */
async function buildSwapConfirmContent(params: BuildSwapConfirmContentParams): Promise<void> {
  const {
    app,
    fragment,
    source,
    target
  } = params;
  fragment.appendText('Are you sure you want to swap ');
  appendCodeBlock(fragment, 'Source');
  fragment.appendText(' with ');
  appendCodeBlock(fragment, 'Target');
  fragment.appendText('?');
  fragment.createEl('br');
  fragment.createEl('br');
  appendCodeBlock(fragment, 'Source');
  fragment.appendText(': ');
  fragment.appendChild(await renderInternalLink({ app, pathOrAbstractFile: source }));
  fragment.createEl('br');
  fragment.createEl('br');
  appendCodeBlock(fragment, 'Target');
  fragment.appendText(': ');
  fragment.appendChild(await renderInternalLink({ app, pathOrAbstractFile: target }));
}

/* v8 ignore stop */
