/**
 * @file
 *
 * The one destination-folder picker every flow reopens from a confirmation dialog's "Change target"
 * action (issues #199 / #205).
 *
 * It was extracted from `move-folder-modal.ts`, which had been the only folder picker that was not tied to
 * a specific operation's own suggester. Five flows needed the same thing — a plain "which folder?" question
 * with the plugin's recent-folder ordering and modal instructions — and the only thing that differs between
 * them is which folders are offered, so that is the single injected {@link SelectFolderParams.isAllowedFolder}
 * callback rather than five near-identical `FuzzySuggestModal` subclasses.
 *
 * The split/extract folder-then-name pair (issue #261) opens with it too, through
 * {@link selectFolderForNewNote}, which adds the split picker's `Create` / `Merge` switch above the list
 * (issue #297).
 */

import type {
  App,
  FuzzyMatch,
  TFolder
} from 'obsidian';
import type { PromiseResolve } from 'obsidian-dev-utils/async';

import {
  FuzzySuggestModal,
  Setting
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { ModalCommandBuilder } from 'obsidian-dev-utils/obsidian/modals/modal-command-builder';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { openModal } from '../open-minimizable-modal.ts';
import { PickerRecencyOrder } from '../plugin-settings.ts';
import { reorderSuggestionsByRecentFolders } from '../recent-suggestions.ts';

/**
 * The user chose the folder the new note is created in.
 */
export interface SelectFolderForNewNoteChosen {
  readonly folder: TFolder;
  readonly kind: 'folder';
}

/**
 * Parameters for {@link selectFolderForNewNote}.
 */
export interface SelectFolderForNewNoteParams extends SelectFolderParams {
  /**
   * Whether the flow may merge into an existing note at all. `Create empty note at cursor...` passes
   * `false` (issue #244): the switch is then rendered disabled, saying why, and `Alt+M` is not registered.
   */
  readonly canMergeIntoExistingNote: boolean;
}

/**
 * What {@link selectFolderForNewNote} answered: a folder, or the create/merge switch flipped to `Merge`.
 */
export type SelectFolderForNewNoteResult = SelectFolderForNewNoteChosen | SelectFolderForNewNoteSwitchedToMerge;

/**
 * The user flipped the create/merge switch to `Merge` before choosing a folder (issue #297).
 */
export interface SelectFolderForNewNoteSwitchedToMerge {
  readonly kind: 'switch-to-merge';
}

/**
 * Parameters for {@link selectFolder}.
 */
export interface SelectFolderParams {
  /**
   * An optional controller that closes this picker when aborted. Only the flows that already hold a lock
   * when they ask — the split/extract folder prompt (issue #238), which runs inside a setup flow that has
   * the source note locked — need it; an unlock request must close this prompt exactly as it closes the
   * picker the user came from.
   */
  readonly abortController?: AbortController;

  readonly app: App;

  /**
   * Whether a folder is an allowed destination. The only thing that differs between the flows sharing this
   * picker — a move excludes the source's own subtree and its current parent, a flatten excludes the
   * subtree but keeps the parent (staying put is its default, not a no-op), and a create/merge/split
   * destination merely has to not be ignored.
   *
   * @param folder - The candidate destination folder.
   * @returns Whether the folder is offered.
   */
  readonly isAllowedFolder: (this: void, folder: TFolder) => boolean;

  /**
   * The suggester's placeholder text, e.g. `Select folder to move into...`. Each flow words it in its own
   * terms, because "target" means a different thing in each.
   */
  readonly placeholder: string;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

interface SelectFolderModalConstructorParams extends SelectFolderParams {
  readonly promiseResolve: PromiseResolve<null | SelectFolderForNewNoteResult>;

  /**
   * Renders the create/merge switch above the input when present (issue #297). Only the folder-then-name
   * pair passes it: every other flow's folder is not where a note is about to be created.
   */
  readonly splitTargetModeSwitch?: SplitTargetModeSwitchParams;
}

interface SplitTargetModeSwitchParams {
  readonly canMergeIntoExistingNote: boolean;
}

/* v8 ignore start -- SelectFolderModal is an internal UI class tested through the exported function. */
class SelectFolderModal extends FuzzySuggestModal<TFolder> {
  private readonly isAllowedFolder: (this: void, folder: TFolder) => boolean;
  private isSelected = false;
  private readonly pickerRecencyOrder: PickerRecencyOrder;
  private readonly promiseResolve: PromiseResolve<null | SelectFolderForNewNoteResult>;
  private readonly splitTargetModeSwitch: null | SplitTargetModeSwitchParams;

  public constructor(params: SelectFolderModalConstructorParams) {
    super(params.app);

    this.isAllowedFolder = params.isAllowedFolder;
    this.pickerRecencyOrder = params.pluginSettingsComponent.settings.pickerRecencyOrder;
    this.promiseResolve = params.promiseResolve;
    this.splitTargetModeSwitch = params.splitTargetModeSwitch ?? null;

    this.setPlaceholder(params.placeholder);

    const builder = new ModalCommandBuilder();
    // The key the split picker's own switch and the name box's `Switch to merge` already use, so the three
    // surfaces of one flow agree on it. A flow that cannot merge drops it, as the picker does (issue #244).
    if (this.splitTargetModeSwitch?.canMergeIntoExistingNote) {
      builder.addKeyboardCommand({
        key: 'm',
        modifiers: ['Alt'],
        onKey: () => {
          this.switchToMerge();
          return false;
        },
        purpose: 'to switch to merge'
      });
    }
    builder.build(this, { shouldShowInstructions: params.pluginSettingsComponent.settings.shouldShowModalInstructions });
  }

  public override getItems(): TFolder[] {
    return this.app.vault.getAllFolders(true).filter((folder) => this.isAllowedFolder(folder));
  }

  public override getItemText(item: TFolder): string {
    return item.isRoot() ? '/' : item.path;
  }

  public override getSuggestions(query: string): FuzzyMatch<TFolder>[] {
    return reorderSuggestionsByRecentFolders({
      app: this.app,
      isAllowedFolder: this.isAllowedFolder,
      pickerRecencyOrder: this.pickerRecencyOrder,
      query,
      suggestions: super.getSuggestions(query)
    });
  }

  public override onChooseItem(item: TFolder): void {
    this.isSelected = true;
    this.promiseResolve({ folder: item, kind: 'folder' });
  }

  public override onClose(): void {
    super.onClose();
    if (!this.isSelected) {
      this.promiseResolve(null);
    }
  }

  public override onOpen(): void {
    super.onOpen();
    if (!this.splitTargetModeSwitch) {
      return;
    }
    this.renderSplitTargetModeSwitch(this.splitTargetModeSwitch);
    // The prepended switch becomes the first focusable thing in the modal and takes the focus a turn
    // later, which is issue #262 on the split picker; deferred for the reason it is there.
    invokeAsyncSafely(async () => {
      await sleep(0);
      this.inputEl.focus();
    });
  }

  public override selectSuggestion(value: FuzzyMatch<TFolder>, $event: KeyboardEvent | MouseEvent): void {
    this.isSelected = true;
    super.selectSuggestion(value, $event);
  }

  /**
   * The split picker's `Create` / `Merge` switch, on the folder prompt that replaces the picker while
   * `Should choose the folder before the name when splitting` is on (issue #297). Same class, same name and
   * the same place above the input, so the first thing an extract shows says what it is about to do and
   * offers the other answer. It only ever reads `Create` here: flipping it leaves this prompt.
   *
   * @param params - Whether merging is available at all.
   */
  private renderSplitTargetModeSwitch(params: SplitTargetModeSwitchParams): void {
    const switchContainerEl = createDiv('advanced-note-composer-split-target-mode');
    this.modalEl.prepend(switchContainerEl);
    new Setting(switchContainerEl)
      .setName('Create a new note')
      // Shown DISABLED rather than hidden when merging is unavailable, the answer the picker's switch gives.
      .setDesc(
        params.canMergeIntoExistingNote
          ? 'Off: choose the folder below, then name the new note. On: merge into an existing note instead. (Alt+M)'
          : 'There is nothing to merge, so this flow can only create a new note.'
      )
      .addToggle((toggle) => {
        toggle
          .setValue(false)
          .setDisabled(!params.canMergeIntoExistingNote)
          .onChange((value) => {
            if (value) {
              this.switchToMerge();
            }
          });
      });
  }

  private switchToMerge(): void {
    this.isSelected = true;
    this.promiseResolve({ kind: 'switch-to-merge' });
    this.close();
  }
}
/* v8 ignore stop */

/**
 * Asks the user for a destination folder.
 *
 * @param params - The parameters.
 * @returns The chosen folder, or `null` when the picker was dismissed. A `null` from a "Change target"
 * detour means "never mind" — the caller returns to its confirmation dialog with the destination it already
 * had, rather than abandoning the whole operation.
 */
export async function selectFolder(params: SelectFolderParams): Promise<null | TFolder> {
  const result = await new Promise<null | SelectFolderForNewNoteResult>((promiseResolve) => {
    openModal(new SelectFolderModal({ ...params, promiseResolve }), params.abortController);
  });
  // With no switch rendered nothing can answer `switch-to-merge`, so anything but a folder is a dismissal.
  return result?.kind === 'folder' ? result.folder : null;
}

/**
 * Asks for the folder a new note is created in, with the split picker's `Create` / `Merge` switch above
 * the list (issue #297). The folder-then-name pair opens with this prompt, and before the switch was on it
 * a user who wanted to merge had to choose an arbitrary folder first, only to reach the name box's
 * `Switch to merge`.
 *
 * @param params - The parameters.
 * @returns The chosen folder, `switch-to-merge` when the switch was flipped, or `null` when dismissed.
 */
export async function selectFolderForNewNote(params: SelectFolderForNewNoteParams): Promise<null | SelectFolderForNewNoteResult> {
  return await new Promise<null | SelectFolderForNewNoteResult>((promiseResolve) => {
    openModal(
      new SelectFolderModal({
        ...params,
        promiseResolve,
        splitTargetModeSwitch: { canMergeIntoExistingNote: params.canMergeIntoExistingNote }
      }),
      params.abortController
    );
  });
}
