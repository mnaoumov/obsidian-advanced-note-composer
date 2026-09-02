import type {
  App,
  FuzzyMatch,
  TAbstractFile
} from 'obsidian';
import type { PromiseResolve } from 'obsidian-dev-utils/async';

import {
  FuzzySuggestModal,
  TFolder
} from 'obsidian';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { ModalCommandBuilder } from 'obsidian-dev-utils/obsidian/modals/modal-command-builder';
import { isChildOrSelf } from 'obsidian-dev-utils/obsidian/vault';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { ConfirmDialogModalResult } from './confirm-dialog-modal.ts';

import {
  openConfirmDialogModal,
  openModal
} from '../open-minimizable-modal.ts';
import { reorderSuggestionsByRecentFolders } from '../recent-suggestions.ts';
import { ConfirmDialogModal } from './confirm-dialog-modal.ts';

interface BuildSwapConfirmContentParams {
  readonly app: App;
  readonly fragment: DocumentFragment;
  readonly source: TAbstractFile;
  readonly target: TAbstractFile;
}

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

    const builder = new ModalCommandBuilder();
    builder.addCheckbox({
      key: '1',
      modifiers: ['Alt'],
      onChange: (isChecked: boolean) => {
        this.shouldIncludeChildFolders = isChecked;
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
      onChange: (isChecked: boolean) => {
        this.shouldIncludeParentFolders = isChecked;
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
      onChange: (isChecked: boolean) => {
        this.shouldSwapEntireFolderStructure = isChecked;
        this.updateSuggestions();
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.shouldSwapEntireFolderStructure;
      },
      purpose: 'Should swap entire folder structure'
    });
    builder.build(this, { shouldShowInstructions: this.pluginSettingsComponent.settings.shouldShowModalInstructions });
  }

  public override getItems(): TFolder[] {
    return this.app.vault.getAllFolders().filter((folder) => this.isAllowedTargetFolder(folder));
  }

  public override getItemText(item: TFolder): string {
    return item.path;
  }

  public override getSuggestions(query: string): FuzzyMatch<TFolder>[] {
    return reorderSuggestionsByRecentFolders({
      app: this.app,
      isAllowedFolder: (folder) => this.isAllowedTargetFolder(folder),
      pickerRecencyOrder: this.pluginSettingsComponent.settings.pickerRecencyOrder,
      query,
      suggestions: super.getSuggestions(query)
    });
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

  public override selectSuggestion(value: FuzzyMatch<TFolder>, $event: KeyboardEvent | MouseEvent): void {
    this.isSelected = true;
    super.selectSuggestion(value, $event);
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

/* v8 ignore stop */

export async function selectTargetFolderForSwap(params: SelectTargetFolderForSwapParams): Promise<null | SwapFolderModalResult> {
  // The confirmation dialog can send the flow back to the folder picker ("Change target"); loop until the
  // User confirms the swap or cancels.
  for (;;) {
    const result = await new Promise<null | SwapFolderModalResult>((promiseResolve) => {
      // The initial picker is opened plainly (no minimize button, issue #125): a target has not been
      // Chosen yet, so minimizing serves no purpose and risks the user forgetting which folder the swap was
      // Triggered on.
      const modal = new SwapFolderModal({
        ...params,
        promiseResolve
      });
      openModal(modal);
    });

    /* v8 ignore start -- requires SwapFolderModal / ConfirmDialogModal to resolve with a selection, which is untestable in unit tests. */
    if (!result) {
      return null;
    }
    if (!params.pluginSettingsComponent.settings.shouldAskBeforeSwapping) {
      return result;
    }
    const confirmDialogResult = await new Promise<ConfirmDialogModalResult>((promiseResolve) => {
      openConfirmDialogModal(
        new ConfirmDialogModal({
          app: params.app,
          buildContent: (fragment): Promise<void> => buildSwapConfirmContent({ app: params.app, fragment, source: params.sourceFolder, target: result.targetFolder }),
          canReselectTarget: true,
          confirmButtonText: 'Swap',
          promiseResolve,
          title: 'Swap folders'
        })
      );
    });
    if (confirmDialogResult.shouldReselectTarget) {
      // Go back to the folder picker to choose a different target.
      continue;
    }
    if (!confirmDialogResult.isConfirmed) {
      return null;
    }
    await params.pluginSettingsComponent.editAndSave((settings) => {
      settings.shouldAskBeforeSwapping = confirmDialogResult.shouldAskAgain;
    });
    return result;
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
  fragment.append(await renderInternalLink({ app, pathOrAbstractFile: source }));
  fragment.createEl('br');
  fragment.createEl('br');
  appendCodeBlock(fragment, 'Target');
  fragment.appendText(': ');
  fragment.append(await renderInternalLink({ app, pathOrAbstractFile: target }));
}

/* v8 ignore stop */
