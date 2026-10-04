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
 * With no anchor set it selects from where the most recent selection in this editor BEGAN (issue #305).
 * A selection interrupted part-way is then finished with one command: tap where it should end, run this.
 * Before #305 that took `Start selection` first, run while the partial selection was still live. An
 * explicit anchor wins over the remembered start, because the user placed it on purpose.
 *
 * Unavailable when neither exists, so on a phone it stays out of the command palette — and off any
 * toolbar filtering by availability — until it can actually do something.
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
   * The explicit anchor is answered from the anchored NOTE, so an anchor set in another note can never
   * enable the command here. Only without one is the editor asked for a remembered selection start.
   *
   * @param editor - The editor instance.
   * @param context - The markdown file context.
   * @returns Whether there is a point to select from.
   */
  protected override canSelect(editor: Editor, context: MarkdownFileInfo): boolean {
    return this.selectionAnchorComponent.hasAnchor(context.file)
      || this.selectionAnchorComponent.getLastSelectionStartOffset(editor) !== null;
  }

  protected override executeEditor(editor: Editor, context: MarkdownFileInfo): void {
    super.executeEditor(editor, context);
    // The anchor is consumed either way: it named one end of a selection that has now been made, and
    // leaving it armed would make the next `End selection` reach back to a point the user is done with.
    this.selectionAnchorComponent.clearAnchor();
  }

  protected override resolveRange(editor: Editor, context: MarkdownFileInfo): null | SelectionRange {
    const explicitAnchorOffset = this.selectionAnchorComponent.hasAnchor(context.file)
      ? this.selectionAnchorComponent.getAnchorOffset(editor)
      : null;
    const anchorOffset = explicitAnchorOffset ?? this.selectionAnchorComponent.getLastSelectionStartOffset(editor);
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
