import type {
  App,
  Editor
} from 'obsidian';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { SelectionRange } from '../select-ranges.ts';

import { SelectRangeEditorCommandHandlerBase } from './select-range-editor-command-handler-base.ts';

interface SelectBeforeCursorEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Selects everything from the top of the note down to the cursor (issue #266) — the selection
 * `Extract before cursor...` makes before opening its split modal.
 *
 * **A live selection is RESUMED, not dropped (issue #287)** — the mirror of `Select after cursor`: the
 * range ends at the selection's `to` end rather than at the caret, so an interrupted selection is grown
 * to the top of the note. With nothing selected `to` IS the caret, so that case is unchanged.
 *
 * Unavailable with the cursor already at the very top, where there is nothing above it to select.
 */
export class SelectBeforeCursorEditorCommandHandler extends SelectRangeEditorCommandHandlerBase {
  public constructor(params: SelectBeforeCursorEditorCommandHandlerConstructorParams) {
    super({
      app: params.app,
      icon: 'lucide-arrow-up-from-line',
      id: 'select-before-cursor',
      name: 'Select before cursor',
      pluginSettingsComponent: params.pluginSettingsComponent
    });
  }

  protected override resolveRange(editor: Editor): null | SelectionRange {
    const end = editor.getCursor('to');
    const start = {
      ch: 0,
      line: 0
    };
    if (end.line === start.line && end.ch === start.ch) {
      return null;
    }

    return {
      end,
      start
    };
  }
}
