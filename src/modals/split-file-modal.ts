import type {
  TFolder,
  ToggleComponent
} from 'obsidian';
import type { PromiseResolve } from 'obsidian-dev-utils/async';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import {
  App,
  ButtonComponent,
  Editor,
  Setting,
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
import {
  FrontmatterMergeStrategy,
  SplitTargetMode
} from '../plugin-settings.ts';
import { ConfirmDialogModal } from './confirm-dialog-modal.ts';
import { resolveExistingItemFile } from './existing-item-file.ts';
import { selectFolder } from './select-folder-modal.ts';
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

  /**
   * Whether the picker may target an EXISTING note at all (issue #244). Defaults to `true`.
   *
   * `Create empty note at cursor...` passes `false`: it extracts nothing, and merging nothing into an
   * existing note is an operation with no content and no effect. It forces {@link SplitTargetMode.Create}
   * over the `defaultSplitTargetMode` setting, disables the picker's switch and drops its `Alt+M`.
   */
  readonly canMergeIntoExistingNote?: boolean;

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

interface RememberSplitTargetModeParams {
  /**
   * See {@link PrepareForSplitFileParams.canMergeIntoExistingNote}, already defaulted by the caller.
   */
  readonly canMergeIntoExistingNote: boolean;

  /**
   * Whether this pass ran without the picker, in which case the mode below was synthesized rather than
   * chosen.
   */
  readonly isPickerSkipped: boolean;

  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly splitTargetMode: SplitTargetMode;
}

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

  /**
   * The folder the user chose in the folder prompt, or `null` when they were not asked (issue #238).
   */
  readonly targetParentFolder: null | TFolder;
}

interface SelectTargetParentFolderParams {
  readonly abortController: AbortController;

  /**
   * Whether this pass is still running without the picker. A heading-driven split derives everything from
   * the heading and shows no prompt at all, so it must not grow one.
   */
  readonly isPickerStillSkipped: boolean;

  readonly params: PrepareForSplitFileParams;
  readonly splitFileModalResult: SplitFileModalSplitResult;
}

/**
 * The outcome of the folder prompt. A `null` RESULT means the prompt was dismissed, which is different from
 * a result carrying a `null` folder — that one means the user was never asked.
 */
interface SelectTargetParentFolderResult {
  readonly folder: null | TFolder;
}

interface SetSplitTargetModeParams {
  /**
   * Whether the text currently in the box MOVES into the mode being switched to instead of being replaced by
   * what that mode last held. Only `Mod+Enter` sets it: forcing a creation says the text just typed IS the
   * new note's name, so restoring `Create`'s remembered value would create a note named after something the
   * user typed in another mode entirely.
   */
  readonly shouldCarryOverInputValue: boolean;
  readonly splitTargetMode: SplitTargetMode;
}

interface ShouldSkipSplitConfirmationParams {
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly shouldSkipConfirmation: boolean;
  readonly shouldSkipModal: boolean;
}

interface SplitFileModalConstructorParams extends SuggestModalBaseConstructorParams {
  /**
   * See {@link PrepareForSplitFileParams.canMergeIntoExistingNote}. Optional so it can arrive by simply
   * being spread through from the prepare parameters; omitted means merging is available.
   */
  readonly canMergeIntoExistingNote?: boolean;

  /**
   * Whether the modal offers the "switch to smart cut & paste" action (only when the caller wired the
   * marked-selection buffer and notice).
   */
  readonly canSwitchToSmartCut: boolean;
  readonly editor: Editor;

  /**
   * Whether {@link SuggestModalBaseConstructorParams.initialInputValue} NAMES a note to create — the heading
   * a heading-driven split is about to make a note out of — rather than a target that was already chosen
   * (issue #237). A name to create has no business seeding a `Merge` search, which picks an EXISTING note; a
   * previously-chosen target (the confirmation dialog's `Change target`) is exactly what a merge search
   * wants, so it seeds both modes.
   */
  readonly isInitialInputValueNewNoteName: boolean;
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
  readonly item: Item | null;
  readonly shouldAllowOnlyCurrentFolder: boolean;
  readonly shouldAllowSplitIntoUnresolvedPath: boolean;
  readonly shouldFixFootnotes: boolean;
  readonly shouldIncludeFrontmatter: boolean;
  readonly shouldMergeHeadings: boolean;
  readonly shouldTreatTitleAsPath: boolean;

