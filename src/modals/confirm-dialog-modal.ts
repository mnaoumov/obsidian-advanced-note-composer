import type { PromiseResolve } from 'obsidian-dev-utils/async';

import {
  App,
  ButtonComponent,
  Modal
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';

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
  readonly buildContent: (this: void, fragment: DocumentFragment) => Promise<void>;

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
  private askAgainCheckboxEl: HTMLInputElement | null = null;
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

    this.registerAltShortcuts();
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
    // ONE action row, the shape Obsidian's own confirmation dialogs have (issue #281). 5.11.0 had moved
    // `Don't ask again` / `Change target` / `Switch to smart cut & paste` onto a separate bordered strip
    // Above this row, and two users independently found the dialog harder to read for it — so the row is
    // Back, and only the `Alt` shortcuts that strip introduced are kept, named in each control's tooltip.
    // The checkbox is rendered on mobile as well: it works by touch, and it replaces the combined
    // "<verb> and don't ask again" button the mobile layout used to hand-roll.
    const buttonContainerEl = this.modalEl.createDiv('modal-button-container');

    this.setContent(
      await createFragmentAsync(async (f) => {
        await this.buildContent(f);
      })
    );

    buttonContainerEl.createEl('label', {
      attr: { title: 'Don\'t ask again (Alt+D)' },
      cls: 'mod-checkbox'
    }, (label) => {
      label.createEl('input', {
        attr: { tabindex: -1 },
        type: 'checkbox'
      }, (checkboxEl) => {
        this.askAgainCheckboxEl = checkboxEl;
        checkboxEl.checked = !this.shouldAskAgain;
        checkboxEl.addEventListener('change', () => {
          this.shouldAskAgain = !checkboxEl.checked;
        });
      });
      label.appendText('Don\'t ask again');
    });

    new ButtonComponent(buttonContainerEl)
      .setButtonText('Change target')
      .setTooltip('Go back to the target picker to choose a different target (Alt+C)')
      .setDisabled(!this.canReselectTarget)
      .onClick(() => {
        this.reselectTarget();
      });

    const switchToSmartCut = this.switchToSmartCut;
    if (switchToSmartCut) {
      new ButtonComponent(buttonContainerEl)
        .setButtonText('Switch to smart cut & paste')
        .setTooltip('Mark the selection to move and open the target note instead of splitting (Alt+S)')
        .setDisabled(!switchToSmartCut.canSwitch)
        .onClick(() => {
          this.switchToSmartCutAction();
        });
    }

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

  /**
   * The `Alt` shortcuts for the options in the action row. Each one repeats its control's own disabled
   * guard, because a disabled button does nothing to stop the key reaching the same action.
   */
  private registerAltShortcuts(): void {
    this.scope.register(['Alt'], 'd', () => {
      this.shouldAskAgain = !this.shouldAskAgain;
      if (this.askAgainCheckboxEl) {
        this.askAgainCheckboxEl.checked = !this.shouldAskAgain;
      }
      return false;
    });

    this.scope.register(['Alt'], 'c', () => {
      if (!this.canReselectTarget) {
        return true;
      }
      this.reselectTarget();
      return false;
    });

    const switchToSmartCut = this.switchToSmartCut;
    if (switchToSmartCut) {
      this.scope.register(['Alt'], 's', () => {
        if (!switchToSmartCut.canSwitch) {
          return true;
        }
        this.switchToSmartCutAction();
        return false;
      });
    }
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
