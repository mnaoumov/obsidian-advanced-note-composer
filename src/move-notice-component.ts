import type {
  App,
  Notice,
  TFile
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { ButtonComponent } from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { AllWindowsEventComponent } from 'obsidian-dev-utils/obsidian/components/all-windows-event-component';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';

import type { ActiveEditorCommandHandlerBase } from './command-handlers/active-editor-command-handler-base.ts';
import type { CancelMoveCommandHandler } from './command-handlers/cancel-move-command-handler.ts';
import type { MoveMarkedSelectionEditorCommandHandlerBase } from './command-handlers/move-marked-selection-editor-command-handler-base.ts';
import type { OpenSplitModalCommandHandler } from './command-handlers/open-split-modal-command-handler.ts';
import type { SwapMarkedSelectionEditorCommandHandler } from './command-handlers/swap-marked-selection-editor-command-handler.ts';
import type {
  MarkedHeading,
  MoveSelectionBuffer
} from './move-selection-buffer.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import { hasReorderableSiblings } from './heading-sections.ts';
import { reopenMarkedSourceNote } from './marked-source-handoff.ts';

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

  /**
   * Backs the marked-heading notice's `Reorder headings...` action. Unregistered as a command here — the
   * notice drives it directly, exactly like {@link swapMarkedSelectionHandler}.
   */
  readonly reorderHeadingsHandler: ActiveEditorCommandHandlerBase;

  /**
   * Backs the marked-heading notice's `Split heading recursively...` action — the EXISTING recursive-split
   * command (issue #228), reused rather than reimplemented.
   */
  readonly splitHeadingRecursivelyHandler: ActiveEditorCommandHandlerBase;
  readonly swapMarkedSelectionHandler: SwapMarkedSelectionEditorCommandHandler;
}

/**
 * Parameters for {@link MoveNoticeComponent.showNotice}.
 */
export interface MoveNoticeComponentShowNoticeParams {
  /**
   * The heading being marked, or `null` for a plain selection mark. Passed in rather than read back from
   * {@link MoveSelectionBuffer}, because the notice is built BEFORE the mark is recorded there.
   */
  readonly markedHeading: MarkedHeading | null;