  /**
   * Whether the user asked to CREATE the target note or to MERGE into an existing one (issue #227). It
   * replaced the `Mod`-held flag this result used to carry: `Mod+Enter` now flips the switch to
   * {@link SplitTargetMode.Create} and chooses, so the switch can never disagree with what happens.
   */
  readonly splitTargetMode: SplitTargetMode;
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
  private readonly canMergeIntoExistingNote: boolean;
  private readonly canSwitchToSmartCut: boolean;
  private readonly editor: Editor;
  private frontmatterMergeStrategy: FrontmatterMergeStrategy;

  /**
   * What the box held the last time each mode was on screen (issue #237). The two modes ask for different
   * things — a name to create versus a search for an existing note — so one of them remembering the other's
   * text is text the user has to erase before they can get on with it.
   */
  private readonly inputValueBySplitTargetMode: Record<SplitTargetMode, string>;
  private isSelected = false;
  private nameRequiredHintEl?: HTMLElement;
  private readonly promiseResolve: PromiseResolve<null | SplitFileModalResult>;
  private shouldAllowSplitIntoUnresolvedPath: boolean;
  private shouldFixFootnotes: boolean;
  private shouldIncludeFrontmatter: boolean;
  private shouldMergeHeadings: boolean;
  private shouldTreatTitleAsPath: boolean;
  private splitTargetMode: SplitTargetMode;
  private splitTargetModeSetting?: Setting;
  private splitTargetModeToggle?: ToggleComponent;
  private treatTitleAsPathCheckboxEl?: HTMLInputElement;
  private treatTitleAsPathCheckboxElValue?: boolean;
  private unresolvedPathCheckboxEl?: HTMLInputElement;

  public constructor(params: SplitFileModalConstructorParams) {
    super(params);

    this.canMergeIntoExistingNote = params.canMergeIntoExistingNote ?? true;
    this.canSwitchToSmartCut = params.canSwitchToSmartCut;
    this.editor = params.editor;
    this.promiseResolve = params.promiseResolve;

    this.shouldIncludeFrontmatter = this.pluginSettingsComponent.settings.shouldIncludeFrontmatterWhenSplittingByDefault;
    this.shouldTreatTitleAsPath = this.pluginSettingsComponent.settings.shouldTreatTitleAsPathByDefault;
    this.shouldFixFootnotes = this.pluginSettingsComponent.settings.shouldFixFootnotesByDefault;
    this.shouldMergeHeadings = this.pluginSettingsComponent.settings.shouldMergeHeadingsByDefault;
    this.shouldAllowSplitIntoUnresolvedPath = this.pluginSettingsComponent.settings.shouldAllowSplitIntoUnresolvedPathByDefault;
    this.frontmatterMergeStrategy = this.pluginSettingsComponent.settings.defaultFrontmatterMergeStrategy;
    // A flow with nothing to merge opens in `Create` whatever the setting says (issue #244) — the setting
    // Chooses between two modes, and here only one of them exists.
    this.splitTargetMode = this.canMergeIntoExistingNote ? this.pluginSettingsComponent.settings.defaultSplitTargetMode : SplitTargetMode.Create;

    const initialInputValue = params.initialInputValue ?? '';
    this.inputValueBySplitTargetMode = {
      [SplitTargetMode.Create]: initialInputValue,
      [SplitTargetMode.Merge]: params.isInitialInputValueNewNoteName ? '' : initialInputValue
    };

    this.shouldShowNonImageAttachments = false;
    this.shouldShowImages = false;
    this.shouldShowNonAttachments = false;

    this.applySplitTargetMode();

    this.setPlaceholder('Select file to split into...');

    invokeAsyncSafely(() => this.buildInstructions());
  }

