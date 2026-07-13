import type { PromiseResolve } from 'obsidian-dev-utils/async';

import {
  App,
  ButtonComponent,
  Modal,
  Platform
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';

import { getInsertModeFromEvent } from '../composers/composer-base.ts';
import { InsertMode } from '../insert-mode.ts';

export interface ConfirmDialogModalConstructorParams {
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
   * The label of the mobile confirm-and-don't-ask-again button, e.g. `Split and don't ask again`.
   */
  readonly confirmButtonMobileText: string;

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

export interface SwitchToSmartCutOptions {
  readonly canSwitch: boolean;
}

/* v8 ignore start -- ConfirmDialogModal is an internal UI class tested through exported functions and desktop integration tests. */
export class ConfirmDialogModal extends Modal {
  private readonly buildContent: (this: void, fragment: DocumentFragment) => Promise<void>;
  private readonly canReselectTarget: boolean;
  private readonly confirmButtonMobileText: string;
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
    this.confirmButtonMobileText = params.confirmButtonMobileText;
    this.confirmButtonText = params.confirmButtonText;
    this.promiseResolve = params.promiseResolve;
    this.switchToSmartCut = params.switchToSmartCut ?? null;
    this.title = params.title;

    this.scope.register([], 'Enter', (evt) => {
      this.confirm(evt);
    });

    this.scope.register([], 'Escape', () => {
      this.close();
    });

    if (this.switchToSmartCut) {
      this.scope.register(['Alt'], 's', () => {
        this.switchToSmartCutAction();
        return false;
      });
    }

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

  private confirm(evt: KeyboardEvent | MouseEvent): void {
    this.isSelected = true;
    this.promiseResolve({
      insertMode: getInsertModeFromEvent(evt),
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

    if (Platform.isMobile) {
      buttonContainerEl.createEl('button', {
        cls: 'mod-warning',
        text: this.confirmButtonMobileText
      }, (button) => {
        button.addEventListener('click', (evt) => {
          this.shouldAskAgain = false;
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
              this.shouldAskAgain = !evt.target.checked;
            });
          });
        label.appendText('Don\'t ask again');
      });
    }

    new ButtonComponent(buttonContainerEl)
      .setButtonText('Change target')
      .setTooltip('Go back to the target picker to choose a different target (Alt+C)')
      .setDisabled(!this.canReselectTarget)
      .onClick(() => {
        this.reselectTarget();
      });

    if (this.switchToSmartCut) {
      new ButtonComponent(buttonContainerEl)
        .setButtonText('Switch to smart cut & paste')
        .setTooltip('Mark the selection to move and open the target note instead of splitting')
        .setDisabled(!this.switchToSmartCut.canSwitch)
        .onClick(() => {
          this.switchToSmartCutAction();
        });
    }

    buttonContainerEl.createEl('button', {
      cls: 'mod-warning',
      text: this.confirmButtonText
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
