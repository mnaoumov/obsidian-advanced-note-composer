import type {
  App,
  Editor,
  MarkdownFileInfo
} from 'obsidian';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { SelectionRange } from '../select-ranges.ts';
import type { SelectionAnchorComponent } from '../selection-anchor-component.ts';

import { normalizeSelectionRange } from '../select-ranges.ts';
import { SelectRangeEditorCommandHandlerBase } from './select-range-editor-command-handler-base.ts';

interface EndSelectionEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly selectionAnchorComponent: SelectionAnchorComponent;
}

/**
 * Selects from the anchor `Selection anchor: Start selection` set to the cursor, then drops the anchor
 * (issue #266).
 *
 * Unavailable until an anchor is set in this note, so on a phone it stays out of the command palette —
 * and off any toolbar filtering by availability — until it can actually do something.
 */
export class EndSelectionEditorCommandHandler extends SelectRangeEditorCommandHandlerBase {
  private readonly selectionAnchorComponent: SelectionAnchorComponent;

  public constructor(params: EndSelectionEditorCommandHandlerConstructorParams) {
    super({
      app: params.app,
      icon: 'lucide-text-select',
      id: 'end-selection',
      name: 'Selection anchor: End selection',
      pluginSettingsComponent: params.pluginSettingsComponent
    });

    this.selectionAnchorComponent = params.selectionAnchorComponent;
  }

  /**
   * Answered from the anchored NOTE rather than by resolving the range, so availability costs no trip
   * into CodeMirror — and so an anchor set in another note can never enable the command here.
   *
   * @param _editor - The editor instance.
   * @param context - The markdown file context.
   * @returns Whether this note holds the anchor.
   */
  protected override canSelect(_editor: Editor, context: MarkdownFileInfo): boolean {
    return this.selectionAnchorComponent.hasAnchor(context.file);
  }

  protected override executeEditor(editor: Editor, context: MarkdownFileInfo): void {
    super.executeEditor(editor, context);
    // The anchor is consumed either way: it named one end of a selection that has now been made, and
    // Leaving it armed would make the next `End selection` reach back to a point the user is done with.
    this.selectionAnchorComponent.clearAnchor();
  }

  protected override resolveRange(editor: Editor): null | SelectionRange {
    const anchorOffset = this.selectionAnchorComponent.getAnchorOffset(editor);
    if (anchorOffset === null) {
      return null;
    }

    const normalized = normalizeSelectionRange(anchorOffset, editor.posToOffset(editor.getCursor()));
    return {
      end: editor.offsetToPos(normalized.toOffset),
      start: editor.offsetToPos(normalized.fromOffset)
    };
  }
}
