import type { PromiseResolve } from 'obsidian-dev-utils/async';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import {
  App,
  ButtonComponent,
  Editor,
  Keymap,
  Modal,
  Platform,
  TFile
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { getCacheSafe } from 'obsidian-dev-utils/obsidian/metadata-cache';
import { SuggestModalCommandBuilder } from 'obsidian-dev-utils/obsidian/modals/suggest-modal-command-builder';
import { trashSafe } from 'obsidian-dev-utils/obsidian/vault';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';

import type { Selection } from '../composers/composer-base.ts';
import type { MoveNoticeComponent } from '../move-notice-component.ts';
import type { MoveSelectionBuffer } from '../move-selection-buffer.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { SelectionHighlightComponent } from '../selection-highlight-component.ts';
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
import { openMinimizableModal } from '../open-minimizable-modal.ts';
import { FrontmatterMergeStrategy } from '../plugin-settings.ts';
import { SuggestModalBase } from './suggest-modal-base.ts';

interface ConfirmDialogModalConstructorParams {
  readonly app: App;

  /**
   * Whether the dialog offers the "Change target" action to send the flow back to the target picker
   * (only when there is a picker to reopen — i.e. not a heading-driven split).
   */
  readonly canReselectTarget: boolean;
  readonly canSwitchToSmartCut: boolean;
  readonly editor: Editor;
  readonly promiseResolve: PromiseResolve<ConfirmDialogModalResult>;
  readonly sourceFile: TFile;
  readonly targetFile: TFile;
}

interface ConfirmDialogModalResult {
  readonly insertMode: InsertMode;
  readonly isConfirmed: boolean;
  readonly shouldAskBeforeSplitting: boolean;
  readonly shouldReselectTarget: boolean;
  readonly shouldSwitchToSmartCut: boolean;
}

interface ConfirmSplitParams {
  readonly abortController: AbortController;
  readonly app: App;
  readonly canReselectTarget: boolean;
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
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;

  /**
   * The pending-selection highlight component. When provided, the captured selection is highlighted in the
   * source note while the split/extract setup is open (and it also enables the switch-to-smart-cut action).
   */
  readonly selectionHighlightComponent?: SelectionHighlightComponent;
  readonly shouldSkipModal?: boolean;
  readonly sourceFile: TFile;
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

interface SplitFileModalConstructorParams extends SuggestModalBaseConstructorParams {
  /**
   * Whether the modal offers the "switch to smart cut & paste" action (only when the caller wired the
   * marked-selection buffer and notice).
   */
  readonly canSwitchToSmartCut: boolean;
  readonly editor: Editor;
  readonly heading: string;

  /**
   * The value to seed the picker input with, overriding {@link SplitFileModalConstructorParams.heading}.
   * Used to preselect the previously-chosen target when the picker is reopened via "Change target".
   */
  readonly initialInputValue?: string;
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
  readonly isMod: boolean;
  readonly item: Item | null;
  readonly shouldAllowOnlyCurrentFolder: boolean;
  readonly shouldAllowSplitIntoUnresolvedPath: boolean;
  readonly shouldFixFootnotes: boolean;
  readonly shouldIncludeFrontmatter: boolean;
  readonly shouldMergeHeadings: boolean;
  readonly shouldTreatTitleAsPath: boolean;
}

/**
 * The user chose to switch to "smart cut & paste": mark the selection to move and open the highlighted
 * target note (when it is an existing file) instead of splitting.
 */
interface SplitFileModalSwitchToSmartCutResult {
  readonly action: 'switch-to-smart-cut';
  readonly targetFile: null | TFile;
}

/* v8 ignore start -- ConfirmDialogModal is an internal UI class tested through exported functions. */
class ConfirmDialogModal extends Modal {
  private readonly canReselectTarget: boolean;
  private readonly canSwitchToSmartCut: boolean;
  private readonly editor: Editor;
  private isSelected = false;
  private readonly promiseResolve: PromiseResolve<ConfirmDialogModalResult>;
  private shouldAskBeforeSplitting = true;
  private readonly sourceFile: TFile;
  private readonly targetFile: TFile;

  public constructor(params: ConfirmDialogModalConstructorParams) {
    super(params.app);

    this.canReselectTarget = params.canReselectTarget;
    this.canSwitchToSmartCut = params.canSwitchToSmartCut;
    this.editor = params.editor;
    this.promiseResolve = params.promiseResolve;
    this.sourceFile = params.sourceFile;
    this.targetFile = params.targetFile;

    this.scope.register([], 'Enter', (evt) => {
      this.confirm(evt);
    });

    this.scope.register([], 'Escape', () => {
      this.close();
    });

    this.scope.register(['Alt'], 's', () => {
      if (!this.canSwitchToSmartCut) {
        return;
      }
      this.switchToSmartCut();
      return false;
    });

    this.scope.register(['Alt'], 'c', () => {
      if (!this.canReselectTarget) {
        return;
      }
      this.reselectTarget();
      return false;
    });
  }

  public override onClose(): void {
    super.onClose();
    if (!this.isSelected) {
      this.promiseResolve({
        insertMode: InsertMode.Append,
        isConfirmed: false,
        shouldAskBeforeSplitting: false,
        shouldReselectTarget: false,
        shouldSwitchToSmartCut: false
      });
    }
  }

  public override onOpen(): void {
    super.onOpen();
    invokeAsyncSafely(this.onOpenAsync.bind(this));
  }

  private confirm(evt: KeyboardEvent | MouseEvent): void {
    this.isSelected = true;
    this.promiseResolve({
      insertMode: getInsertModeFromEvent(evt),
      isConfirmed: true,
      shouldAskBeforeSplitting: this.shouldAskBeforeSplitting,
      shouldReselectTarget: false,
      shouldSwitchToSmartCut: false
    });
    this.close();
  }

  private async onOpenAsync(): Promise<void> {
    this.setTitle('Split file');

    this.containerEl.addClass('mod-confirmation');
    const buttonContainerEl = this.modalEl.createDiv('modal-button-container');

    this.setContent(
      await createFragmentAsync(async (f) => {
        f.appendText('Are you sure you want to split ');
        appendCodeBlock(f, 'Source');
        f.appendText(' into ');
        appendCodeBlock(f, 'Target');
        f.appendText('?');
        f.createEl('br');
        f.createEl('br');
        appendCodeBlock(f, 'Source');
        f.appendText(': ');
        f.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: this.sourceFile }));
        f.createEl('br');
        f.createEl('br');
        appendCodeBlock(f, 'Target');
        f.appendText(': ');
        f.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: this.targetFile }));
        f.createEl('br');
        f.createEl('br');
        f.createEl('h2', { text: 'Source content to split' });
        const selectedText = getSelections(this.editor).map((selection) => this.editor.cm.state.sliceDoc(selection.startOffset, selection.endOffset))
          .join('\n');
        const lines = selectedText.split('\n');
        for (const line of lines) {
          appendCodeBlock(f, line);
          f.createEl('br');
        }
      })
    );

    if (Platform.isMobile) {
      buttonContainerEl.createEl('button', {
        cls: 'mod-warning',
        text: 'Split and don\'t ask again'
      }, (button) => {
        button.addEventListener('click', (evt) => {
          this.shouldAskBeforeSplitting = false;
          this.confirm(evt);
        });
      });
    } else {
      buttonContainerEl.createEl('label', { cls: 'mod-checkbox' }, (label) => {
        label
          .createEl('input', {
            attr: { tabindex: -1 },
            type: 'checkbox'
          }, (checkbox) => {
            checkbox.addEventListener('change', (evt) => {
              if (!(evt.target instanceof HTMLInputElement)) {
                return;
              }
              this.shouldAskBeforeSplitting = !evt.target.checked;
            });
          });
        label.appendText('Don\'t ask again');
      });
    }

    new ButtonComponent(buttonContainerEl)
      .setButtonText('Change target')
      .setTooltip('Go back to the target picker to choose a different note (Alt+C)')
      .setDisabled(!this.canReselectTarget)
      .onClick(() => {
        this.reselectTarget();
      });

    new ButtonComponent(buttonContainerEl)
      .setButtonText('Switch to smart cut & paste')
      .setTooltip('Mark the selection to move and open the target note instead of splitting')
      .setDisabled(!this.canSwitchToSmartCut)
      .onClick(() => {
        this.switchToSmartCut();
      });

    buttonContainerEl.createEl('button', {
      cls: 'mod-warning',
      text: 'Split'
    }, (button) => {
      button.addEventListener('click', (evt) => {
        this.confirm(evt);
      });
    });

    buttonContainerEl.createEl('button', {
      cls: 'mod-cancel',
      text: 'Cancel'
    }, (button) => {
      button.addEventListener('click', () => {
        this.close();
      });
    });
  }

  private reselectTarget(): void {
    this.isSelected = true;
    this.promiseResolve({
      insertMode: InsertMode.Append,
      isConfirmed: false,
      shouldAskBeforeSplitting: false,
      shouldReselectTarget: true,
      shouldSwitchToSmartCut: false
    });
    this.close();
  }

  private switchToSmartCut(): void {
    this.isSelected = true;
    this.promiseResolve({
      insertMode: InsertMode.Append,
      isConfirmed: false,
      shouldAskBeforeSplitting: false,
      shouldReselectTarget: false,
      shouldSwitchToSmartCut: true
    });
    this.close();
  }
}

