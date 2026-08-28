import type {
  App,
  Editor,
  MarkdownFileInfo
} from 'obsidian';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { SelectionRange } from '../select-ranges.ts';

import {
  getHeadingContentSelection,
  resolveEnclosingHeadingInfo
} from '../select-ranges.ts';
import { SelectRangeEditorCommandHandlerBase } from './select-range-editor-command-handler-base.ts';

interface SelectThisHeadingContentEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Selects the heading's section WITHOUT its `#` line (issue #266).
 *
 * The one entry on the reporter's list with no counterpart anywhere in the plugin — he guessed as much
 * ("may not be present") — and the reason it is worth having is that the two are wanted for different
 * things: the heading line comes along when the section is being moved somewhere, and stays behind when
 * the body is being replaced or reformatted under a title that is not changing.
 *
 * Unavailable on a heading with no body, so it never selects nothing.
 */
export class SelectThisHeadingContentEditorCommandHandler extends SelectRangeEditorCommandHandlerBase {
  public constructor(params: SelectThisHeadingContentEditorCommandHandlerConstructorParams) {
    super({
      app: params.app,
      icon: 'lucide-text',
      id: 'select-this-heading-content',
      name: 'Select this heading\'s content',
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

    return getHeadingContentSelection({ editor, headingInfo });
  }
}
