import type {
  Editor,
  MarkdownFileInfo
} from 'obsidian';

import type { SelectionRange } from '../select-ranges.ts';

import { SelectEditorCommandHandlerBase } from './select-editor-command-handler-base.ts';

/**
 * Shared base for the select commands that compute a RANGE and select it (issue #266) — the five
 * per-shape selects plus `Selection anchor: End selection`.
 *
 * Each subclass supplies nothing but {@link resolveRange}; availability and the selection itself are both
 * derived from it here. That is the whole of what a select command is: an `Extract ...` handler's opening
 * `editor.setSelection` with the `prepareForSplitFile` / `SplitComposer` tail cut off.
 *
 * The range is resolved AGAIN in `executeEditor` rather than cached from `canSelect`, unlike the extract
 * handlers (which stash a `headingInfo` / `range` field between the two calls). Resolving is cheap, and a
 * cached range is a stale range waiting to happen — the resolvers read the metadata cache and the live
 * document, both of which can move between Obsidian's availability check and the invocation.
 */
export abstract class SelectRangeEditorCommandHandlerBase extends SelectEditorCommandHandlerBase {
  protected override canSelect(editor: Editor, context: MarkdownFileInfo): boolean {
    return !!this.resolveRange(editor, context);
  }

  protected override executeEditor(editor: Editor, context: MarkdownFileInfo): void {
    const range = this.resolveRange(editor, context);
    if (!range) {
      return;
    }

    editor.setSelection(range.start, range.end);
  }

  /**
   * Resolves the range this command selects.
   *
   * @param editor - The editor instance.
   * @param context - The markdown file context.
   * @returns The range, or `null` when the command has nothing to select here.
   */
  protected abstract resolveRange(editor: Editor, context: MarkdownFileInfo): null | SelectionRange;
}