/* v8 ignore stop */

/* v8 ignore start -- SplitFileModal is an internal UI class tested through exported functions. */
class SplitFileModal extends SuggestModalBase {
  private readonly canSwitchToSmartCut: boolean;
  private readonly editor: Editor;
  private frontmatterMergeStrategy: FrontmatterMergeStrategy;
  private readonly initialInputValue: string;
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
    // Seed the picker with the reselect value when reopened via "Change target", else the heading.
    this.initialInputValue = params.initialInputValue ?? params.heading;
    this.promiseResolve = params.promiseResolve;

    this.shouldIncludeFrontmatter = this.pluginSettingsComponent.settings.shouldIncludeFrontmatterWhenSplittingByDefault;
    this.shouldTreatTitleAsPath = this.pluginSettingsComponent.settings.shouldTreatTitleAsPathByDefault;
    this.shouldFixFootnotes = this.pluginSettingsComponent.settings.shouldFixFootnotesByDefault;
    this.shouldMergeHeadings = this.pluginSettingsComponent.settings.shouldMergeHeadingsByDefault;
    this.shouldAllowSplitIntoUnresolvedPath = this.pluginSettingsComponent.settings.shouldAllowSplitIntoUnresolvedPathByDefault;
    this.frontmatterMergeStrategy = this.pluginSettingsComponent.settings.defaultFrontmatterMergeStrategy;

