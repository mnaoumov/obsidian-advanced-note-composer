import type { ConsoleDebugComponent } from '@mnaoumov/obsidian-lib/components/console-debug-component';
import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type { ResourceLockComponent } from '@mnaoumov/obsidian-lib/resource-lock';
import type { App } from 'obsidian';

import { assertNever } from '@mnaoumov/typescript-lib/type-guards';

import type { PluginSettingsComponent } from '../../settings/plugin-settings-component.ts';
import type { MoveSelectionBuffer } from '../mark/move-selection-buffer.ts';
import type { Insertion } from './move-marked-selection-editor-command-handler-base.ts';

import { InsertMode } from '../../composers/insert-mode.ts';
import { SmartCutAndPasteMoveKind } from '../../settings/plugin-settings.ts';
import { MoveMarkedSelectionEditorCommandHandlerBase } from './move-marked-selection-editor-command-handler-base.ts';

interface CommandDefinition {
  readonly id: string;
  readonly name: string;
}

interface MoveMarkedSelectionToEdgeEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;

  /**
   * Whether the marked selection moves to the bottom ({@link InsertMode.Append}) or the top
   * ({@link InsertMode.Prepend}) of the active note.
   */
  readonly insertMode: InsertMode;
  readonly moveSelectionBuffer: MoveSelectionBuffer;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

/**
 * Moves the marked selection to the top or bottom of the active note (the same note as the source, or
 * a different one). Registered once per {@link InsertMode}; ships no default hotkeys so users can bind
 * their own (e.g. `Enter` / `Shift+Enter`).
 */
export class MoveMarkedSelectionToEdgeEditorCommandHandler extends MoveMarkedSelectionEditorCommandHandlerBase {
  private readonly insertMode: InsertMode;

  public constructor(params: MoveMarkedSelectionToEdgeEditorCommandHandlerConstructorParams) {
    super({
      ...params,
      ...getCommandDefinition(params.insertMode)
    });
    this.insertMode = params.insertMode;
  }

  /**
   * Each direction is its own move for templating, so each can carry its own template override
   * (issue #174).
   *
   * @returns The move kind.
   */
  protected override getSmartCutAndPasteMoveKind(): SmartCutAndPasteMoveKind {
    // No exhaustiveness check here: the constructor already rejected any other mode, so a `default`
    // branch would be unreachable.
    return this.insertMode === InsertMode.Prepend
      ? SmartCutAndPasteMoveKind.ToTop
      : SmartCutAndPasteMoveKind.ToBottom;
  }

  protected override resolveInsertion(): Insertion {
    return {
      insertMode: this.insertMode,
      targetCursorEndOffset: null,
      targetCursorOffset: null
    };
  }

  /**
   * Unlike a move at the cursor, a move to an edge can be a "get it out of the way" move, where
   * following the content costs the user their place — so each direction has its own setting
   * (issue #144). Both default on, preserving the 5.0.0 behavior.
   *
   * @returns Whether to jump to the moved content.
   */
  protected override shouldJumpToMovedContent(): boolean {
    const settings = this.pluginSettingsComponent.settings;
    // No exhaustiveness check here: the constructor already rejected any other mode, so a `default`
    // branch would be unreachable.
    return this.insertMode === InsertMode.Prepend
      ? settings.shouldJumpToMovedContentToTop
      : settings.shouldJumpToMovedContentToBottom;
  }
}

function getCommandDefinition(insertMode: InsertMode): CommandDefinition {
  switch (insertMode) {
    case InsertMode.Append: {
      return {
        id: 'move-marked-selection-to-bottom-of-file',
        name: 'Smart cut & paste: Move marked selection to bottom of file'
      };
    }
    case InsertMode.Prepend: {
      return {
        id: 'move-marked-selection-to-top-of-file',
        name: 'Smart cut & paste: Move marked selection to top of file'
      };
    }
    default: {
      assertNever(insertMode);
    }
  }
}
