/**
 * @file
 *
 * The NAME half of the folder-then-name pair that replaces the split/extract picker when
 * `Should choose the folder before the name when splitting` is on (issue #261).
 *
 * It started life as a bare `prompt()` from `obsidian-dev-utils`, which offered `Create` and `Cancel` and
 * nothing else. Issue #280 is what that costs: the `Create` / `Merge` switch lives in the picker this pair
 * replaces, so with the setting on a split could only ever CREATE — a capability removed by a setting that
 * says nothing about it. The reporter asked for the switch back, and for the naming box to grow the two
 * other things the picker gives him: a way to change the folder he has just chosen, and a minimize button.
 *
 * **Why this is a modal of its own rather than more parameters on `prompt()`.** Both asks need something
 * `prompt()` structurally cannot give: it opens the modal itself, through `showModal`, so there is no
 * instance to hand {@link MinimizableModal} (the minimize button), and the callbacks of its
 * `commandBuilder` strip get no handle to the modal, so a control that has to CLOSE the box and report
 * what the user chose instead has nowhere to close from. Everything else here is deliberately the same
 * shape as the `prompt()` it replaces, so the flow around it did not have to change.
 *
 * The three ways out are {@link SplitNoteNameAction}; dismissing resolves `null`, exactly as the prompt did.
 */

import type { PromiseResolve } from 'obsidian-dev-utils/async';

import {
  App,
  ButtonComponent,
  Modal,
  TextComponent
} from 'obsidian';
import { applySpellcheckMode } from 'obsidian-dev-utils/obsidian/html-element';
import {
  ModalCommandBuilder,
  ModalCommandsRenderMode
} from 'obsidian-dev-utils/obsidian/modals/modal-command-builder';
import { SpellcheckMode } from 'obsidian-dev-utils/obsidian/obsidian-settings';

import { openMinimizableModal } from '../open-minimizable-modal.ts';

/**
 * What the user did with the name box.
 */
export enum SplitNoteNameAction {
  /**
   * Go back and pick a different folder, keeping whatever has been typed here (issue #280).
   */
  ChangeFolder = 'ChangeFolder',

  /**
   * Create the note under the already-chosen folder, named as typed.
   */
  Create = 'Create',

  /**
   * Abandon the pair and open the ordinary target picker in `Merge` mode instead (issue #280). This is
   * how the `Create` / `Merge` switch stays reachable on a path that never opens the picker holding it.
   */
  SwitchToMerge = 'SwitchToMerge'
}

/**
 * Parameters for {@link openSplitNoteNameModal}.
 */
export interface OpenSplitNoteNameModalParams {
  /**
   * An optional controller that closes the box when aborted. The source note is locked for the whole
   * setup flow, so an unlock request has to close this exactly as it closes the picker it stands in for.
   */
  readonly abortController?: AbortController;

  readonly app: App;

  /**
   * Whether `Switch to merge` leads anywhere. `Create empty note at cursor...` passes `false` (issue
   * #244) — it extracts nothing, so there is nothing to merge — and the button is then rendered DISABLED
   * rather than dropped, the same answer the picker's own switch gives.
   */
  readonly canMergeIntoExistingNote: boolean;

  /**
   * What to pre-fill the box with — the heading an extract came from, when there is one, so the common
   * case is one keystroke: confirm it.
   */
  readonly defaultValue: string;

  /**
   * The folder the first prompt already chose, stated above the box. Without it `Change target folder`
   * asks the user to change something they cannot see.
   */
  readonly folderPath: string;
}

/**
 * What {@link openSplitNoteNameModal} resolved to.
 */
export interface SplitNoteNameModalResult {
  readonly action: SplitNoteNameAction;

  /**
   * What the box held when the user left it. Meaningful for every action, not just
   * {@link SplitNoteNameAction.Create}: `Change target folder` reopens the box holding it, and
   * `Switch to merge` seeds the picker with it.
   */
  readonly name: string;
}

