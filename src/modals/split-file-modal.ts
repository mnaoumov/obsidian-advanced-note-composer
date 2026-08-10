import type { TFolder } from 'obsidian';
import type { PromiseResolve } from 'obsidian-dev-utils/async';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import {
  App,
  ButtonComponent,
  Editor,
  Keymap,
  TFile
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { getCacheSafe } from 'obsidian-dev-utils/obsidian/metadata-cache';
import { SuggestModalCommandBuilder } from 'obsidian-dev-utils/obsidian/modals/suggest-modal-command-builder';
import { trashSafe } from 'obsidian-dev-utils/obsidian/vault';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';

import type { Selection } from '../composers/composer-base.ts';
import type { SelectItemResult } from '../item-selectors/item-selector-base.ts';
import type { MoveNoticeComponent } from '../move-notice-component.ts';
import type { MoveSelectionBuffer } from '../move-selection-buffer.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { SelectionHighlightComponent } from '../selection-highlight-component.ts';
import type { ConfirmDialogModalResult } from './confirm-dialog-modal.ts';
import type {
  Item,
  SuggestModalBaseConstructorParams
} from './suggest-modal-base.ts';

import { getInsertModeFromEvent } from '../composers/composer-base.ts';
import { getSelections } from '../composers/split-composer.ts';
import { extractHeading } from '../headings.ts';
import { InsertMode } from '../insert-mode.ts';
import { SplitItemSelector } from '../item-selectors/split-item-selector.ts';
import { markSelectionToMove } from '../mark-selection-to-move.ts';
import { NameTransformError } from '../name-transform.ts';
import {
  openConfirmDialogModal,
  openMinimizableModal
} from '../open-minimizable-modal.ts';
import { FrontmatterMergeStrategy } from '../plugin-settings.ts';
import { ConfirmDialogModal } from './confirm-dialog-modal.ts';
import { SuggestModalBase } from './suggest-modal-base.ts';

interface BuildSplitConfirmContentParams {
  readonly app: App;
  readonly editor: Editor;
  readonly fragment: DocumentFragment;
  readonly sourceFile: TFile;
  readonly targetFile: TFile;
}

interface ConfirmSplitParams {
  readonly abortController: AbortController;
  readonly app: App;
  readonly canSwitchToSmartCut: boolean;
  readonly editor: Editor;
  readonly resourceLockComponent: ResourceLockComponent;
  readonly sourceFile: TFile;
  readonly targetFile: TFile;
}

interface PrepareForSplitFileParams {
  readonly app: App;
  readonly editor: Editor;
  readonly heading?: string;

  /**
   * The marked-selection notice component. Wired together with {@link PrepareForSplitFileParams.moveSelectionBuffer}
   * to enable the modal's "switch to smart cut & paste" action; omit to disable it.
   */
  readonly moveNoticeComponent?: MoveNoticeComponent;

  /**
   * The marked-selection buffer. Wired together with {@link PrepareForSplitFileParams.moveNoticeComponent}
   * to enable the modal's "switch to smart cut & paste" action; omit to disable it.
   */
  readonly moveSelectionBuffer?: MoveSelectionBuffer;

  /**
   * Where a refused `Name transform template` is reported (issue #203).
   *
   * These flows can run with no picker and no confirmation dialog (`shouldSkipModal`), so a misconfigured
   * transform has nowhere else to surface — before this it escaped into the generic unhandled-error notice,
   * which named neither the setting nor the problem.
   */
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;

  /**
   * The pending-selection highlight component. When provided, the captured selection is highlighted in the
   * source note while the split/extract setup is open (and it also enables the switch-to-smart-cut action).
   */
  readonly selectionHighlightComponent?: SelectionHighlightComponent;

  /**
   * Overrides where a new note is created, whatever the `shouldAllowOnlyCurrentFolderByDefault` setting says.
   * A **tri-state**, because it is resolved with `??`:
   *
   * - `true` — create the note in the source note's own folder.
   * - `false` — resolve through Obsidian's own new-file location (`fileManager.getNewFileParent`), i.e. its
   *   `Default location for new notes`. NOT "do not override" — an explicit `false` wins over the setting.
   * - `undefined` — use the `shouldAllowOnlyCurrentFolderByDefault` setting.
   *
   * Only meaningful together with {@link PrepareForSplitFileParams.shouldSkipModal} (otherwise the picker
   * owns the choice). Set by the recursive split: every pass but the first passes `true`, because its new
   * note must land beside its source for the folder tree to nest, while the first pass passes `false` when
   * `shouldSplitRecursivelyIntoDefaultNewNoteFolder` is on, which roots the whole produced tree in
   * Obsidian's default new-note folder (issue #173).
   */
  readonly shouldAllowOnlyCurrentFolderOverride?: boolean;

  /**
   * Puts the new note into its own folder even when the `shouldSplitIntoFolder` setting is off. Set by the
   * recursive split, whose folder tree IS the feature, so it cannot be at the mercy of that setting.
   */
  readonly shouldForceSplitIntoFolder?: boolean;

  /**
   * Skips the confirmation dialog for this split regardless of the `shouldAskBeforeSplitting` setting. Set by
   * flows that have already confirmed the whole operation once up front (the recursive split), where
   * confirming every one of the many splits it performs would be unusable.
   */
  readonly shouldSkipConfirmation?: boolean;
  readonly shouldSkipModal?: boolean;
  readonly sourceFile: TFile;

  /**
   * Creates the new note in THIS folder, overriding
   * {@link PrepareForSplitFileParams.shouldAllowOnlyCurrentFolderOverride} and the setting behind it. The
   * recursive split passes it for its ROOT pass after the user changed the target from the confirmation
   * dialog (issue #205) — a destination that is neither "beside the source" nor Obsidian's default new-note
   * location cannot be said any other way.
   */
  readonly targetParentFolderOverride?: null | TFolder;
}

interface PrepareForSplitFileResult {
  readonly capturedSelections: Selection[];
  readonly frontmatterMergeStrategy: FrontmatterMergeStrategy;
  readonly insertMode: InsertMode;
  readonly isNewTargetFile: boolean;
  readonly selectedText: string;
  readonly shouldAllowOnlyCurrentFolder: boolean;
  readonly shouldAllowSplitIntoUnresolvedPath: boolean;
  readonly shouldFixFootnotes: boolean;
  readonly shouldIncludeFrontmatter: boolean;
  readonly shouldMergeHeadings: boolean;
  readonly targetFile: TFile;
}

/* v8 ignore stop */

interface SelectSplitTargetParams {
  /**
   * The heading naming the new note, or an empty string when the split is not heading-driven.
   */
  readonly heading: string;

  /**
   * Whether this pass is still running without the picker, which is what decides whether the caller's
   * target-folder override still applies.
   */
  readonly isPickerStillSkipped: boolean;

  readonly params: PrepareForSplitFileParams;

  /**
   * What the picker resolved to (or the heading-driven stand-in for it).
   */
  readonly splitFileModalResult: SplitFileModalSplitResult;
}

interface ShouldSkipSplitConfirmationParams {
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly shouldSkipConfirmation: boolean;
  readonly shouldSkipModal: boolean;
}

interface SplitFileModalConstructorParams extends SuggestModalBaseConstructorParams {
  /**
   * Whether the modal offers the "switch to smart cut & paste" action (only when the caller wired the
   * marked-selection buffer and notice).
   */
  readonly canSwitchToSmartCut: boolean;
  readonly editor: Editor;
  readonly promiseResolve: PromiseResolve<null | SplitFileModalResult>;
}

type SplitFileModalResult = SplitFileModalSplitResult | SplitFileModalSwitchToSmartCutResult;

/**
 * The user chose a target and confirmed a normal split/extract.
 */
interface SplitFileModalSplitResult {
  readonly action: 'split';
  readonly frontmatterMergeStrategy: FrontmatterMergeStrategy;
  readonly inputValue: string;
  readonly insertMode: InsertMode;
  readonly isModifier: boolean;
  readonly item: Item | null;
  readonly shouldAllowOnlyCurrentFolder: boolean;
  readonly shouldAllowSplitIntoUnresolvedPath: boolean;
  readonly shouldFixFootnotes: boolean;
  readonly shouldIncludeFrontmatter: boolean;
  readonly shouldMergeHeadings: boolean;
  readonly shouldTreatTitleAsPath: boolean;
}

/**
 * The user chose to switch to "smart cut & paste" from the picker: mark the selection to move and
 * stay on the source note instead of splitting. No target is opened, because the picker has no
 * confirmed target yet — only a merely-highlighted suggestion the user never chose.
 */
interface SplitFileModalSwitchToSmartCutResult {
  readonly action: 'switch-to-smart-cut';
}

/* v8 ignore start -- SplitFileModal is an internal UI class tested through exported functions. */
class SplitFileModal extends SuggestModalBase {
  private readonly canSwitchToSmartCut: boolean;
  private readonly editor: Editor;
  private frontmatterMergeStrategy: FrontmatterMergeStrategy;
  private isSelected = false;
  private readonly promiseResolve: PromiseResolve<null | SplitFileModalResult>;
  private shouldAllowSplitIntoUnresolvedPath: boolean;
  private shouldFixFootnotes: boolean;
  private shouldIncludeFrontmatter: boolean;
  private shouldMergeHeadings: boolean;
  private shouldTreatTitleAsPath: boolean;
  private treatTitleAsPathCheckboxEl?: HTMLInputElement;
  private treatTitleAsPathCheckboxElValue?: boolean;

  public constructor(params: SplitFileModalConstructorParams) {
    super(params);

    this.canSwitchToSmartCut = params.canSwitchToSmartCut;
    this.editor = params.editor;
    this.promiseResolve = params.promiseResolve;

    this.shouldIncludeFrontmatter = this.pluginSettingsComponent.settings.shouldIncludeFrontmatterWhenSplittingByDefault;
    this.shouldTreatTitleAsPath = this.pluginSettingsComponent.settings.shouldTreatTitleAsPathByDefault;
    this.shouldFixFootnotes = this.pluginSettingsComponent.settings.shouldFixFootnotesByDefault;
    this.shouldMergeHeadings = this.pluginSettingsComponent.settings.shouldMergeHeadingsByDefault;
    this.shouldAllowSplitIntoUnresolvedPath = this.pluginSettingsComponent.settings.shouldAllowSplitIntoUnresolvedPathByDefault;
    this.frontmatterMergeStrategy = this.pluginSettingsComponent.settings.defaultFrontmatterMergeStrategy;

    this.allowCreateNewFile = true;
    // The split picker offers the current note so a selection can be extracted to its top/bottom
    // (Enter = bottom, Shift+Enter = top), reusing the same-note-move machinery. Issue #184 asked for it to
    // Go away, so it is a setting rather than a removal: it is the only route to a same-note top/bottom
    // Extraction, which "Switch to smart cut & paste" does NOT replace (that moves to an arbitrary cursor
    // Position instead).
    this.shouldAllowSameFile = this.pluginSettingsComponent.settings.shouldOfferCurrentNoteWhenSplitting;
    this.shouldShowUnresolved = this.pluginSettingsComponent.settings.shouldAllowSplitIntoUnresolvedPathByDefault;
    this.shouldShowNonImageAttachments = false;
    this.shouldShowImages = false;
    this.shouldShowNonAttachments = false;

    this.setPlaceholder('Select file to split into...');

    invokeAsyncSafely(() => this.buildInstructions());
  }

  public override onClose(): void {
    super.onClose();
    if (!this.isSelected) {
      this.promiseResolve(null);
    }
  }

  public override onOpen(): void {
    super.onOpen();
    this.renderSwitchToSmartCutButton();
  }

  public override selectSuggestion(value: Item | null, $event: KeyboardEvent | MouseEvent): void {
    this.isSelected = true;
    super.selectSuggestion(value, $event);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- Abstract base class requires Promise<void> return type.
  protected override async onChooseSuggestionAsync(item: Item | null, $event: KeyboardEvent | MouseEvent): Promise<void> {
    this.promiseResolve({
      action: 'split',
      frontmatterMergeStrategy: this.frontmatterMergeStrategy,
      inputValue: this.inputEl.value,
      insertMode: getInsertModeFromEvent($event),
      isModifier: Keymap.isModifier($event, 'Mod'),
      item,
      shouldAllowOnlyCurrentFolder: this.shouldAllowOnlyCurrentFolder,
      shouldAllowSplitIntoUnresolvedPath: this.shouldAllowSplitIntoUnresolvedPath,
      shouldFixFootnotes: this.shouldFixFootnotes,
      shouldIncludeFrontmatter: this.shouldIncludeFrontmatter,
      shouldMergeHeadings: this.shouldMergeHeadings,
      shouldTreatTitleAsPath: this.shouldTreatTitleAsPath
    });
  }

  private async buildInstructions(): Promise<void> {
    const canIncludeFrontmatter = await this.canIncludeFrontmatter();
    const builder = new SuggestModalCommandBuilder();

    builder.addKeyboardCommand({ key: 'UpDown', purpose: 'to navigate' });
    builder.addKeyboardCommand({ key: 'Enter', purpose: 'to move to bottom' });
    builder.addKeyboardCommand({
      key: 'Enter',
      modifiers: ['Mod'],
      onKey: ($event) => {
        this.selectActiveSuggestion($event);
        return false;
      },
      purpose: 'to create new'
    });
    builder.addKeyboardCommand({
      key: 'Enter',
      modifiers: ['Shift'],
      onKey: ($event) => {
        this.selectActiveSuggestion($event);
        return false;
      },
      purpose: 'to move to top'
    });
    builder.addKeyboardCommand({
      key: 'Escape',
      onKey: () => {
        this.close();
        return false;
      },
      purpose: 'to dismiss'
    });

    if (this.canSwitchToSmartCut) {
      builder.addKeyboardCommand({
        key: 's',
        modifiers: ['Alt'],
        onKey: () => {
          this.switchToSmartCut();
          return false;
        },
        purpose: 'to switch to smart cut & paste'
      });
    }

    builder.addCheckbox({
      key: '1',
      modifiers: ['Alt'],
      onChange: (isChecked: boolean) => {
        this.shouldIncludeFrontmatter = isChecked;
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = canIncludeFrontmatter && this.shouldIncludeFrontmatter;
      },
      purpose: 'Include frontmatter'
    });

    builder.addCheckbox({
      key: '2',
      modifiers: ['Alt'],
      onChange: (isChecked: boolean) => {
        this.shouldTreatTitleAsPath = isChecked;
        this.treatTitleAsPathCheckboxElValue = isChecked;
      },
      onInit: (checkboxEl) => {
        this.treatTitleAsPathCheckboxEl = checkboxEl;
        this.treatTitleAsPathCheckboxElValue = this.shouldTreatTitleAsPath;
        checkboxEl.checked = this.shouldTreatTitleAsPath;
      },
      purpose: 'Treat title as path'
    });

    builder.addCheckbox({
      key: '3',
      modifiers: ['Alt'],
      onChange: (isChecked: boolean) => {
        this.shouldFixFootnotes = isChecked;
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.shouldFixFootnotes;
      },
      purpose: 'Fix footnotes'
    });

    builder.addCheckbox({
      key: '4',
      modifiers: ['Alt'],
      onChange: (isChecked: boolean) => {
        this.shouldAllowOnlyCurrentFolder = isChecked;
        this.updateSuggestions();
        if (this.treatTitleAsPathCheckboxEl !== undefined && this.treatTitleAsPathCheckboxElValue !== undefined) {
          if (this.shouldAllowOnlyCurrentFolder) {
            this.treatTitleAsPathCheckboxEl.checked = false;
            this.treatTitleAsPathCheckboxEl.disabled = true;
            this.shouldTreatTitleAsPath = false;
          } else {
            this.treatTitleAsPathCheckboxEl.checked = this.treatTitleAsPathCheckboxElValue;
            this.treatTitleAsPathCheckboxEl.disabled = false;
            this.shouldTreatTitleAsPath = this.treatTitleAsPathCheckboxElValue;
          }
        }
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.shouldAllowOnlyCurrentFolder;
      },
      purpose: 'Allow only current folder'
    });

    builder.addCheckbox({
      key: '5',
      modifiers: ['Alt'],
      onChange: (isChecked: boolean) => {
        this.shouldMergeHeadings = isChecked;
        this.updateSuggestions();
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.shouldMergeHeadings;
      },
      purpose: 'Merge headings'
    });

    builder.addCheckbox({
      key: '6',
      modifiers: ['Alt'],
      onChange: (isChecked: boolean) => {
        this.shouldAllowSplitIntoUnresolvedPath = isChecked;
        this.shouldShowUnresolved = isChecked;
        this.updateSuggestions();
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.shouldAllowSplitIntoUnresolvedPath;
      },
      purpose: 'Allow split into unresolved path'
    });

    builder.addDropDown({
      key: '7',
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

  private async canIncludeFrontmatter(): Promise<boolean> {
    const sourceCache = await getCacheSafe(this.app, this.sourceFile);
    if (!sourceCache?.frontmatterPosition) {
      return false;
    }
    const selections = getSelections(this.editor);
    if (!selections[0]) {
      return false;
    }
    if (selections[0].startOffset < sourceCache.frontmatterPosition.end.offset) {
      return false;
    }
    return true;
  }

  /**
   * Adds a "Switch to smart cut & paste" button below the picker (mirroring the `Alt+S` shortcut). The
   * button is always shown but disabled when switching is unavailable.
   */
  private renderSwitchToSmartCutButton(): void {
    const buttonContainerEl = this.modalEl.createDiv('advanced-note-composer-switch-to-smart-cut');
    new ButtonComponent(buttonContainerEl)
      .setButtonText('Switch to smart cut & paste')
      .setTooltip('Mark the selection to move and switch to smart cut & paste (Alt+S)')
      .setDisabled(!this.canSwitchToSmartCut)
      .onClick(() => {
        this.switchToSmartCut();
      });
  }

  /**
   * Closes the modal and resolves with a "switch to smart cut & paste" result. The caller marks the
   * selection to move and stays on the source note; no target is opened, because the picker has no
   * confirmed target yet (opening the merely-highlighted suggestion would switch the note the user
   * never chose — see issue #141).
   */
  private switchToSmartCut(): void {
    this.isSelected = true;
    this.promiseResolve({
      action: 'switch-to-smart-cut'
    });
    this.close();
  }
}

export async function prepareForSplitFile(params: PrepareForSplitFileParams): Promise<null | PrepareForSplitFileResult> {
  // Capture the source selection and its text NOW, before the (minimizable) modal opens, while
  // `params.editor` still shows the source note. If the user navigates that leaf to another note
  // During the modal, the same editor object would then reflect THAT note — so the operation must
  // Use this snapshot, never re-read the live editor.
  const capturedSelections = getSelections(params.editor);
  const selectedText = params.editor.getSelection();

  // Lock the source note for the whole setup flow so it cannot be edited while the
  // (minimizable) split/confirmation modal is open — an external edit would corrupt the pending split.
  // The lock is cancelable: an unlock request aborts this controller, which closes the open modal
  // (so the setup flow cancels) and the `using` locks release on return.
  const abortController = new AbortController();
  using _sourceLock = params.resourceLockComponent.lockForPath({ abortController, operationName: 'Split note', pathOrFile: params.sourceFile });

  // Highlight the captured selection in the source note for the whole (minimizable) setup flow, so the
  // User can see exactly what is being extracted while they pick the target. Released on return.
  using _highlight = params.selectionHighlightComponent?.addHighlight(params.sourceFile, capturedSelections);

  let heading = params.heading;
  if (heading === '') {
    heading = undefined;
  }
  heading ??= extractHeading(params.editor);

  // The "switch to smart cut" action is offered only when the caller wired the marked-selection buffer,
  // Its notice component, and the highlight component (all needed by markSelectionToMove).
  const canSwitchToSmartCut = Boolean(params.moveNoticeComponent && params.moveSelectionBuffer && params.selectionHighlightComponent);

  /*
   * A heading-driven split derives its target from the heading and never shows the picker, but the picker
   * still EXISTS — so "Change target" reopens it rather than being disabled (issue #205). The flag is
   * per-pass, not per-call: only the FIRST pass is skipped, and choosing "Change target" clears it so the
   * next pass asks properly. Everything else about the loop is unchanged.
   */
  let shouldSkipModalThisPass = Boolean(params.shouldSkipModal);

  // The confirmation dialog can send the flow back to the target picker ("Change target"); loop until
  // The user confirms the split, cancels, or switches to smart cut. `pickerSeed` seeds the picker input:
  // The heading initially, then the previously-chosen target's query when the picker is reopened.
  let pickerSeed = heading;

  for (;;) {
    // Capture the picker seed in a per-iteration const so the modal-opening closure does not close over
    // The mutable `pickerSeed` (reassigned below on "Change target").
    const currentSeed = pickerSeed;

    const splitFileModalResult: null | SplitFileModalResult = shouldSkipModalThisPass
      ? {
        action: 'split',
        frontmatterMergeStrategy: params.pluginSettingsComponent.settings.defaultFrontmatterMergeStrategy,
        inputValue: heading,
        insertMode: InsertMode.Append,
        isModifier: false,
        item: null,
        shouldAllowOnlyCurrentFolder: params.shouldAllowOnlyCurrentFolderOverride ?? params.pluginSettingsComponent.settings.shouldAllowOnlyCurrentFolderByDefault,
        shouldAllowSplitIntoUnresolvedPath: params.pluginSettingsComponent.settings.shouldAllowSplitIntoUnresolvedPathByDefault,
        shouldFixFootnotes: params.pluginSettingsComponent.settings.shouldFixFootnotesByDefault,
        shouldIncludeFrontmatter: params.pluginSettingsComponent.settings.shouldIncludeFrontmatterWhenSplittingByDefault,
        shouldMergeHeadings: params.pluginSettingsComponent.settings.shouldMergeHeadingsByDefault,
        shouldTreatTitleAsPath: params.pluginSettingsComponent.settings.shouldTreatTitleAsPathByDefault
      }
      : await new Promise<null | SplitFileModalResult>((promiseResolve) => {
        const modal = new SplitFileModal({
          ...params,
          canSwitchToSmartCut,
          initialInputValue: currentSeed,
          promiseResolve
        });
        openMinimizableModal(modal, abortController);
      });

    if (!splitFileModalResult) {
      return null;
    }

    if (splitFileModalResult.action === 'switch-to-smart-cut') {
      // Behave as if `Mark selection to move` had been invoked on the source selection, and stay on the
      // Source note. The picker has no confirmed target — only a merely-highlighted suggestion the user
      // Never chose — so opening it would switch the active note unexpectedly (issue #141).
      // `canSwitchToSmartCut` guarantees both collaborators are present.
      markSelectionToMove({
        app: params.app,
        capturedSelections,
        moveNoticeComponent: ensureNonNullable(params.moveNoticeComponent),
        moveSelectionBuffer: ensureNonNullable(params.moveSelectionBuffer),
        resourceLockComponent: params.resourceLockComponent,
        selectedText,
        selectionHighlightComponent: ensureNonNullable(params.selectionHighlightComponent),
        shouldLockAllNotes: params.pluginSettingsComponent.settings.shouldLockAllNotesWhenMarkingSelection,
        sourceFile: params.sourceFile
      });
      return null;
    }

    const selectItemResult = await selectSplitTarget({
      heading,
      isPickerStillSkipped: shouldSkipModalThisPass,
      params,
      splitFileModalResult
    });
    if (!selectItemResult) {
      return null;
    }

    const prepareForSplitFileResult: PrepareForSplitFileResult = {
      capturedSelections,
      frontmatterMergeStrategy: splitFileModalResult.frontmatterMergeStrategy,
      insertMode: splitFileModalResult.insertMode,
      isNewTargetFile: selectItemResult.isNewTargetFile,
      selectedText,
      shouldAllowOnlyCurrentFolder: splitFileModalResult.shouldAllowOnlyCurrentFolder,
      shouldAllowSplitIntoUnresolvedPath: splitFileModalResult.shouldAllowSplitIntoUnresolvedPath,
      shouldFixFootnotes: splitFileModalResult.shouldFixFootnotes,
      shouldIncludeFrontmatter: splitFileModalResult.shouldIncludeFrontmatter,
      shouldMergeHeadings: splitFileModalResult.shouldMergeHeadings,
      targetFile: selectItemResult.targetFile
    };

    if (
      shouldSkipSplitConfirmation({
        pluginSettingsComponent: params.pluginSettingsComponent,
        shouldSkipConfirmation: Boolean(params.shouldSkipConfirmation),
        // The PER-PASS flag: once "Change target" has reopened the picker, this is an ordinary picked
        // Split, so `shouldSplitHeadingsAutomatically` must no longer suppress its confirmation.
        shouldSkipModal: shouldSkipModalThisPass
      })
    ) {
      return prepareForSplitFileResult;
    }

    const confirmDialogResult = await confirmSplit({
      abortController,
      app: params.app,
      canSwitchToSmartCut,
      editor: params.editor,
      resourceLockComponent: params.resourceLockComponent,
      sourceFile: params.sourceFile,
      targetFile: prepareForSplitFileResult.targetFile
    });

    /* v8 ignore start -- requires ConfirmDialogModal to resolve, which is untestable in unit tests. */
    if (confirmDialogResult.shouldReselectTarget) {
      // Go back to the target picker: discard the abandoned target (trash it when it was freshly
      // Created for this choice) and preselect the previous choice on reopen. `confirmSplit` already
      // Released the target lock, so reopening the picker re-locks only the next target.
      if (prepareForSplitFileResult.isNewTargetFile) {
        await trashSafe(params.app, prepareForSplitFileResult.targetFile);
      }
      pickerSeed = splitFileModalResult.inputValue;
      // A heading-driven split skipped the picker on the first pass; asking to change the target is asking
      // For that picker, so the next pass shows it seeded with the heading (issue #205).
      shouldSkipModalThisPass = false;
      continue;
    }
    if (confirmDialogResult.shouldSwitchToSmartCut) {
      // Switch to smart cut from the confirmation dialog: the target is already resolved, so mark the
      // Selection to move and open that target instead of splitting.
      markSelectionToMove({
        app: params.app,
        capturedSelections,
        moveNoticeComponent: ensureNonNullable(params.moveNoticeComponent),
        moveSelectionBuffer: ensureNonNullable(params.moveSelectionBuffer),
        resourceLockComponent: params.resourceLockComponent,
        selectedText,
        selectionHighlightComponent: ensureNonNullable(params.selectionHighlightComponent),
        shouldLockAllNotes: params.pluginSettingsComponent.settings.shouldLockAllNotesWhenMarkingSelection,
        sourceFile: params.sourceFile
      });
      await params.app.workspace.getLeaf(false).openFile(prepareForSplitFileResult.targetFile, { active: true });
      return null;
    }
    if (!confirmDialogResult.isConfirmed) {
      if (prepareForSplitFileResult.isNewTargetFile) {
        await trashSafe(params.app, prepareForSplitFileResult.targetFile);
      }
      return null;
    }
    await params.pluginSettingsComponent.editAndSave((settings) => {
      settings.shouldAskBeforeSplitting = confirmDialogResult.shouldAskAgain;
    });

    return prepareForSplitFileResult;
    /* v8 ignore stop */
  }
}

async function buildSplitConfirmContent(params: BuildSplitConfirmContentParams): Promise<void> {
  const {
    app,
    editor,
    fragment,
    sourceFile,
    targetFile
  } = params;
  fragment.appendText('Are you sure you want to split ');
  appendCodeBlock(fragment, 'Source');
  fragment.appendText(' into ');
  appendCodeBlock(fragment, 'Target');
  fragment.appendText('?');
  fragment.createEl('br');
  fragment.createEl('br');
  appendCodeBlock(fragment, 'Source');
  fragment.appendText(': ');
  fragment.append(await renderInternalLink({ app, pathOrAbstractFile: sourceFile }));
  fragment.createEl('br');
  fragment.createEl('br');
  appendCodeBlock(fragment, 'Target');
  fragment.appendText(': ');
  fragment.append(await renderInternalLink({ app, pathOrAbstractFile: targetFile }));
  fragment.createEl('br');
  fragment.createEl('br');
  fragment.createEl('h2', { text: 'Source content to split' });
  const selectedText = getSelections(editor).map((selection) => editor.cm.state.sliceDoc(selection.startOffset, selection.endOffset))
    .join('\n');
  const lines = selectedText.split('\n');
  for (const line of lines) {
    appendCodeBlock(fragment, line);
    fragment.createEl('br');
  }
}

async function confirmSplit(params: ConfirmSplitParams): Promise<ConfirmDialogModalResult> {
  // The target note is now known; lock it too while the (minimizable) confirmation dialog is open.
  // Released when this function returns, before the split operation re-locks both notes to do the work
  // (and before the picker is reopened when the user chooses "Change target").
  using _targetLock = params.resourceLockComponent.lockForPath({ abortController: params.abortController, operationName: 'Split note', pathOrFile: params.targetFile });

  const { app, editor, sourceFile, targetFile } = params;
  return await new Promise<ConfirmDialogModalResult>((promiseResolve) => {
    openConfirmDialogModal(
      new ConfirmDialogModal({
        app,
        buildContent: (fragment): Promise<void> => buildSplitConfirmContent({ app, editor, fragment, sourceFile, targetFile }),
        // Always available: every split has a picker, even the heading-driven flows that skipped it on the
        // First pass (issue #205).
        canReselectTarget: true,
        confirmButtonMobileText: 'Split and don\'t ask again',
        confirmButtonText: 'Split',
        promiseResolve,
        switchToSmartCut: { canSwitch: params.canSwitchToSmartCut },
        title: 'Split file'
      }),
      params.abortController
    );
  });
}

/**
 * The forced target folder to hand the item selector for THIS pass.
 *
 * The override only holds while the picker is still being skipped. Once "Change target" has opened it, the
 * folder the user picked there wins — an override that outlived the picker would silently ignore their
 * choice, which is the exact failure issue #205 is about.
 *
 * @param params - The prepare parameters.
 * @param isPickerStillSkipped - Whether this pass is still running without the picker.
 * @returns The folder to force the new note into, or `null` to leave the resolution alone.
 */
function resolveTargetParentFolderOverride(params: PrepareForSplitFileParams, isPickerStillSkipped: boolean): null | TFolder {
  if (!isPickerStillSkipped) {
    return null;
  }
  return params.targetParentFolderOverride ?? null;
}

/**
 * Resolves the note this split writes into, reporting a refused `Name transform template` rather than
 * letting it escape (issue #203).
 *
 * The refusal is reported HERE because these flows can run with no picker and no confirmation dialog, so
 * there is no prompt to report into and the user would otherwise see only the generic unhandled-error
 * notice. Nothing has been created at this point, so cancelling costs nothing.
 *
 * ONLY {@link NameTransformError} is caught: catching `Error` would turn every genuine bug in the selector
 * into a polite notice.
 *
 * It is a function of its own rather than a `try` in the loop above so `prepareForSplitFile` stays under the
 * complexity limit.
 *
 * @param params - The prepare parameters, the picker's result, and whether the picker is still skipped.
 * @returns The chosen target, or `null` when the transform refused the name.
 */
async function selectSplitTarget(params: SelectSplitTargetParams): Promise<null | SelectItemResult> {
  const {
    heading,
    isPickerStillSkipped,
    splitFileModalResult
  } = params;
  const prepareParams = params.params;

  try {
    return await new SplitItemSelector({
      app: prepareParams.app,
      inputValue: splitFileModalResult.inputValue,
      isModifier: splitFileModalResult.isModifier,
      item: splitFileModalResult.item,
      pluginSettingsComponent: prepareParams.pluginSettingsComponent,
      shouldAllowOnlyCurrentFolder: splitFileModalResult.shouldAllowOnlyCurrentFolder,
      shouldForceSplitIntoFolder: prepareParams.shouldForceSplitIntoFolder ?? false,
      /* v8 ignore start -- short-circuit branch depends on heading being falsy. */
      shouldTreatTitleAsPath: !heading && splitFileModalResult.shouldTreatTitleAsPath,
      /* v8 ignore stop */
      sourceFile: prepareParams.sourceFile,
      targetParentFolderOverride: resolveTargetParentFolderOverride(prepareParams, isPickerStillSkipped)
    }).selectItem();
  } catch (error) {
    if (!(error instanceof NameTransformError)) {
      throw error;
    }
    prepareParams.pluginNoticeComponent.showNotice(error.message);
    return null;
  }
}

/**
 * Decides whether this split runs without the confirmation dialog.
 *
 * A heading-driven split (`shouldSkipModal`) derives its target from the heading, so with
 * `shouldSplitHeadingsAutomatically` on it must run start-to-finish without prompting (issue #79) — without
 * touching the confirmation of ordinary, manually-targeted splits. A caller that already confirmed the whole
 * operation once up front (the recursive split) suppresses it outright.
 *
 * @param params - The parameters.
 * @returns Whether to skip the confirmation dialog.
 */
function shouldSkipSplitConfirmation(params: ShouldSkipSplitConfirmationParams): boolean {
  const settings = params.pluginSettingsComponent.settings;
  return !settings.shouldAskBeforeSplitting
    || params.shouldSkipConfirmation
    || (params.shouldSkipModal && settings.shouldSplitHeadingsAutomatically);
}
