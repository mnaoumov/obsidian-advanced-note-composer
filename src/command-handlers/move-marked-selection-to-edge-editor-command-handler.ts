import type { App } from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { assertNever } from 'obsidian-dev-utils/type-guards';

import type { MoveSelectionBuffer } from '../move-selection-buffer.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { Insertion } from './move-marked-selection-editor-command-handler-base.ts';

import { InsertMode } from '../insert-mode.ts';
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

  protected override resolveInsertion(): Insertion {
    return {
      insertMode: this.insertMode,
      targetCursorEndOffset: null,
      targetCursorOffset: null
    };
  }
}

function getCommandDefinition(insertMode: InsertMode): CommandDefinition {
  switch (insertMode) {
    case InsertMode.Append:
      return {
        id: 'move-marked-selection-to-bottom-of-file',
        name: 'Smart cut & paste: Move marked selection to bottom of file'
      };
    case InsertMode.Prepend:
      return {
        id: 'move-marked-selection-to-top-of-file',
        name: 'Smart cut & paste: Move marked selection to top of file'
      };
    default:
      assertNever(insertMode);
  }
}