interface SplitNoteNameModalConstructorParams extends OpenSplitNoteNameModalParams {
  readonly promiseResolve: PromiseResolve<null | SplitNoteNameModalResult>;
}

/* v8 ignore start -- SplitNoteNameModal is an internal UI class tested through the real app (integration). */
class SplitNoteNameModal extends Modal {
  private readonly canMergeIntoExistingNote: boolean;
  private readonly defaultValue: string;
  private readonly folderPath: string;
  private inputEl?: HTMLInputElement;
  private nameRequiredHintEl?: HTMLElement;
  private readonly promiseResolve: PromiseResolve<null | SplitNoteNameModalResult>;
  private resolvedResult: null | SplitNoteNameModalResult = null;

  public constructor(params: SplitNoteNameModalConstructorParams) {
    super(params.app);
    this.canMergeIntoExistingNote = params.canMergeIntoExistingNote;
    this.defaultValue = params.defaultValue;
    this.folderPath = params.folderPath;
    this.promiseResolve = params.promiseResolve;
  }

  public override onClose(): void {
    super.onClose();
    // A close with no action recorded is a dismissal — `Escape`, the native X, or the minimized bar's
    // cancel. That abandons the split, exactly as dismissing the `prompt()` this replaces did.
    this.promiseResolve(this.resolvedResult);
  }

  public override onOpen(): void {
    super.onOpen();
    this.setTitle('Enter note name');
    // The box's own handle, for the plugin's stylesheet and for the desktop suite that drives its buttons.
    // It stood in for a dev-utils `prompt()`, whose `.prompt-modal` class the flow's tests used to select
    // on, so something has to name it or those selectors have nothing to find.
    this.modalEl.addClass('advanced-note-composer-split-note-name-modal');

    this.contentEl.createDiv({
      cls: 'advanced-note-composer-split-note-name-folder',
      text: `The new note goes in ${this.folderPath === '/' ? 'the vault root' : this.folderPath}.`
    });

    const textComponent = new TextComponent(this.contentEl);
    textComponent.setValue(this.defaultValue);
    textComponent.setPlaceholder('Note name');
    this.inputEl = textComponent.inputEl;
    // The box names a note the user is INVENTING, so it follows `Editor > Spellcheck` exactly as the
    // dev-utils `prompt()` it replaces has since issue #233, and as the picker's box does in `Create`.
    // `AbstractTextComponent` forces `spellcheck="false"` on every text component, so this has to be
    // applied here or the attribute the setting asks for never lands.
    applySpellcheckMode({
      app: this.app,
      element: this.inputEl,
      spellcheckMode: SpellcheckMode.FollowObsidianSetting
    });
    this.inputEl.addEventListener('input', () => {
      this.refreshNameRequiredHint();
    });
    this.inputEl.addEventListener('keydown', ($event) => {
      if ($event.key !== 'Enter') {
        return;
      }
      $event.preventDefault();
      this.create();
    });

    this.nameRequiredHintEl = this.contentEl.createDiv({
      cls: 'advanced-note-composer-name-required-hint',
      text: 'Type a name for the new note. Until it has one, there is nothing to create.'
    });
    this.refreshNameRequiredHint();

    // Built BEFORE the action row so the two detours sit above `Create` / `Cancel`, which is the ordering
    // the confirmation dialog already establishes: options first, actions last.
    this.buildCommands();

    const buttonContainerEl = this.modalEl.createDiv('modal-button-container');
    new ButtonComponent(buttonContainerEl)
      .setButtonText('Create')
      .setCta()
      .onClick(() => {
        this.create();
      });
    new ButtonComponent(buttonContainerEl)
      .setButtonText('Cancel')
      .onClick(() => {
        this.close();
      });

    this.inputEl.focus();
    this.inputEl.select();
  }