  public override onClose(): void {
    super.onClose();
    if (!this.isSelected) {
      this.promiseResolve(null);
    }
  }

  public override onInput(): void {
    super.onInput();
    this.refreshNameRequiredHint();
  }

  public override onOpen(): void {
    super.onOpen();
    // The base seeded the box with the caller's value; the mode the picker OPENS in decides whether that
    // Value belongs there at all (issue #237) — a `Merge` default must not open holding a heading name.
    this.inputEl.value = this.inputValueBySplitTargetMode[this.splitTargetMode];
    this.updateSuggestions();
    if (this.pluginSettingsComponent.settings.shouldShowModalInstructions) {
      this.renderSplitTargetModeSwitch();
    }
    this.renderNameRequiredHint();
    this.renderSwitchToSmartCutButton();
  }

  /**
   * Refuses to choose anything while a creation has no name (issue #238).
   *
   * This is the ONE choke point every way of choosing goes through — `Enter`, a click on a row, and
   * `Mod+Enter` (which flips the switch to `Create` and then calls this) — so the rule cannot be reached
   * around. Without it an empty box was accepted and quietly became `Untitled` in whatever folder Obsidian's
   * new-file resolution picked, which is the reporter's "I chose a folder and it defaulted".
   *
   * `Merge` is deliberately not gated: it chooses a note that already exists, and its empty box is a search
   * that simply has not narrowed anything down yet.
   *
   * @param value - The chosen suggestion, or `null` for a creation from what was typed.
   * @param $event - The event that chose it.
   */
  public override selectSuggestion(value: Item | null, $event: KeyboardEvent | MouseEvent): void {
    if (this.isNameMissing()) {
      /*
       * Issue #257 carved out the one case where the refusal read as a broken picker: a row that names an
       * EXISTING note, clicked while nothing is typed. There is no ambiguity about what that means — the
       * note is right there — so instead of ignoring the click the picker flips the switch to `Merge` and
       * goes through with it. Every other row still refuses: the choice really would be a nameless
       * creation.
       *
       * The case is not exotic. The switch is rendered only while `Should show modal instructions` is on,
       * so the reporter could not see the mode, let alone change it, and every click did nothing at all.
       *
       * A MOUSE event only. `Enter` goes through here too, with whatever row happens to be highlighted —
       * and acting on a merely-highlighted suggestion is the mistake issue #141 exists about. A click
       * names the row it lands on; `Enter` on an empty box still means "create", and is still refused.
       */
      if ($event instanceof MouseEvent && this.canMergeIntoExistingNote && resolveExistingItemFile(this.app, value)) {
        this.setSplitTargetMode({ shouldCarryOverInputValue: false, splitTargetMode: SplitTargetMode.Merge });
        this.isSelected = true;
        super.selectSuggestion(value, $event);
        return;
      }
      // The hint is already on screen (it tracks the same condition); refreshing keeps them in step if the
      // Box was changed without an `input` event.
      this.refreshNameRequiredHint();
      return;
    }
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
      item,
      shouldAllowOnlyCurrentFolder: this.shouldAllowOnlyCurrentFolder,
      shouldAllowSplitIntoUnresolvedPath: this.shouldAllowSplitIntoUnresolvedPath,
      shouldFixFootnotes: this.shouldFixFootnotes,
      shouldIncludeFrontmatter: this.shouldIncludeFrontmatter,
      shouldMergeHeadings: this.shouldMergeHeadings,
      shouldTreatTitleAsPath: this.shouldTreatTitleAsPath,
      splitTargetMode: this.splitTargetMode
    });
  }

  /**
   * Applies everything the {@link SplitTargetMode} decides about the suggestion list.
   *
   * `Merge` offers only notes that already exist: no `Enter to create` row, and no unresolved links (an
   * unresolved link is a note that does not exist yet, so choosing one would CREATE). `Create` never offers
   * the source note, because extracting into it is a merge into an existing note by another name.
   */
  private applySplitTargetMode(): void {
    const isCreate = this.splitTargetMode === SplitTargetMode.Create;
    this.allowCreateNewFile = isCreate;
    // The split picker offers the current note so a selection can be extracted to its top/bottom
    // (Enter = bottom, Shift+Enter = top), reusing the same-note-move machinery. Issue #184 asked for it to
    // Go away, so it is a setting rather than a removal: it is the only route to a same-note top/bottom
    // Extraction, which "Switch to smart cut & paste" does NOT replace (that moves to an arbitrary cursor
    // Position instead).
    this.shouldAllowSameFile = !isCreate && this.pluginSettingsComponent.settings.shouldOfferCurrentNoteWhenSplitting;
    this.shouldShowUnresolved = isCreate && this.shouldAllowSplitIntoUnresolvedPath;
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
        // The switch must never disagree with what is about to happen, so forcing a creation MOVES it
        // Rather than overriding it behind the user's back (issue #227). What was typed is the name to
        // Create, so it moves with the switch instead of being swapped for `Create`'s remembered text.
        this.setSplitTargetMode({ shouldCarryOverInputValue: true, splitTargetMode: SplitTargetMode.Create });
        // Deliberately NOT `selectActiveSuggestion`: forcing a creation is about what was TYPED, and in
        // `Merge` mode there is no creatable suggestion to select — the list offers only existing notes.
        this.selectSuggestion(null, $event);
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

    // Registered only alongside the switch it mirrors (issue #242). Unlike an instruction-bar checkbox, whose
    // Shortcut `SuggestModalCommandBuilder.build` skips with the bar, a keyboard command's scope registration
    // Always runs — so leaving this in would keep an invisible way to override `defaultSplitTargetMode` after
    // The visible one is gone. The same reasoning is why a flow that cannot merge at all drops it (issue
    // #244): an invisible shortcut into a mode the flow forbids is worse than no shortcut.
    if (this.canMergeIntoExistingNote && this.pluginSettingsComponent.settings.shouldShowModalInstructions) {
      builder.addKeyboardCommand({
        key: 'm',
        modifiers: ['Alt'],
        onKey: () => {
          this.setSplitTargetMode({
            shouldCarryOverInputValue: false,
            splitTargetMode: this.splitTargetMode === SplitTargetMode.Create ? SplitTargetMode.Merge : SplitTargetMode.Create
          });
          return false;
        },
        purpose: 'to switch between create and merge'
      });
    }

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
        this.refreshOptionCheckboxStates();
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
        this.refreshOptionCheckboxStates();
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
        this.applySplitTargetMode();
        this.updateSuggestions();
      },
      onInit: (checkboxEl) => {
        this.unresolvedPathCheckboxEl = checkboxEl;
        checkboxEl.checked = this.shouldAllowSplitIntoUnresolvedPath;
        this.refreshOptionCheckboxStates();
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
   * Whether the picker is being asked to create a note that has not been named (issue #238).
   *
   * The trimmed value is what counts: a box holding only spaces names nothing, and `fixFileName` would have
   * turned it into `Untitled` just as an empty one does.
   *
   * @returns Whether a name is still missing.
   */
  private isNameMissing(): boolean {
    return this.splitTargetMode === SplitTargetMode.Create && !this.inputEl.value.trim();
  }

  /**
   * Shows the hint exactly while the refusal is live, so the rule is visible BEFORE the user tries to
   * choose rather than as a complaint afterwards.
   *
   * `show()` / `hide()` rather than `toggleVisibility`: that one sets `visibility`, which leaves the hint's
   * blank line holding a gap under the box in the far more common case where there IS a name.
   */
  private refreshNameRequiredHint(): void {
    if (this.isNameMissing()) {
      this.nameRequiredHintEl?.show();
      return;
    }
    this.nameRequiredHintEl?.hide();
  }

  /**
   * The ONE place that decides whether an option checkbox is available, so its two reasons to be disabled
   * cannot disagree.
   *
   * `Treat title as path` is off-limits while `Allow only current folder` pins the destination, and both it
   * and `Allow split into unresolved path` are off-limits in `Merge` mode, where nothing is created and
   * neither has anything to act on. The remembered value is restored when the checkbox becomes available
   * again, so disabling it never silently discards the user's choice.
   */
  private refreshOptionCheckboxStates(): void {
    const isCreate = this.splitTargetMode === SplitTargetMode.Create;

    if (this.treatTitleAsPathCheckboxEl !== undefined && this.treatTitleAsPathCheckboxElValue !== undefined) {
      const isTreatTitleAsPathAvailable = isCreate && !this.shouldAllowOnlyCurrentFolder;
      this.shouldTreatTitleAsPath = isTreatTitleAsPathAvailable && this.treatTitleAsPathCheckboxElValue;
      this.treatTitleAsPathCheckboxEl.checked = this.shouldTreatTitleAsPath;
      this.treatTitleAsPathCheckboxEl.disabled = !isTreatTitleAsPathAvailable;
    }

    if (this.unresolvedPathCheckboxEl !== undefined) {
      this.unresolvedPathCheckboxEl.checked = isCreate && this.shouldAllowSplitIntoUnresolvedPath;
      this.unresolvedPathCheckboxEl.disabled = !isCreate;
    }
  }

  /**
   * Names the switch after what it is about to DO rather than after the toggle it is — a row reading
   * `Create a new note` states the outcome, where a static `Merge` label would leave the off position
   * unlabelled and put the reader back to inferring it.
   */
  private refreshSplitTargetModeSwitch(): void {
    this.splitTargetModeSetting?.setName(this.splitTargetMode === SplitTargetMode.Create ? 'Create a new note' : 'Merge into an existing note');
  }

  /**
   * Adds the "name it first" hint directly under the box (issue #238).
   *
   * It sits under the input rather than with the keyboard instructions at the bottom because it is about
   * the box: the reporter's whole complaint is that nothing said a name was needed before a destination
   * could be chosen.
   */
  private renderNameRequiredHint(): void {
    const hintEl = createDiv({
      cls: 'advanced-note-composer-name-required-hint',
      text: 'Type a name for the new note. Until it has one, there is nothing to create and nowhere to put it.'
    });
    const inputContainerEl = this.inputEl.parentElement;
    if (inputContainerEl) {
      inputContainerEl.after(hintEl);
    } else {
      this.modalEl.prepend(hintEl);
    }
    this.nameRequiredHintEl = hintEl;
    this.refreshNameRequiredHint();
  }

  /**
   * Adds the `Create` / `Merge` switch above the picker's input (issue #227), so what the picker is about
   * to do is stated rather than inferred from what was typed.
   *
   * It is prepended to `modalEl` because the input is the first thing in it, and the reporter's own
   * mock-up puts the switch above the input.
   */
  private renderSplitTargetModeSwitch(): void {
    const switchContainerEl = createDiv('advanced-note-composer-split-target-mode');
    this.modalEl.prepend(switchContainerEl);
    this.splitTargetModeSetting = new Setting(switchContainerEl)
      // Shown DISABLED rather than hidden when merging is unavailable (issue #244): a row that says why the
      // Only option is a creation answers the question a missing row would raise.
      .setDesc(
        this.canMergeIntoExistingNote
          ? 'Off: create a new note named as typed. On: merge into the existing note picked below. (Alt+M)'
          : 'There is nothing to merge, so this flow can only create a new note named as typed.'
      )
      .addToggle((toggle) => {
        this.splitTargetModeToggle = toggle;
        toggle
          .setValue(this.splitTargetMode === SplitTargetMode.Merge)
          .setDisabled(!this.canMergeIntoExistingNote)
          .onChange((value) => {
            this.setSplitTargetMode({
              shouldCarryOverInputValue: false,
              splitTargetMode: value ? SplitTargetMode.Merge : SplitTargetMode.Create
            });
          });
      });
    this.refreshSplitTargetModeSwitch();
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
   * The ONE way the mode changes, whichever surface asked for it — the switch, `Alt+M`, or `Mod+Enter`
   * forcing a creation. It re-derives the suggestion list, the option checkboxes, the box and the switch
   * itself together, so no two of them can report a different mode.
   *
   * The box is remembered PER MODE (issue #237): the outgoing mode keeps what was typed in it, and the
   * incoming mode gets back what IT last held. So a heading name — which seeds `Create` to name a new note —
   * is gone the moment `Merge` is on screen, and back the moment `Create` is, without ever overwriting a
   * name the user typed themselves.
   *
   * @param params - The mode to switch to, and whether the typed text moves with it.
   */
  private setSplitTargetMode(params: SetSplitTargetModeParams): void {
    const { shouldCarryOverInputValue, splitTargetMode } = params;
    if (this.splitTargetMode === splitTargetMode) {
      return;
    }

    // The ONE place the mode changes is also the one place the refusal has to live (issue #244), so a flow
    // With nothing to merge cannot be talked into `Merge` by any surface — including a disabled toggle that
    // Some future Obsidian version lets through.
    if (!this.canMergeIntoExistingNote && splitTargetMode === SplitTargetMode.Merge) {
      return;
    }

    this.inputValueBySplitTargetMode[this.splitTargetMode] = this.inputEl.value;
    this.splitTargetMode = splitTargetMode;
    if (shouldCarryOverInputValue) {
      this.inputValueBySplitTargetMode[splitTargetMode] = this.inputEl.value;
    } else {
      this.inputEl.value = this.inputValueBySplitTargetMode[splitTargetMode];
    }
    this.applySplitTargetMode();
    this.refreshNameRequiredHint();
    this.refreshOptionCheckboxStates();
    this.refreshSplitTargetModeSwitch();
    this.splitTargetModeToggle?.setValue(splitTargetMode === SplitTargetMode.Merge);
    this.updateSuggestions();
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
  // What KIND of seed that is, which is what decides whether it belongs in `Merge` too (issue #237). The
  // Heading names a note to CREATE; the previously-chosen target the reopened picker is seeded with is a
  // Real target, so that one seeds both modes.
  let isPickerSeedNewNoteName = true;

  for (;;) {
    // Capture the picker seed in a per-iteration const so the modal-opening closure does not close over
    // The mutable `pickerSeed` (reassigned below on "Change target").
    const currentSeed = pickerSeed;
    const isCurrentSeedNewNoteName = isPickerSeedNewNoteName;

    const splitFileModalResult: null | SplitFileModalResult = shouldSkipModalThisPass
      ? {
        action: 'split',
        frontmatterMergeStrategy: params.pluginSettingsComponent.settings.defaultFrontmatterMergeStrategy,
        inputValue: heading,
        insertMode: InsertMode.Append,
        item: null,
        shouldAllowOnlyCurrentFolder: params.shouldAllowOnlyCurrentFolderOverride ?? params.pluginSettingsComponent.settings.shouldAllowOnlyCurrentFolderByDefault,
        shouldAllowSplitIntoUnresolvedPath: params.pluginSettingsComponent.settings.shouldAllowSplitIntoUnresolvedPathByDefault,
        shouldFixFootnotes: params.pluginSettingsComponent.settings.shouldFixFootnotesByDefault,
        shouldIncludeFrontmatter: params.pluginSettingsComponent.settings.shouldIncludeFrontmatterWhenSplittingByDefault,
        shouldMergeHeadings: params.pluginSettingsComponent.settings.shouldMergeHeadingsByDefault,
        shouldTreatTitleAsPath: params.pluginSettingsComponent.settings.shouldTreatTitleAsPathByDefault,
        // A heading-driven split names a BRAND-NEW note after its heading, which is what this pass has
        // Always done - so it is a `Create` whatever the picker's default mode is (it never opens).
        splitTargetMode: SplitTargetMode.Create
      }
      : await new Promise<null | SplitFileModalResult>((promiseResolve) => {
        const modal = new SplitFileModal({
          ...params,
          canSwitchToSmartCut,
          initialInputValue: currentSeed,
          isInitialInputValueNewNoteName: isCurrentSeedNewNoteName,
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
        // What is switched over is a split's captured SELECTION, so the mark is a plain one even when the
        // Split itself was heading-driven.
        markedHeading: null,
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

    // A target has been chosen, so the switch's state is now the user's last answer to "create or merge?"
    // (issue #245). Recorded here rather than after the split so "Change target" reopens in the same mode.
    await rememberSplitTargetMode({
      canMergeIntoExistingNote: params.canMergeIntoExistingNote ?? true,
      isPickerSkipped: shouldSkipModalThisPass,
      pluginSettingsComponent: params.pluginSettingsComponent,
      splitTargetMode: splitFileModalResult.splitTargetMode
    });

    // Name first, path second (issue #238): once the name is settled, ASK where the note goes instead of
    // Letting the destination fall out of a setting, a typed path, or Obsidian's default new-note location.
    const targetParentFolderResult = await selectTargetParentFolder({
      abortController,
      isPickerStillSkipped: shouldSkipModalThisPass,
      params,
      splitFileModalResult
    });

    if (!targetParentFolderResult) {
      // The folder prompt was dismissed. That is "never mind, let me fix the name", not "abandon the
      // Operation" — so the picker reopens holding what was typed, exactly like "Change target" does.
      pickerSeed = splitFileModalResult.inputValue;
      isPickerSeedNewNoteName = true;
      continue;
    }

    const selectItemResult = await selectSplitTarget({
      heading,
      isPickerStillSkipped: shouldSkipModalThisPass,
      params,
      splitFileModalResult,
      targetParentFolder: targetParentFolderResult.folder
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
      // The seed is now the target the user already chose, not a name to create — so it seeds a `Merge`
      // Search too (issue #237).
      isPickerSeedNewNoteName = false;
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
        // What is switched over is a split's captured SELECTION, so the mark is a plain one even when the
        // Split itself was heading-driven.
        markedHeading: null,
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
 * Writes the mode the picker was left in back to `defaultSplitTargetMode`, so the next split/extract opens
 * where the last one did (issue #245).
 *
 * The reporter asked the switch to remember itself. Nothing new is persisted to do that: the mode already
 * lives in `defaultSplitTargetMode`, which is what seeds the picker, so remembering is just deciding that
 * the picker may write to it too. Opt-in via `shouldRememberLastSplitTargetMode`, because a hand-picked
 * default that starts moving on its own is a worse surprise than the request is a win.
 *
 * It records the mode at the point the user CHOOSES A TARGET rather than when the split finishes: the
 * switch is a property of the picker, and what it should reopen holding is what it was last set to. Two
 * consequences, both wanted — the confirmation dialog's "Change target" reopens in the same mode instead of
 * snapping back, and `Mod+Enter` counts as a `Create` (it MOVES the switch there before choosing, so the
 * user did see the mode they got).
 *
 * Two flows produce a mode the user never chose, and neither may be remembered — remembering either would
 * silently reset a `Merge` default from a screen that showed no switch at all:
 * - A pass that skipped the picker SYNTHESIZES `Create` for its heading-named note.
 * - `Create empty note at cursor...` forces `Create` because it has nothing to merge (issue #244).
 *
 * The write is NOT conditioned on the mode having changed. "Change target" runs this more than once per
 * split, so an unchanged mode does re-save the same value — which is what the neighboring
 * `shouldAskBeforeSplitting` write already does on every confirmed split, and a settings write is far
 * cheaper than a branch nothing can reach: the mode a unit test gets back IS the seeded setting, so an
 * equality guard would be permanently uncovered.
 *
 * It is a function of its own rather than an `if` in the loop so `prepareForSplitFile` stays under the
 * complexity limit.
 *
 * @param params - The settings component, the chosen mode, and the two flags that say whether the user
 * could actually see and flip it.
 */
async function rememberSplitTargetMode(params: RememberSplitTargetModeParams): Promise<void> {
  const { pluginSettingsComponent, splitTargetMode } = params;
  const { settings } = pluginSettingsComponent;

  if (
    !settings.shouldRememberLastSplitTargetMode
    || params.isPickerSkipped
    || !params.canMergeIntoExistingNote
  ) {
    return;
  }

  await pluginSettingsComponent.editAndSave((settingsToEdit) => {
    settingsToEdit.defaultSplitTargetMode = splitTargetMode;
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
      // The `Create`/`Merge` switch replaced the held-`Mod` rule on this path, so the selector reads
      // `splitTargetMode` instead; the base still carries the flag for `MergeItemSelector`.
      isModifier: false,
      item: splitFileModalResult.item,
      pluginSettingsComponent: prepareParams.pluginSettingsComponent,
      shouldAllowOnlyCurrentFolder: splitFileModalResult.shouldAllowOnlyCurrentFolder,
      shouldForceSplitIntoFolder: prepareParams.shouldForceSplitIntoFolder ?? false,
      /* v8 ignore start -- short-circuit branch depends on heading being falsy. */
      shouldTreatTitleAsPath: !heading && splitFileModalResult.shouldTreatTitleAsPath,
      /* v8 ignore stop */
      sourceFile: prepareParams.sourceFile,
      splitTargetMode: splitFileModalResult.splitTargetMode,
      // The folder the user was just ASKED for outranks the caller's override: it is the more recent, and
      // The more explicit, answer to the same question (issue #238).
      targetParentFolderOverride: params.targetParentFolder ?? resolveTargetParentFolderOverride(prepareParams, isPickerStillSkipped)
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
 * Asks where a newly created split/extract note goes, once it has a name (issue #238).
 *
 * The reporter's ask was ordering: without this the destination is never asked for at all — it falls out of
 * `Allow only current folder`, a path typed into the name box, or Obsidian's own `Default location for new
 * notes`, which is where their extract silently landed. Asking is opt-in
 * (`shouldAskForTargetFolderWhenSplitting`) because the common case is a heading-driven extract where the
 * name is already in the box and `Enter` is the whole interaction; a second modal on that path would be a
 * bigger regression than the bug.
 *
 * Two more conditions, both about there being a name to place at all: a pass that skipped the picker
 * (`shouldSkipModal`) never asks the user anything, and a `Merge` chooses a note that already exists, so it
 * has no folder to choose.
 *
 * It is a function of its own rather than an `if` in the loop so `prepareForSplitFile` stays under the
 * complexity limit.
 *
 * @param params - The prepare parameters, the picker's result, and whether the picker is still skipped.
 * @returns The chosen folder wrapped in a result (a `null` folder means the user was never asked), or
 * `null` when the prompt was dismissed — which sends the caller back to the picker rather than out.
 */
async function selectTargetParentFolder(params: SelectTargetParentFolderParams): Promise<null | SelectTargetParentFolderResult> {
  const prepareParams = params.params;
  const { settings } = prepareParams.pluginSettingsComponent;

  if (
    params.isPickerStillSkipped
    || params.splitFileModalResult.splitTargetMode !== SplitTargetMode.Create
    || !settings.shouldAskForTargetFolderWhenSplitting
  ) {
    return { folder: null };
  }

  const folder = await selectFolder({
    // The source note is locked for the whole setup flow, so an unlock request has to close this prompt
    // Just as it closes the picker the user came from.
    abortController: params.abortController,
    app: prepareParams.app,
    isAllowedFolder: (candidateFolder) => !settings.isPathIgnored(candidateFolder.path),
    placeholder: 'Select folder to create the new note in...',
    pluginSettingsComponent: prepareParams.pluginSettingsComponent
  });

  if (!folder) {
    return null;
  }

  return { folder };
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
