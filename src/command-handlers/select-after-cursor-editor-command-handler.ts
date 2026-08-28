import type {
  App,
  Editor
} from 'obsidian';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { SelectionRange } from '../select-ranges.ts';

import { SelectRangeEditorCommandHandlerBase } from './select-range-editor-command-handler-base.ts';

interface SelectAfterCursorEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Selects everything from the cursor down to the end of the note (issue #266) — the same range
 * `Extract after cursor...` takes.
 *
 * The extract anchors that selection at the note's END and puts its head at the cursor; this one runs
 * start-to-end instead, so the selection grows the way it reads and the handle a phone offers to adjust
 * it sits at the end the user is more likely to want to move.
 *
 * Unavailable with the cursor already at the very end.
 */
export class SelectAfterCursorEditorCommandHandler extends SelectRangeEditorCommandHandlerBase {
  public constructor(params: SelectAfterCursorEditorCommandHandlerConstructorParams) {
    super({
      app: params.app,
      icon: 'lucide-arrow-down-from-line',
      id: 'select-after-cursor',
      name: 'Select after cursor',
      pluginSettingsComponent: params.pluginSettingsComponent
    });
  }

  protected override resolveRange(editor: Editor): null | SelectionRange {
    const lastLine = editor.lastLine();
    const end = {
      ch: editor.getLine(lastLine).length,
      line: lastLine
    };
    const cursor = editor.getCursor();
    if (cursor.line === end.line && cursor.ch === end.ch) {
      return null;
    }

    return {
      end,
      start: cursor
    };
  }
}