    this.allowCreateNewFile = true;
    // The split picker offers the current note so a selection can be extracted to its top/bottom
    // (Enter = bottom, Shift+Enter = top), reusing the same-note-move machinery.
    this.shouldAllowSameFile = true;
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
    this.inputEl.value = this.initialInputValue;
    this.updateSuggestions();
    this.renderSwitchToSmartCutButton();
  }

  public override selectSuggestion(value: Item | null, evt: KeyboardEvent | MouseEvent): void {
    this.isSelected = true;
    super.selectSuggestion(value, evt);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- Abstract base class requires Promise<void> return type.
  protected override async onChooseSuggestionAsync(item: Item | null, evt: KeyboardEvent | MouseEvent): Promise<void> {
    this.promiseResolve({
      action: 'split',
      frontmatterMergeStrategy: this.frontmatterMergeStrategy,
      inputValue: this.inputEl.value,
      insertMode: getInsertModeFromEvent(evt),
      isMod: Keymap.isModifier(evt, 'Mod'),
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
      onChange: (value: boolean) => {
        this.shouldIncludeFrontmatter = value;
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = canIncludeFrontmatter && this.shouldIncludeFrontmatter;
      },
      purpose: 'Include frontmatter'
    });

    builder.addCheckbox({
      key: '2',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.shouldTreatTitleAsPath = value;
        this.treatTitleAsPathCheckboxElValue = value;
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
      onChange: (value: boolean) => {
        this.shouldFixFootnotes = value;
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.shouldFixFootnotes;
      },
      purpose: 'Fix footnotes'
    });

    builder.addCheckbox({
      key: '4',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.shouldAllowOnlyCurrentFolder = value;
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
      key: '6',
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
      .setTooltip('Mark the selection to move and open the highlighted note (Alt+S)')
      .setDisabled(!this.canSwitchToSmartCut)
      .onClick(() => {
        this.switchToSmartCut();
      });
  }

  /**
   * Closes the modal and resolves with a "switch to smart cut & paste" result carrying the highlighted
   * target note (when it is an existing file). The caller marks the selection to move and opens that
   * note.
   */
  private switchToSmartCut(): void {
    const selectedItem = this.chooser.values?.[this.chooser.selectedItem] ?? null;
    this.isSelected = true;
    this.promiseResolve({
      action: 'switch-to-smart-cut',
      targetFile: selectedItem?.file ?? null
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

  // The target can be re-selected from the confirmation dialog only when there is a picker to reopen
  // (a heading-driven split derives its target automatically, so there is nothing to reopen).
  const canReselectTarget = !params.shouldSkipModal;

  // The confirmation dialog can send the flow back to the target picker ("Change target"); loop until
  // The user confirms the split, cancels, or switches to smart cut. `pickerSeed` seeds the picker input:
  // The heading initially, then the previously-chosen target's query when the picker is reopened.
  let pickerSeed = heading;

  for (;;) {
    // Capture the picker seed in a per-iteration const so the modal-opening closure does not close over
    // The mutable `pickerSeed` (reassigned below on "Change target").
    const currentSeed = pickerSeed;

    const splitFileModalResult: null | SplitFileModalResult = params.shouldSkipModal
      ? {
        action: 'split',
        frontmatterMergeStrategy: params.pluginSettingsComponent.settings.defaultFrontmatterMergeStrategy,
        inputValue: heading,
        insertMode: InsertMode.Append,
        isMod: false,
        item: null,
        shouldAllowOnlyCurrentFolder: params.pluginSettingsComponent.settings.shouldAllowOnlyCurrentFolderByDefault,
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
          heading,
          initialInputValue: currentSeed,
          promiseResolve
        });
        openMinimizableModal(modal, abortController);
      });

    if (!splitFileModalResult) {
      return null;
    }

    if (splitFileModalResult.action === 'switch-to-smart-cut') {
      // Behave as if `Mark selection to move` had been invoked on the source selection, then open the
      // Highlighted target note so the user can position the caret and paste. `canSwitchToSmartCut`
      // Guarantees both collaborators are present.
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
      if (splitFileModalResult.targetFile) {
        await params.app.workspace.getLeaf(false).openFile(splitFileModalResult.targetFile, { active: true });
      }
      return null;
    }

    const selectItemResult = await new SplitItemSelector({
      app: params.app,
      inputValue: splitFileModalResult.inputValue,
      isMod: splitFileModalResult.isMod,
      item: splitFileModalResult.item,
      pluginSettingsComponent: params.pluginSettingsComponent,
      shouldAllowOnlyCurrentFolder: splitFileModalResult.shouldAllowOnlyCurrentFolder,
      /* v8 ignore start -- short-circuit branch depends on heading being falsy. */
      shouldTreatTitleAsPath: !heading && splitFileModalResult.shouldTreatTitleAsPath,
      /* v8 ignore stop */
      sourceFile: params.sourceFile
    }).selectItem();

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

    if (!params.pluginSettingsComponent.settings.shouldAskBeforeSplitting) {
      return prepareForSplitFileResult;
    }

    const confirmDialogResult = await confirmSplit({
      abortController,
      app: params.app,
      canReselectTarget,
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
      settings.shouldAskBeforeSplitting = confirmDialogResult.shouldAskBeforeSplitting;
    });

    return prepareForSplitFileResult;
    /* v8 ignore stop */
  }
}

async function confirmSplit(params: ConfirmSplitParams): Promise<ConfirmDialogModalResult> {
  // The target note is now known; lock it too while the (minimizable) confirmation dialog is open.
  // Released when this function returns, before the split operation re-locks both notes to do the work
  // (and before the picker is reopened when the user chooses "Change target").
  using _targetLock = params.resourceLockComponent.lockForPath({ abortController: params.abortController, operationName: 'Split note', pathOrFile: params.targetFile });

  return await new Promise<ConfirmDialogModalResult>((promiseResolve) => {
    openMinimizableModal(
      new ConfirmDialogModal({
        app: params.app,
        canReselectTarget: params.canReselectTarget,
        canSwitchToSmartCut: params.canSwitchToSmartCut,
        editor: params.editor,
        promiseResolve,
        sourceFile: params.sourceFile,
        targetFile: params.targetFile
      }),
      params.abortController
    );
  });
}
