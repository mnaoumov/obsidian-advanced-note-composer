import type { PromiseResolve } from 'obsidian-dev-utils/async';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import {
  App,
  Keymap,
  TAbstractFile,
  TFile
} from 'obsidian';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { SuggestModalCommandBuilder } from 'obsidian-dev-utils/obsidian/modals/suggest-modal-command-builder';
import { trashSafe } from 'obsidian-dev-utils/obsidian/vault';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { ConfirmDialogModalResult } from './confirm-dialog-modal.ts';
import type {
  Item,
  SuggestModalBaseConstructorParams
} from './suggest-modal-base.ts';

import { getInsertModeFromEvent } from '../composers/composer-base.ts';
import { InsertMode } from '../insert-mode.ts';
import { MergeItemSelector } from '../item-selectors/merge-item-selector.ts';
import { openMinimizableModal } from '../open-minimizable-modal.ts';
import { FrontmatterMergeStrategy } from '../plugin-settings.ts';
import { ConfirmDialogModal } from './confirm-dialog-modal.ts';
import { SuggestModalBase } from './suggest-modal-base.ts';

interface BuildMergeConfirmContentParams {
  readonly app: App;
  readonly fragment: DocumentFragment;
  readonly source: TAbstractFile;
  readonly target: TAbstractFile;
}

interface ConfirmMergeParams {
  readonly abortController: AbortController;
  readonly app: App;
  readonly resourceLockComponent: ResourceLockComponent;
  readonly sourceFile: TFile;
  readonly targetFile: TFile;
}

interface MergeFileModalConstructorParams extends SuggestModalBaseConstructorParams {
  readonly promiseResolve: PromiseResolve<MergeFileModalResult | null>;
}

interface MergeFileModalResult {
  readonly frontmatterMergeStrategy: FrontmatterMergeStrategy;
  readonly inputValue: string;
  readonly insertMode: InsertMode;
  readonly isMod: boolean;
  readonly item: Item | null;
  readonly shouldAllowOnlyCurrentFolder: boolean;
  readonly shouldAllowSplitIntoUnresolvedPath: boolean;
  readonly shouldFixFootnotes: boolean;
  readonly shouldMergeHeadings: boolean;
}

interface PrepareForMergeFileParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
  readonly sourceFile: TFile;
}

/* v8 ignore stop */

interface PrepareForMergeFileResult {
  readonly frontmatterMergeStrategy: FrontmatterMergeStrategy;
  readonly insertMode: InsertMode;
  readonly isNewTargetFile: boolean;
  readonly shouldAllowOnlyCurrentFolder: boolean;
  readonly shouldAllowSplitIntoUnresolvedPath: boolean;
  readonly shouldFixFootnotes: boolean;
  readonly shouldMergeHeadings: boolean;
  readonly targetFile: TFile;
}

/* v8 ignore start -- MergeFileModal is an internal UI class tested through exported functions. */
class MergeFileModal extends SuggestModalBase {
  private frontmatterMergeStrategy: FrontmatterMergeStrategy;

  private isSelected = false;
  private readonly promiseResolve: PromiseResolve<MergeFileModalResult | null>;
  private shouldAllowSplitIntoUnresolvedPath: boolean;
  private shouldFixFootnotes: boolean;
  private shouldMergeHeadings: boolean;

  public constructor(params: MergeFileModalConstructorParams) {
    super(params);

    this.promiseResolve = params.promiseResolve;

    this.shouldFixFootnotes = this.pluginSettingsComponent.settings.shouldFixFootnotesByDefault;
    this.shouldMergeHeadings = this.pluginSettingsComponent.settings.shouldMergeHeadingsByDefault;
    this.shouldAllowSplitIntoUnresolvedPath = this.pluginSettingsComponent.settings.shouldAllowSplitIntoUnresolvedPathByDefault;
    this.frontmatterMergeStrategy = this.pluginSettingsComponent.settings.defaultFrontmatterMergeStrategy;

    this.emptyStateText = 'No files found.';
    this.shouldShowNonImageAttachments = false;
    this.shouldShowImages = false;
    this.shouldShowNonAttachments = false;
    this.setPlaceholder('Select file to merge into...');

    const builder = new SuggestModalCommandBuilder();

    builder.addKeyboardCommand({
      key: 'UpDown',
      purpose: 'to navigate'
    });

    builder.addKeyboardCommand({
      key: 'Enter',
      purpose: 'to move to bottom'
    });

    builder.addKeyboardCommand({
      key: 'Enter',
      modifiers: ['Mod'],
      onKey: (evt) => {
        this.selectActiveSuggestion(evt);
        return false;
      },
      purpose: 'to create new'
    });

    builder.addKeyboardCommand({
      key: 'Enter',
      modifiers: ['Shift'],
      onKey: (evt) => {
        this.selectActiveSuggestion(evt);
        return false;
      },
      purpose: 'to merge at top'
    });

    builder.addKeyboardCommand({
      key: 'Escape',
      onKey: () => {
        this.close();
        return false;
      },
      purpose: 'to dismiss'
    });

    builder.addCheckbox({
      key: '1',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.shouldFixFootnotes = value;
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.shouldFixFootnotes;
      },
      purpose: 'Fix footnotes'
    });