  /**
   * Builds the two detours issue #280 asked for, on the keys those same two actions already use
   * elsewhere: `Alt+C` is `Change target` in the confirmation dialog, and `Alt+M` is the picker's own
   * create/merge switch. Reusing them is the whole point — this box stands in for both of those surfaces.
   *
   * `Buttons` render mode because this is a plain `Modal` with no instruction bar to borrow, and because a
   * phone has no modifier key to press, so the button is the only way in there.
   */
  private buildCommands(): void {
    const builder = new ModalCommandBuilder();

    builder.addKeyboardCommand({
      key: 'c',
      modifiers: ['Alt'],
      onActivate: () => {
        this.leaveWith(SplitNoteNameAction.ChangeFolder);
      },
      onKey: () => {
        this.leaveWith(SplitNoteNameAction.ChangeFolder);
        return false;
      },
      purpose: 'Change target folder'
    });

    builder.addKeyboardCommand({
      checkIsAvailable: () => this.canMergeIntoExistingNote,
      key: 'm',
      modifiers: ['Alt'],
      onActivate: () => {
        this.switchToMerge();
      },
      // `checkIsAvailable` disables the BUTTON and nothing else, so the shortcut needs the same guard
      // spelled out or it reaches an action whose button is visibly disabled.
      onKey: () => {
        if (!this.canMergeIntoExistingNote) {
          return true;
        }
        this.switchToMerge();
        return false;
      },
      purpose: 'Switch to merge'
    });

    builder.build(this, { renderMode: ModalCommandsRenderMode.Buttons });
  }

  private create(): void {
    if (this.isNameMissing()) {
      // The hint is already on screen (it tracks the same condition); refreshing keeps them in step if the
      // box was changed without an `input` event.
      this.refreshNameRequiredHint();
      return;
    }
    this.leaveWith(SplitNoteNameAction.Create);
  }

  /**
   * Whether the box names nothing. The TRIMMED value is what counts: a box holding only spaces names
   * nothing, and the name transform would have turned it into `Untitled` just as an empty one does.
   *
   * @returns Whether a name is still missing.
   */
  private isNameMissing(): boolean {
    return !(this.inputEl?.value ?? '').trim();
  }

  /**
   * Records what the user chose and closes. `onClose` is the ONE place that resolves, so a dismissal and
   * an action cannot race each other into two resolutions.
   *
   * @param action - What the user chose.
   */
  private leaveWith(action: SplitNoteNameAction): void {
    this.resolvedResult = { action, name: this.inputEl?.value ?? '' };
    this.close();
  }

  /**
   * Shows the hint exactly while the refusal is live, so the rule is visible BEFORE `Create` is pressed
   * rather than as a complaint afterwards — the same answer issue #238 gave the picker.
   *
   * `show()` / `hide()` rather than `toggleVisibility`: that one sets `visibility`, which leaves the
   * hint's blank line holding a gap under the box in the common case where there IS a name.
   */
  private refreshNameRequiredHint(): void {
    if (this.isNameMissing()) {
      this.nameRequiredHintEl?.show();
      return;
    }
    this.nameRequiredHintEl?.hide();
  }

  private switchToMerge(): void {
    this.leaveWith(SplitNoteNameAction.SwitchToMerge);
  }
}
/* v8 ignore stop */

/**
 * Asks for the new note's name, offering the two detours issue #280 asked for.
 *
 * Minimizable, unlike the folder picker that precedes it and like the split/extract picker the pair as a
 * whole replaces (issue #130): by this point a selection has been captured, the source note is locked and
 * a folder has been chosen, so there IS a half-finished operation worth parking. That also means a click
 * on the dimmed background MINIMIZES rather than cancels (issue #202) — `Escape`, `Cancel` and the bar's
 * ✕ are what abandon it.
 *
 * @param params - The parameters.
 * @returns What the user chose, or `null` when the box was dismissed.
 */
/* v8 ignore start -- thin modal-open glue tested via the real app (integration). */
export async function openSplitNoteNameModal(params: OpenSplitNoteNameModalParams): Promise<null | SplitNoteNameModalResult> {
  return await new Promise<null | SplitNoteNameModalResult>((promiseResolve) => {
    openMinimizableModal(new SplitNoteNameModal({ ...params, promiseResolve }), params.abortController);
  });
}
/* v8 ignore stop */
