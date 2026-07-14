import type {
  App,
  Notice
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { ButtonComponent } from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { AllWindowsEventComponent } from 'obsidian-dev-utils/obsidian/components/all-windows-event-component';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';

import type { CancelMoveCommandHandler } from './command-handlers/cancel-move-command-handler.ts';
import type { MoveMarkedSelectionEditorCommandHandlerBase } from './command-handlers/move-marked-selection-editor-command-handler-base.ts';
import type { OpenSplitModalCommandHandler } from './command-handlers/open-split-modal-command-handler.ts';
import type { MoveSelectionBuffer } from './move-selection-buffer.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

/**
 * Parameters for creating a {@link MoveNoticeComponent}.
 */
export interface MoveNoticeComponentConstructorParams {
  readonly app: App;
  readonly cancelMoveCommandHandler: CancelMoveCommandHandler;
  readonly moveAtCursorHandler: MoveMarkedSelectionEditorCommandHandlerBase;
  readonly moveSelectionBuffer: MoveSelectionBuffer;
  readonly moveToBottomHandler: MoveMarkedSelectionEditorCommandHandlerBase;
  readonly moveToTopHandler: MoveMarkedSelectionEditorCommandHandlerBase;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * A button in the marked-selection notice, paired with the predicate that decides whether it is
 * enabled (or `null` when the button is always enabled, e.g. `Cancel move`).
 */
interface MoveNoticeButton {
  readonly component: ButtonComponent;
  readonly getIsEnabled: (() => boolean) | null;
}

/**
 * A labelled action offered as a button in the marked-selection notice.
 */
interface MoveNoticeButtonDefinition {
  /**
   * Predicate deciding whether the button is enabled, re-evaluated on refresh; `null` for a button
   * that is always enabled (e.g. `Cancel move`).
   */
  readonly getIsEnabled: (() => boolean) | null;
  readonly label: string;
  onClick(): void;
}

/**
 * Owns the permanent notice shown while a selection is marked for moving. The notice carries a
 * `Switch to split/extract` button, up to three configurable move buttons, and an always-shown
 * `Cancel move` button. Button state is refreshed whenever the active leaf or the editor selection changes.
 */
export class MoveNoticeComponent extends AllWindowsEventComponent {
  private buttons: MoveNoticeButton[] | null = null;
  private readonly cancelMoveCommandHandler: CancelMoveCommandHandler;
  private readonly moveAtCursorHandler: MoveMarkedSelectionEditorCommandHandlerBase;
  private readonly moveSelectionBuffer: MoveSelectionBuffer;
  private readonly moveToBottomHandler: MoveMarkedSelectionEditorCommandHandlerBase;
  private readonly moveToTopHandler: MoveMarkedSelectionEditorCommandHandlerBase;
  private openSplitModalCommandHandler: null | OpenSplitModalCommandHandler = null;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: MoveNoticeComponentConstructorParams) {
    super(params.app);
    this.cancelMoveCommandHandler = params.cancelMoveCommandHandler;
    this.moveAtCursorHandler = params.moveAtCursorHandler;
    this.moveSelectionBuffer = params.moveSelectionBuffer;
    this.moveToBottomHandler = params.moveToBottomHandler;
    this.moveToTopHandler = params.moveToTopHandler;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  public override onload(): void {
    super.onload();
    // Re-evaluate button availability whenever the user switches note (top/bottom/at-cursor validity
    // Depends on the active note) or moves the caret (at-cursor validity depends on the caret position).
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
      this.refreshButtons();
    }));
    this.registerAllDocumentsDomEvent({
      callback: () => {
        this.refreshButtons();
      },
      type: 'selectionchange'
    });
  }

  /**
   * Refreshes the enabled state of the notice buttons: each is enabled only while its move command can
   * run against the active editor. A no-op when nothing is marked (the notice is gone) — the stale
   * button references are then dropped. Call after marking a selection to seed the initial state.
   */
  public refreshButtons(): void {
    if (!this.moveSelectionBuffer.hasMark()) {
      // Nothing marked: the notice (if any) is being torn down, so drop the stale button references.
      this.buttons = null;
      return;
    }
    if (!this.buttons) {
      return;
    }
    for (const button of this.buttons) {
      if (button.getIsEnabled) {
        button.component.setDisabled(!button.getIsEnabled());
      }
    }
  }

  /**
   * Sets the handler backing the `Switch to split/extract` button. It is injected after construction to
   * break the construction cycle because the handler itself depends on this component.
   *
   * @param openSplitModalCommandHandler - The handler to back the button.
   */
  public setOpenSplitModalCommandHandler(openSplitModalCommandHandler: OpenSplitModalCommandHandler): void {
    this.openSplitModalCommandHandler = openSplitModalCommandHandler;
  }

  /**
   * Builds and shows the permanent marked-selection notice with its enabled buttons, returning the notice
   * so the caller can hide it when the mark is released. The three move buttons are controlled by the
   * `Smart cut & paste` settings; switching to split/extract and cancelling are always shown. When the
   * notice itself is disabled (`shouldShowSmartCutNotice` is off), nothing is shown and `null` is returned.
   *
   * @returns The shown notice, or `null` when the notice is disabled via settings.
   */
  public showNotice(): Notice | null {
    if (!this.pluginSettingsComponent.settings.shouldShowSmartCutNotice) {
      this.buttons = null;
      return null;
    }

    const buttons: MoveNoticeButton[] = [];
    const message = createFragment((f) => {
      f.appendText('Smart cut & paste: selection marked to move.');
      const buttonContainerEl = f.createDiv('advanced-note-composer-move-notice-buttons');
      for (const definition of this.getButtonDefinitions()) {
        const component = new ButtonComponent(buttonContainerEl)
          .setButtonText(definition.label)
          .onClick(() => {
            definition.onClick();
          });
        buttons.push({ component, getIsEnabled: definition.getIsEnabled });
      }
    });

    const notice = this.pluginNoticeComponent.showNotice(message, { isPermanent: true });
    this.buttons = buttons;
    return notice;
  }

  private getButtonDefinitions(): MoveNoticeButtonDefinition[] {
    const settings = this.pluginSettingsComponent.settings;
    const definitions: MoveNoticeButtonDefinition[] = [
      {
        getIsEnabled: null,
        label: 'Switch to split/extract',
        onClick: (): void => {
          invokeAsyncSafely(() => ensureNonNullable(this.openSplitModalCommandHandler).openSplitModal());
        }
      }
    ];

    if (settings.shouldShowMoveToTopButton) {
      definitions.push({
        getIsEnabled: () => this.moveToTopHandler.canExecuteInActiveEditor(),
        label: 'Move marked selection to top of file',
        onClick: (): void => {
          invokeAsyncSafely(() => this.moveToTopHandler.executeInActiveEditor());
        }
      });
    }

    if (settings.shouldShowMoveToBottomButton) {
      definitions.push({
        getIsEnabled: () => this.moveToBottomHandler.canExecuteInActiveEditor(),
        label: 'Move marked selection to bottom of file',
        onClick: (): void => {
          invokeAsyncSafely(() => this.moveToBottomHandler.executeInActiveEditor());
        }
      });
    }

    if (settings.shouldShowMoveAtCursorButton) {
      definitions.push({
        getIsEnabled: () => this.moveAtCursorHandler.canExecuteInActiveEditor(),
        label: 'Move marked selection at cursor',
        onClick: (): void => {
          invokeAsyncSafely(() => this.moveAtCursorHandler.executeInActiveEditor());
        }
      });
    }

    definitions.push({
      getIsEnabled: null,
      label: 'Cancel move',
      onClick: (): void => {
        this.cancelMoveCommandHandler.cancelMove();
      }
    });

    return definitions;
  }
}
