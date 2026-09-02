import type {
  App,
  FuzzyMatch,
  TAbstractFile,
  TFolder
} from 'obsidian';
import type { PromiseResolve } from 'obsidian-dev-utils/async';

import { FuzzySuggestModal } from 'obsidian';
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
import { CommandCategory } from '../plugin-settings.ts';
import { reorderSuggestionsByRecentFolders } from '../recent-suggestions.ts';
import { ConfirmDialogModal } from './confirm-dialog-modal.ts';

interface BuildMergeConfirmContentParams {
  readonly app: App;
  readonly fragment: DocumentFragment;
  readonly source: TAbstractFile;
  readonly target: TAbstractFile;
}

interface MergeFolderModalConstructorParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly promiseResolve: PromiseResolve<null | TFolder>;
  readonly sourceFolder: TFolder;
}

/* v8 ignore stop */

interface SelectTargetFolderForMergeFolderParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly sourceFolder: TFolder;
}

/* v8 ignore start -- MergeFolderModal is an internal UI class tested through exported functions. */
class MergeFolderModal extends FuzzySuggestModal<TFolder> {
  private isSelected = false;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly promiseResolve: PromiseResolve<null | TFolder>;

  private shouldIncludeChildFolders = false;
  private shouldIncludeParentFolders = false;
  private readonly sourceFolder: TFolder;

  public constructor(params: MergeFolderModalConstructorParams) {
    super(params.app);

    this.sourceFolder = params.sourceFolder;
    this.promiseResolve = params.promiseResolve;
    this.pluginSettingsComponent = params.pluginSettingsComponent;

    this.setPlaceholder('Select folder to merge into...');
    this.shouldIncludeChildFolders = params.pluginSettingsComponent.settings.shouldIncludeChildFoldersWhenMergingByDefault;
    this.shouldIncludeParentFolders = params.pluginSettingsComponent.settings.shouldIncludeParentFoldersWhenMergingByDefault;

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
    builder.build(this, { shouldShowInstructions: this.pluginSettingsComponent.settings.shouldShowModalInstructions });
  }

  public override getItems(): TFolder[] {
    return this.app.vault.getAllFolders(true).filter(this.isAllowedDestinationFolder.bind(this));
  }

  public override getItemText(item: TFolder): string {
    return item.path;
  }

  public override getSuggestions(query: string): FuzzyMatch<TFolder>[] {
    return reorderSuggestionsByRecentFolders({
      app: this.app,
      isAllowedFolder: (folder) => this.isAllowedDestinationFolder(folder),
      pickerRecencyOrder: this.pluginSettingsComponent.settings.pickerRecencyOrder,
      query,
      suggestions: super.getSuggestions(query)
    });
  }

  public override onChooseItem(item: TFolder): void {
    this.promiseResolve(item);
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

  private isAllowedDestinationFolder(folder: TFolder): boolean {
    if (folder === this.sourceFolder) {
      return false;
    }
    // Whether an excluded folder may be a destination is its OWN setting since issue #253, not a side
    // Effect of `Should always merge excluded items` — that one decides what a merge swallows, and a user
    // Who wanted excluded items merged rather than skipped was getting excluded destinations offered too.
    if (!this.pluginSettingsComponent.settings.shouldOfferExcludedPathsAsMergeDestinations && this.pluginSettingsComponent.settings.isPathIgnored(folder.path, CommandCategory.Merge)) {
      return false;
    }
    if (!this.shouldIncludeChildFolders && isChildOrSelf({ app: this.app, childPathOrFile: folder, parentPathOrFile: this.sourceFolder })) {
      return false;
    }
    if (!this.shouldIncludeParentFolders && isChildOrSelf({ app: this.app, childPathOrFile: this.sourceFolder, parentPathOrFile: folder })) {
      return false;
    }
    return true;
  }
}

export async function selectTargetFolderForMergeFolder(params: SelectTargetFolderForMergeFolderParams): Promise<null | TFolder> {
  // The confirmation dialog can send the flow back to the folder picker ("Change target"); loop until the
  // User confirms the merge or cancels.
  for (;;) {
    const targetFolder = await new Promise<null | TFolder>((promiseResolve) => {
      // The initial picker is opened plainly (no minimize button, issue #125): a target has not been
      // Chosen yet, so minimizing serves no purpose and risks the user forgetting which folder the merge
      // Was triggered on.
      openModal(
        new MergeFolderModal({
          ...params,
          promiseResolve
        })
      );
    });

    /* v8 ignore start -- requires MergeFolderModal / ConfirmDialogModal to resolve with a selection, which is untestable in unit tests. */
    if (!targetFolder) {
      return null;
    }
    if (!params.pluginSettingsComponent.settings.shouldAskBeforeMerging) {
      return targetFolder;
    }
    const confirmDialogResult = await new Promise<ConfirmDialogModalResult>((promiseResolve) => {
      openConfirmDialogModal(
        new ConfirmDialogModal({
          app: params.app,
          buildContent: (fragment): Promise<void> => buildMergeConfirmContent({ app: params.app, fragment, source: params.sourceFolder, target: targetFolder }),
          canReselectTarget: true,
          confirmButtonText: 'Merge',
          promiseResolve,
          title: 'Merge folder'
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
      settings.shouldAskBeforeMerging = confirmDialogResult.shouldAskAgain;
    });
    return targetFolder;
    /* v8 ignore stop */
  }
}

/* v8 ignore start -- builds the confirmation dialog DOM; exercised via desktop integration tests, not unit tests. */
async function buildMergeConfirmContent(params: BuildMergeConfirmContentParams): Promise<void> {
  const {
    app,
    fragment,
    source,
    target
  } = params;
  fragment.appendText('Are you sure you want to merge ');
  appendCodeBlock(fragment, 'Source');
  fragment.appendText(' into ');
  appendCodeBlock(fragment, 'Target');
  fragment.appendText('? ');
  appendCodeBlock(fragment, 'Source');
  fragment.appendText(' will be deleted.');
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
