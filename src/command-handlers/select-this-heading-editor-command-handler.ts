import type {
  App,
  Editor,
  MarkdownFileInfo
} from 'obsidian';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { SelectionRange } from '../select-ranges.ts';

import { resolveEnclosingHeadingInfo } from '../select-ranges.ts';
import { SelectRangeEditorCommandHandlerBase } from './select-range-editor-command-handler-base.ts';

interface SelectThisHeadingEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Selects the heading the cursor is under, its body and everything nested below it (issue #266).
 *
 * Exactly the selection `Extract this heading...` makes before opening its split modal — which is how the
 * reporter was getting it, by running the extract and then CANCELLING the modal. This is that selection
 * without the modal.
 */
export class SelectThisHeadingEditorCommandHandler extends SelectRangeEditorCommandHandlerBase {
  public constructor(params: SelectThisHeadingEditorCommandHandlerConstructorParams) {
    super({
      app: params.app,
      icon: 'lucide-heading',
      id: 'select-this-heading',
      name: 'Select this heading',
      pluginSettingsComponent: params.pluginSettingsComponent
    });
  }

  protected override resolveRange(editor: Editor, context: MarkdownFileInfo): null | SelectionRange {
    const file = context.file;
    if (!file) {
      return null;
    }

    const headingInfo = resolveEnclosingHeadingInfo({ app: this.app, editor, file });
    if (!headingInfo) {
      return null;
    }

    return {
      end: headingInfo.end,
      start: headingInfo.start
    };
  }
}