  /**
   * The note being marked, whose headings decide whether `Reorder headings...` has anything to reorder.
   */
  readonly sourceFile: TFile;
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
 * Owns the non-dismissable notice shown while a selection is marked for moving. The notice carries a
 * `Switch to split/extract` button, up to three configurable move buttons, a `Swap with selection`
 * button (swaps the marked selection with the active editor's current selection), and an always-shown
 * `Cancel move` button. Button state is refreshed whenever the active leaf or the editor selection changes.
 *
 * A mark made by `Mark heading to move` (issue #229) additionally offers `Split heading recursively...` and
 * `Reorder headings...` — both configurable, both driving the EXISTING command against the marked heading.
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
  private readonly reorderHeadingsHandler: ActiveEditorCommandHandlerBase;
  private readonly splitHeadingRecursivelyHandler: ActiveEditorCommandHandlerBase;
  private readonly swapMarkedSelectionHandler: SwapMarkedSelectionEditorCommandHandler;

  public constructor(params: MoveNoticeComponentConstructorParams) {
    super(params.app);
    this.cancelMoveCommandHandler = params.cancelMoveCommandHandler;
    this.moveAtCursorHandler = params.moveAtCursorHandler;
    this.moveSelectionBuffer = params.moveSelectionBuffer;
    this.moveToBottomHandler = params.moveToBottomHandler;
    this.moveToTopHandler = params.moveToTopHandler;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.reorderHeadingsHandler = params.reorderHeadingsHandler;
    this.splitHeadingRecursivelyHandler = params.splitHeadingRecursivelyHandler;
    this.swapMarkedSelectionHandler = params.swapMarkedSelectionHandler;
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
   * Builds and shows the non-dismissable marked-selection notice with its enabled buttons, returning the notice
   * so the caller can hide it when the mark is released. The three move buttons are controlled by the
   * `Smart cut & paste` settings; switching to split/extract and cancelling are always shown. When the
   * notice itself is disabled (`shouldShowSmartCutNotice` is off), nothing is shown and `null` is returned.
   *
   * @param params - The parameters.
   * @returns The shown notice, or `null` when the notice is disabled via settings.
   */
  public showNotice(params: MoveNoticeComponentShowNoticeParams): Notice | null {
    if (!this.pluginSettingsComponent.settings.shouldShowSmartCutNotice) {
      this.buttons = null;
      return null;
    }

    const buttons: MoveNoticeButton[] = [];
    const message = createFragment((f) => {
      f.appendText('Smart cut & paste: selection marked to move.');
      const buttonContainerEl = f.createDiv('advanced-note-composer-move-notice-buttons');
      for (const definition of this.getButtonDefinitions(params.markedHeading, params.sourceFile)) {
        const component = new ButtonComponent(buttonContainerEl)
          .setButtonText(definition.label)
          .onClick(() => {
            definition.onClick();
          });
        buttons.push({ component, getIsEnabled: definition.getIsEnabled });
      }
    });

    // No `isPermanent`: `shouldHideOnClick: false` already gives the notice an infinite duration and puts
    // It in `PluginNoticeMode.Separate`, so no later notice can replace it — and dev-utils 93 throws on the
    // Combination, since a permanent notice needs the shared slot that a separate one deliberately avoids.
    // Permanence would be wrong here anyway: it outlives the plugin, while the mark this notice reports
    // Dies with it.
    const notice = this.pluginNoticeComponent.showNotice(message, {
      shouldHideOnClick: false,
      shouldShowCloseButton: false
    });
    this.buttons = buttons;
    return notice;
  }

  /**
   * Builds the notice's button definitions. Takes the heading and note positionally rather than as a params
   * bag, because a bag shared with {@link showNotice} would have to be named after each of them
   * (`obsidian-dev-utils/params-options-name-match`).
   *
   * @param markedHeading - The heading being marked, or `null` for a plain selection mark.
   * @param sourceFile - The note being marked.
   * @returns The button definitions, in the order they are shown.
   */
  private getButtonDefinitions(markedHeading: MarkedHeading | null, sourceFile: TFile): MoveNoticeButtonDefinition[] {
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

    /*
     * The two heading-only actions (issue #229): offered only for a mark made by `Mark heading to move`,
     * because both act on a HEADING, which a plain selection mark does not have. Each hands the note over to
     * the existing command — see `runOnMarkedHeading`.
     */
    if (markedHeading) {
      if (settings.shouldShowSplitHeadingRecursivelyButton) {
        definitions.push({
          // A leaf heading is deliberately still offered: it produces `X/X.md`, exactly what the command
          // Does at a leaf when driven from the menu.
          getIsEnabled: null,
          label: 'Split heading recursively...',
          onClick: (): void => {
            invokeAsyncSafely(() => this.runOnMarkedHeading(this.splitHeadingRecursivelyHandler));
          }
        });
      }
      if (settings.shouldShowReorderHeadingsButton) {
        definitions.push({
          // Enablement is read off the MARKED note, not the active editor (unlike the move buttons): this
          // Button acts on the source note wherever the user happens to be.
          getIsEnabled: () => hasReorderableSiblings(this.app.metadataCache.getFileCache(sourceFile)?.headings ?? []),
          label: 'Reorder headings...',
          onClick: (): void => {
            invokeAsyncSafely(() => this.runOnMarkedHeading(this.reorderHeadingsHandler));
          }
        });
      }
    }

    definitions.push({
      getIsEnabled: () => this.swapMarkedSelectionHandler.canExecuteInActiveEditor(),
      label: 'Swap with selection',
      onClick: (): void => {
        invokeAsyncSafely(() => this.swapMarkedSelectionHandler.executeInActiveEditor());
      }
    }, {
      getIsEnabled: null,
      label: 'Cancel move',
      onClick: (): void => {
        this.cancelMoveCommandHandler.cancelMove();
      }
    });

    return definitions;
  }

  /**
   * Runs one of the heading-only actions against the marked heading: releases the mark (the operation writes
   * to the note the mark keeps mutation-blocked), re-opens the source note, puts the cursor on the marked
   * heading — which is how the existing cursor-driven commands learn WHICH heading to act on — and runs the
   * handler. A no-op when the mark is not a heading mark or its note is gone.
   *
   * @param handler - The command handler to run against the marked heading.
   */
  private async runOnMarkedHeading(handler: ActiveEditorCommandHandlerBase): Promise<void> {
    const markedHeading = this.moveSelectionBuffer.get()?.markedHeading;
    if (!markedHeading) {
      return;
    }

    const view = await reopenMarkedSourceNote({
      app: this.app,
      moveSelectionBuffer: this.moveSelectionBuffer,
      pluginNoticeComponent: this.pluginNoticeComponent
    });
    if (!view) {
      return;
    }

    view.editor.setCursor({ ch: 0, line: markedHeading.line });
    await handler.executeInActiveEditor();
  }
}
