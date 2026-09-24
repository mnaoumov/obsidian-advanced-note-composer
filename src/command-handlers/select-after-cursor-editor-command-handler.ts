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
 * **A live selection is RESUMED, not dropped (issue #287).** The range starts at the selection's `from`
 * end rather than at the caret, so a selection interrupted part-way — a horizontal rule breaking a drag, a
 * handle that let go too early — is grown to the end of the note instead of being thrown away for a fresh
 * one starting where it stopped. With nothing selected `from` IS the caret, so that case is unchanged.
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
    const start = editor.getCursor('from');
    if (start.line === end.line && start.ch === end.ch) {
      return null;
    }

    return {
      end,
      start
    };
  }
}
