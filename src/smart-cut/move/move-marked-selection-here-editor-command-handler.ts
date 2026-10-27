import type { ConsoleDebugComponent } from '@mnaoumov/obsidian-lib/components/console-debug-component';
import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type { ResourceLockComponent } from '@mnaoumov/obsidian-lib/resource-lock';
import type {
  App,
  Editor
} from 'obsidian';

import type { PluginSettingsComponent } from '../../settings/plugin-settings-component.ts';
import type { TextAfterExtractionMode } from '../../settings/plugin-settings.ts';
import type { MoveSelectionBuffer } from '../mark/move-selection-buffer.ts';
import type { Insertion } from './move-marked-selection-editor-command-handler-base.ts';
import type { MoveOptions } from './paste-options-modal.ts';

import { InsertMode } from '../../composers/insert-mode.ts';
import { SmartCutAndPasteMoveKind } from '../../settings/plugin-settings.ts';
import { MoveMarkedSelectionEditorCommandHandlerBase } from './move-marked-selection-editor-command-handler-base.ts';
import { openPasteOptionsModal } from './paste-options-modal.ts';

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
      name: params.isAdvanced ? 'Smart cut & paste: Move marked selection here (advanced)...' : 'Smart cut & paste: Move marked selection here'
    });
    this.isAdvanced = params.isAdvanced;
  }

  /**
   * Both registrations (plain and advanced) and the notice's `Move marked selection at cursor` button all
   * land here, and they are all the same move as far as templating goes.
   *
   * @returns The move kind.
   */
  protected override getSmartCutAndPasteMoveKind(): SmartCutAndPasteMoveKind {
    return SmartCutAndPasteMoveKind.AtCursor;
  }

  protected override resolveInsertion(editor: Editor): Insertion {
    // Paste semantics: when the target has an active selection, the moved content replaces it (the
    // `[from, to]` range); with no selection, `from === to` collapses to a plain insertion at the caret.
    const from = editor.posToOffset(editor.getCursor('from'));
    const to = editor.posToOffset(editor.getCursor('to'));
    return {
      insertMode: InsertMode.Append,
      targetCursorEndOffset: to,
      targetCursorOffset: from
    };
  }

  protected override async resolveOptions(defaultTextAfterExtractionMode: TextAfterExtractionMode): Promise<MoveOptions | null> {
    const defaultOptions = this.buildDefaultOptions(defaultTextAfterExtractionMode);
    return this.isAdvanced ? (await openPasteOptionsModal({ app: this.app, defaultOptions })) : defaultOptions;
  }
}
