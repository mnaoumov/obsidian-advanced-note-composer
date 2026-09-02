import type { PromiseResolve } from 'obsidian-dev-utils/async';

import {
  App,
  Modal
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import {
  ModalCommandBuilder,
  ModalCommandsRenderMode
} from 'obsidian-dev-utils/obsidian/modals/modal-command-builder';

import { getInsertModeFromEvent } from '../composers/composer-base.ts';
import { InsertMode } from '../insert-mode.ts';

export interface ConfirmDialogModalResult {
  readonly insertMode: InsertMode;
  readonly isConfirmed: boolean;

  /**
   * Whether the "Don't ask again" box is unchecked, i.e. whether the flow's `shouldAskBefore*` setting
   * should stay `true`. Each flow maps this back to its own setting.
   */
  readonly shouldAskAgain: boolean;
  readonly shouldReselectTarget: boolean;
  readonly shouldSwitchToSmartCut: boolean;
}

interface ConfirmDialogModalConstructorParams {
  readonly app: App;

  /**
   * Builds the dialog body. Each flow supplies its own content (the question, the source/target links,
   * and any extra sections such as split's "Source content to split").
   */
  buildContent(this: void, fragment: DocumentFragment): Promise<void>;

  /**
   * Whether the "Change target" action is enabled (send the flow back to the target picker). The button
   * is always rendered; it is disabled when this is `false`.
   */
  readonly canReselectTarget: boolean;

  /**
   * The label of the primary confirm button, e.g. `Split` or `Merge`.
   */
  readonly confirmButtonText: string;
  readonly promiseResolve: PromiseResolve<ConfirmDialogModalResult>;

  /**
   * When provided, the dialog renders a "Switch to smart cut & paste" button (+ `Alt+S`), disabled when
   * `canSwitch` is `false`. Omit it entirely for flows that do not offer smart cut (merge).
   */
  readonly switchToSmartCut?: SwitchToSmartCutOptions;
  readonly title: string;
}

interface SwitchToSmartCutOptions {
  readonly canSwitch: boolean;
}

/* v8 ignore start -- ConfirmDialogModal is an internal UI class tested through exported functions and desktop integration tests. */
export class ConfirmDialogModal extends Modal {
  private readonly buildContent: (this: void, fragment: DocumentFragment) => Promise<void>;
  private readonly canReselectTarget: boolean;
  private readonly confirmButtonText: string;
  private isSelected = false;
  private readonly promiseResolve: PromiseResolve<ConfirmDialogModalResult>;
  private shouldAskAgain = true;
  private readonly switchToSmartCut: null | SwitchToSmartCutOptions;
  private readonly title: string;

  public constructor(params: ConfirmDialogModalConstructorParams) {
    super(params.app);

    this.buildContent = params.buildContent;
    this.canReselectTarget = params.canReselectTarget;
    this.confirmButtonText = params.confirmButtonText;
    this.promiseResolve = params.promiseResolve;
    this.switchToSmartCut = params.switchToSmartCut ?? null;
    this.title = params.title;

    this.scope.register([], 'Enter', ($event) => {
      this.confirm($event);
      return false;
    });

    this.scope.register([], 'Escape', () => {
      this.close();
      return false;
    });

    this.buildCommands();
  }

  public override onClose(): void {
    super.onClose();
    if (!this.isSelected) {
      this.promiseResolve({
        insertMode: InsertMode.Append,
        isConfirmed: false,
        shouldAskAgain: false,
        shouldReselectTarget: false,
        shouldSwitchToSmartCut: false
      });
    }
  }

  public override onOpen(): void {
    super.onOpen();
    invokeAsyncSafely(this.onOpenAsync.bind(this));
  }

  /**
   * Builds the dialog's control strip — the OPTIONS, as opposed to the confirm/cancel action row
   * `onOpenAsync` builds.
   *
   * Built here rather than in `onOpenAsync` on purpose. `Modal`'s constructor has already created
   * `modalEl` with its close button, title and content, and `ModalCommandBuilder.build` appends its own
   * strip to `modalEl` — so building now lands the strip after the content and BEFORE the
   * `modal-button-container` that `onOpenAsync` creates later. The options belong above the actions, and
   * this gets that ordering out of the DOM shape rather than out of positioning code. It also keeps the
   * `Alt` shortcuts registered where the `Enter` / `Escape` ones are.
   *
   * `Buttons` render mode rather than the instruction bar because this is a plain `Modal` with no
   * instruction bar to borrow, and because a phone has no modifier key to press — the button IS the only
   * way in there. That is what retired the `Platform.isMobile` branch this method replaces, which used to
   * hand-roll a combined "<confirm> and don't ask again" button for exactly that reason.
   *
   * The returned `ModalCommands` handle is deliberately dropped: every `checkIsAvailable` below reads a
   * field fixed at construction, so the single `refresh()` that `build` performs itself is the only one
   * that can ever change anything.
   */
  private buildCommands(): void {
    const builder = new ModalCommandBuilder();

    builder.addCheckbox({
      key: 'd',
      modifiers: ['Alt'],
      onChange: (isChecked: boolean) => {
        this.shouldAskAgain = !isChecked;
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = !this.shouldAskAgain;
      },
      purpose: 'Don\'t ask again'
    });

    builder.addKeyboardCommand({
      checkIsAvailable: () => this.canReselectTarget,
      key: 'c',
      modifiers: ['Alt'],
      onActivate: () => {
        this.reselectTarget();
      },
      onKey: () => {
        if (!this.canReselectTarget) {
          return true;
        }
        this.reselectTarget();
        return false;
      },
      purpose: 'Change target'
    });

    const switchToSmartCut = this.switchToSmartCut;
    if (switchToSmartCut) {
      builder.addKeyboardCommand({
        checkIsAvailable: () => switchToSmartCut.canSwitch,
        key: 's',
        modifiers: ['Alt'],
        onActivate: () => {
          this.switchToSmartCutAction();
        },
        // `checkIsAvailable` disables the BUTTON and nothing else, so the shortcut needs the same guard
        // Spelled out — which `Alt+C` always had and `Alt+S` never did, letting the shortcut reach an
        // Action whose button was visibly disabled.
        onKey: () => {
          if (!switchToSmartCut.canSwitch) {
            return true;
          }
          this.switchToSmartCutAction();
          return false;
        },
        purpose: 'Switch to smart cut & paste'
      });
    }

    builder.build(this, { renderMode: ModalCommandsRenderMode.Buttons });
  }

  private confirm($event: KeyboardEvent | MouseEvent): void {
    this.isSelected = true;
    this.promiseResolve({
      insertMode: getInsertModeFromEvent($event),
      isConfirmed: true,
      shouldAskAgain: this.shouldAskAgain,
      shouldReselectTarget: false,
      shouldSwitchToSmartCut: false
    });
    this.close();
  }

  private async onOpenAsync(): Promise<void> {
    this.setTitle(this.title);

    this.containerEl.addClass('mod-confirmation');
    const buttonContainerEl = this.modalEl.createDiv('modal-button-container');

    this.setContent(
      await createFragmentAsync(async (f) => {
        await this.buildContent(f);
      })
    );

    buttonContainerEl.createEl('button', {
      cls: 'mod-warning',
      text: this.confirmButtonText
    }, (button) => {
      button.addEventListener('click', ($event) => {
        this.confirm($event);
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
      shouldAskAgain: false,
      shouldReselectTarget: true,
      shouldSwitchToSmartCut: false
    });
    this.close();
  }

  private switchToSmartCutAction(): void {
    this.isSelected = true;
    this.promiseResolve({
      insertMode: InsertMode.Append,
      isConfirmed: false,
      shouldAskAgain: false,
      shouldReselectTarget: false,
      shouldSwitchToSmartCut: true
    });
    this.close();
  }
}

/* v8 ignore stop */