    builder.addCheckbox({
      key: '2',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.shouldAllowOnlyCurrentFolder = value;
        this.updateSuggestions();
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.shouldAllowOnlyCurrentFolder;
      },
      purpose: 'Allow only current folder'
    });

    builder.addCheckbox({
      key: '3',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.shouldMergeHeadings = value;
        this.updateSuggestions();
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.shouldMergeHeadings;
      },
      purpose: 'Merge headings'
    });

    builder.addCheckbox({
      key: '4',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.shouldAllowSplitIntoUnresolvedPath = value;
        this.shouldShowUnresolved = value;
        this.updateSuggestions();
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.shouldAllowSplitIntoUnresolvedPath;
      },
      purpose: 'Allow split into unresolved path'
    });

    builder.addDropDown({
      key: '5',
      modifiers: ['Alt'],
      onChange: (value: string) => {
        this.frontmatterMergeStrategy = value as FrontmatterMergeStrategy;
      },
      onInit: (dropdownComponent) => {
        dropdownComponent.addOptions({
          /* eslint-disable perfectionist/sort-objects -- Need to keep order. */
          [FrontmatterMergeStrategy.MergeAndPreferNewValues]: 'Merge and prefer new values',
          [FrontmatterMergeStrategy.MergeAndPreferOriginalValues]: 'Merge and prefer original values',
          [FrontmatterMergeStrategy.KeepOriginalFrontmatter]: 'Keep original frontmatter',
          [FrontmatterMergeStrategy.ReplaceWithNewFrontmatter]: 'Replace with new frontmatter',
          [FrontmatterMergeStrategy.PreserveBothOriginalAndNewFrontmatter]: 'Preserve both original and new frontmatter'
          /* eslint-enable perfectionist/sort-objects -- Need to keep order. */
        });
        dropdownComponent.setValue(this.frontmatterMergeStrategy);
      },
      purpose: 'Frontmatter merge strategy'
    });

    builder.build(this, { shouldShowInstructions: this.pluginSettingsComponent.settings.shouldShowModalInstructions });
  }

  public override onClose(): void {
    super.onClose();
    if (!this.isSelected) {
      this.promiseResolve(null);
    }
  }

  public override selectSuggestion(value: Item | null, evt: KeyboardEvent | MouseEvent): void {
    this.isSelected = true;
    super.selectSuggestion(value, evt);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- Abstract base class requires Promise<void> return type.
  protected override async onChooseSuggestionAsync(item: Item | null, evt: KeyboardEvent | MouseEvent): Promise<void> {
    this.promiseResolve({
      frontmatterMergeStrategy: this.frontmatterMergeStrategy,
      inputValue: this.inputEl.value,
      insertMode: getInsertModeFromEvent(evt),
      isMod: Keymap.isModifier(evt, 'Mod'),
      item,
      shouldAllowOnlyCurrentFolder: this.shouldAllowOnlyCurrentFolder,
      shouldAllowSplitIntoUnresolvedPath: this.shouldAllowSplitIntoUnresolvedPath,
      shouldFixFootnotes: this.shouldFixFootnotes,
      shouldMergeHeadings: this.shouldMergeHeadings
    });
  }
}

/* v8 ignore stop */

