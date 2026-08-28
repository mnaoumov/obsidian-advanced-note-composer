import type {
  App,
  Editor,
  MarkdownFileInfo
} from 'obsidian';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { SelectionRange } from '../select-ranges.ts';

import { getSelectionBetweenHorizontalRules } from '../horizontal-rules.ts';
import { SelectRangeEditorCommandHandlerBase } from './select-range-editor-command-handler-base.ts';

interface SelectBetweenHorizontalRulesEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Selects the block between the horizontal rules closest to the cursor (issue #266) — the range
 * `Extract between horizontal rules...` computes, with the bounding rules themselves left out.
 *
 * Unavailable in a note with no horizontal rules, exactly as the extract is.
 */
export class SelectBetweenHorizontalRulesEditorCommandHandler extends SelectRangeEditorCommandHandlerBase {
  public constructor(params: SelectBetweenHorizontalRulesEditorCommandHandlerConstructorParams) {
    super({
      app: params.app,
      icon: 'lucide-separator-horizontal',
      id: 'select-between-horizontal-rules',
      name: 'Select between horizontal rules',
      pluginSettingsComponent: params.pluginSettingsComponent
    });
  }

  protected override resolveRange(editor: Editor, context: MarkdownFileInfo): null | SelectionRange {
    const file = context.file;
    if (!file) {
      return null;
    }

    return getSelectionBetweenHorizontalRules({
      app: this.app,
      editor,
      file,
      lineNumber: editor.getCursor().line
    });
  }
}
