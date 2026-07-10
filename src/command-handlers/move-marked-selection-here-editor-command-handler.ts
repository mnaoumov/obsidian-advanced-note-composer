import type {
  App,
  Editor
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import type { MoveOptions } from '../modals/paste-options-modal.ts';
import type { MoveSelectionBuffer } from '../move-selection-buffer.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { TextAfterExtractionMode } from '../plugin-settings.ts';
import type { Insertion } from './move-marked-selection-editor-command-handler-base.ts';

import { InsertMode } from '../insert-mode.ts';
import { openPasteOptionsModal } from '../modals/paste-options-modal.ts';
import { MoveMarkedSelectionEditorCommandHandlerBase } from './move-marked-selection-editor-command-handler-base.ts';

interface MoveMarkedSelectionHereEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;

  /**
   * When `true`, the command prompts for content-processing options before moving; when `false`, it
   * uses the plugin's default settings without any UI.
   */
  readonly isAdvanced: boolean;
  readonly moveSelectionBuffer: MoveSelectionBuffer;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

/**
 * Moves the marked selection to the current cursor position of the active note.
 */
export class MoveMarkedSelectionHereEditorCommandHandler extends MoveMarkedSelectionEditorCommandHandlerBase {
  private readonly isAdvanced: boolean;

  public constructor(params: MoveMarkedSelectionHereEditorCommandHandlerConstructorParams) {
    super({
      ...params,
      id: params.isAdvanced ? 'move-marked-selection-here-advanced' : 'move-marked-selection-here',
      name: params.isAdvanced ? 'Move marked selection here (advanced)...' : 'Move marked selection here'
    });
    this.isAdvanced = params.isAdvanced;
  }

  protected override resolveInsertion(editor: Editor): Insertion {
    return {
      insertMode: InsertMode.Append,
      targetCursorOffset: editor.posToOffset(editor.getCursor())
    };
  }

  protected override async resolveOptions(defaultTextAfterExtractionMode: TextAfterExtractionMode): Promise<MoveOptions | null> {
    const defaultOptions = this.buildDefaultOptions(defaultTextAfterExtractionMode);
    if (!this.isAdvanced) {
      return defaultOptions;
    }
    return await openPasteOptionsModal({ app: this.app, defaultOptions });
  }
}