export async function prepareForMergeFile(params: PrepareForMergeFileParams): Promise<null | PrepareForMergeFileResult> {
  // Lock the source note for the whole setup flow so it cannot be edited while the
  // (minimizable) merge/confirmation modal is open — an external edit would corrupt the pending merge.
  // The lock is cancelable: an unlock request aborts this controller, which closes the open modal
  // (so the setup flow cancels) and the `using` locks release on return.
  const abortController = new AbortController();
  using _sourceLock = params.resourceLockComponent.lockForPath({ abortController, operationName: 'Merge notes', pathOrFile: params.sourceFile });

  // The confirmation dialog can send the flow back to the target picker ("Change target"); loop until
  // The user confirms the merge or cancels. `pickerSeed` seeds the picker input with the previously-chosen
  // Target's query when the picker is reopened.
  let pickerSeed = '';

  for (;;) {
    // Capture the picker seed in a per-iteration const so the modal-opening closure does not close over
    // The mutable `pickerSeed` (reassigned below on "Change target").
    const currentSeed = pickerSeed;

    const result = await new Promise<MergeFileModalResult | null>((promiseResolve) => {
      const modal = new MergeFileModal({
        ...params,
        initialInputValue: currentSeed,
        promiseResolve
      });
      openMinimizableModal(modal, abortController);
    });

    if (!result) {
      return null;
    }

    const selectItemResult = await new MergeItemSelector({
      app: params.app,
      inputValue: result.inputValue,
      isMod: result.isMod,
      item: result.item,
      pluginSettingsComponent: params.pluginSettingsComponent,
      sourceFile: params.sourceFile
    }).selectItem();

    const prepareForMergeFileResult: PrepareForMergeFileResult = {
      frontmatterMergeStrategy: result.frontmatterMergeStrategy,
      insertMode: result.insertMode,
      isNewTargetFile: selectItemResult.isNewTargetFile,
      shouldAllowOnlyCurrentFolder: result.shouldAllowOnlyCurrentFolder,
      shouldAllowSplitIntoUnresolvedPath: result.shouldAllowSplitIntoUnresolvedPath,
      shouldFixFootnotes: result.shouldFixFootnotes,
      shouldMergeHeadings: result.shouldMergeHeadings,
      targetFile: selectItemResult.targetFile
    };

    if (!params.pluginSettingsComponent.settings.shouldAskBeforeMerging) {
      return prepareForMergeFileResult;
    }

    const confirmDialogResult = await confirmMerge({
      abortController,
      app: params.app,
      resourceLockComponent: params.resourceLockComponent,
      sourceFile: params.sourceFile,
      targetFile: prepareForMergeFileResult.targetFile
    });

    /* v8 ignore start -- requires ConfirmDialogModal to resolve, which is untestable in unit tests. */
    if (confirmDialogResult.shouldReselectTarget) {
      // Go back to the target picker: discard the abandoned target (trash it when it was freshly created
      // For this choice) and preselect the previous choice on reopen. `confirmMerge` already released the
      // Target lock, so reopening the picker re-locks only the next target.
      if (prepareForMergeFileResult.isNewTargetFile) {
        await trashSafe(params.app, prepareForMergeFileResult.targetFile);
      }
      pickerSeed = result.inputValue;
      continue;
    }
    if (!confirmDialogResult.isConfirmed) {
      if (prepareForMergeFileResult.isNewTargetFile) {
        await trashSafe(params.app, prepareForMergeFileResult.targetFile);
      }
      return null;
    }
    await params.pluginSettingsComponent.editAndSave((settings) => {
      settings.shouldAskBeforeMerging = confirmDialogResult.shouldAskAgain;
    });

    return {
      ...prepareForMergeFileResult,
      insertMode: confirmDialogResult.insertMode
    };
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
  fragment.appendChild(await renderInternalLink({ app, pathOrAbstractFile: source }));
  fragment.createEl('br');
  fragment.createEl('br');
  appendCodeBlock(fragment, 'Target');
  fragment.appendText(': ');
  fragment.appendChild(await renderInternalLink({ app, pathOrAbstractFile: target }));
}

async function confirmMerge(params: ConfirmMergeParams): Promise<ConfirmDialogModalResult> {
  // The target note is now known; lock it too while the (minimizable) confirmation dialog is open.
  // Released when this function returns, before the merge runs (and before the picker is reopened when the
  // User chooses "Change target").
  using _targetLock = params.resourceLockComponent.lockForPath({ abortController: params.abortController, operationName: 'Merge notes', pathOrFile: params.targetFile });

  const {
    app,
    sourceFile,
    targetFile
  } = params;
  return await new Promise<ConfirmDialogModalResult>((promiseResolve) => {
    openMinimizableModal(
      new ConfirmDialogModal({
        app,
        buildContent: (fragment): Promise<void> => buildMergeConfirmContent({ app, fragment, source: sourceFile, target: targetFile }),
        canReselectTarget: true,
        confirmButtonMobileText: 'Merge and don\'t ask again',
        confirmButtonText: 'Merge',
        promiseResolve,
        title: 'Merge file'
      }),
      params.abortController
    );
  });
}

/* v8 ignore stop */
