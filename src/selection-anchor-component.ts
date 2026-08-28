import type {
  EditorState,
  Extension
} from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import type {
  App,
  Editor,
  TFile,
  WorkspaceLeaf
} from 'obsidian';

import {
  StateEffect,
  StateField
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  WidgetType
} from '@codemirror/view';
import { MarkdownView } from 'obsidian';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { ComponentEx } from 'obsidian-dev-utils/obsidian/components/component-ex';

const ANCHOR_CLASS = 'advanced-note-composer-selection-anchor';

/**
 * Parameters for creating a {@link SelectionAnchorComponent}.
 */
export interface SelectionAnchorComponentConstructorParams {
  readonly app: App;
}

/**
 * The effect that replaces an editor's selection anchor.
 */
export const replaceSelectionAnchorEffect = StateEffect.define<DecorationSet>();

/**
 * The editor extension that stores and renders the pending selection anchor. Register once via
 * `plugin.registerEditorExtension`.
 *
 * **The anchor is a `StateField`, not a number the plugin keeps beside the editor, and that is the whole
 * point of this module.** `Selection anchor: Start selection` and `End selection` are two separate user
 * actions with arbitrary editing in between — the user is expected to keep typing between them, which is
 * exactly what makes this feature lighter than a smart-cut mark (no lock, no permanent notice). A raw
 * offset held outside the document drifts the moment a character is inserted above it, and the user
 * silently selects the wrong text. Mapping through `tr.changes` is what stops that, and it is the same
 * mechanism `selectionHighlightField` uses.
 *
 * The map runs BEFORE the effects, so an effect dispatched in the same transaction as a change carries a
 * position in the NEW document rather than being mapped a second time.
 */
export const selectionAnchorField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  provide(field) {
    return EditorView.decorations.from(field);
  },
  update(anchor, tr) {
    anchor = anchor.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(replaceSelectionAnchorEffect)) {
        anchor = effect.value;
      }
    }
    return anchor;
  }
});

/**
 * The marker rendered at the anchored position (issue #266).
 *
 * A WIDGET decoration rather than the mark decoration `SelectionHighlightComponent` uses, because an
 * anchor is a POINT: a mark over a zero-length range renders nothing at all, which is why
 * `computeHighlightRangesForFile` drops empty ranges outright (`if (from < to)`) and why that component
 * cannot be reused here. Without a widget the user has no way to tell an armed anchor from an unarmed
 * one — on a phone, where this feature is aimed, that is the difference between the feature working and
 * appearing to do nothing.
 */
class SelectionAnchorWidget extends WidgetType {
  /**
   * Every anchor marker looks the same, so CodeMirror never needs to replace one already in the DOM.
   *
   * @returns Always `true`.
   */
  public override eq(): boolean {
    return true;
  }

  /**
   * Builds the marker element.
   *
   * @returns The marker element.
   */
  public override toDOM(): HTMLElement {
    return createSpan({ cls: ANCHOR_CLASS });
  }
}

/**
 * Holds the transient (non-persisted) selection anchor set by `Selection anchor: Start selection`, until
 * `End selection` turns it into a selection or `Cancel selection` drops it (issue #266).
 *
 * Deliberately far lighter than {@link import('./move-selection-buffer.ts').MoveSelectionBuffer}: a
 * pending MOVE holds a source-note lock, a permanent notice and staleness guards because the text must not
 * change under it, while a pending ANCHOR expects the opposite — the user goes on editing between the two
 * commands.
 *
 * **At most one anchor exists at a time, across every open editor.** The offset itself lives in each
 * editor's {@link selectionAnchorField}, which is per-`EditorView`; this component owns the single
 * `anchoredPath` that says which note it belongs to, so a second `Start selection` in another pane
 * replaces the first rather than leaving a stray marker behind.
 */
export class SelectionAnchorComponent extends ComponentEx {
  private anchoredPath: null | string = null;
  private readonly app: App;

  public constructor(params: SelectionAnchorComponentConstructorParams) {
    super();
    this.app = params.app;
  }

  /**
   * Drops the anchor, removing its marker from every editor. A no-op when nothing is anchored.
   */
  public clearAnchor(): void {
    if (this.anchoredPath === null) {
      return;
    }
    this.anchoredPath = null;
    this.clearAnchorDecorations();
  }

  /**
   * Reads the anchored offset out of the given editor.
   *
   * @param editor - The editor to read the anchor from.
   * @returns The anchored offset, or `null` when this editor holds no anchor.
   */
  public getAnchorOffset(editor: Editor): null | number {
    /*
     * `obsidian-typings` declares `editor.cm` against `@codemirror/state` imported with a
     * `resolution-mode` attribute, so its `EditorState` is a SECOND declaration of the same class — and
     * `SelectionRange`'s private `flags` makes the two mutually unassignable. It is the same class at
     * runtime (Obsidian's own CodeMirror instance, which the build leaves external), so the cast is a
     * type-level identity, not a claim about the value.
     */
    return getSelectionAnchorOffset(castTo<EditorState>(editor.cm.state));
  }

  /**
   * The editor extension backing the anchor. Register it once with `plugin.registerEditorExtension`.
   *
   * @returns The editor extension.
   */
  public getEditorExtension(): Extension {
    return selectionAnchorField;
  }

  /**
   * Checks whether an anchor is set in the given note.
   *
   * Answered from {@link anchoredPath} rather than from the editor's state, so `canExecuteEditor` can gate
   * `End selection` / `Cancel selection` without reaching into CodeMirror — and so an anchor set in
   * another note never enables them here.
   *
   * @param file - The note to check.
   * @returns Whether that note holds the anchor.
   */
  public hasAnchor(file: null | TFile): boolean {
    return !!file && this.anchoredPath === file.path;
  }

  public override onload(): void {
    super.onload();
    /*
     * The anchor lives only as long as the user stays in the note it was set in. Obsidian reuses one
     * `EditorView` per leaf across file switches, so an anchor left behind would map into a DIFFERENT
     * document and select text the user never pointed at. Navigating away is not part of the
     * start-move-end flow anyway, so dropping it is both safe and the easier rule to hold in your head.
     */
    this.registerEvent(this.app.workspace.on('file-open', (file) => {
      if (this.anchoredPath !== null && file?.path !== this.anchoredPath) {
        this.clearAnchor();
      }
    }));
  }

  public override onunload(): void {
    this.clearAnchor();
    super.onunload();
  }

  /**
   * Anchors at the given editor's cursor, replacing any anchor held anywhere else.
   *
   * @param editor - The editor to anchor in.
   * @param file - The note that editor shows.
   */
  public setAnchor(editor: Editor, file: TFile): void {
    // Clear FIRST, and across every editor: at most one anchor exists at a time, so a second
    // `Start selection` in another pane must not leave the first pane's marker behind.
    this.clearAnchorDecorations();
    this.anchoredPath = file.path;
    const editorView = editor.cm;
    editorView.dispatch({
      effects: replaceSelectionAnchorEffect.of(buildSelectionAnchorDecorations(editorView.state.selection.main.head))
    });
  }

  /**
   * Removes the anchor marker from every markdown editor.
   */
  private clearAnchorDecorations(): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      this.dispatchAnchorDecorations(leaf, null);
    });
  }

  /* v8 ignore start -- Requires a real CodeMirror EditorView (leaf.view.editor.cm) + dispatch; verified via integration. */
  private dispatchAnchorDecorations(leaf: WorkspaceLeaf, offset: null | number): void {
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) {
      return;
    }
    view.editor.cm.dispatch({ effects: replaceSelectionAnchorEffect.of(buildSelectionAnchorDecorations(offset)) });
  }
  /* v8 ignore stop */
}

/**
 * Builds the decoration set holding the anchor marker.
 *
 * @param offset - The anchored offset, or `null` for no anchor.
 * @returns The decoration set — one widget, or none.
 */
export function buildSelectionAnchorDecorations(offset: null | number): DecorationSet {
  if (offset === null) {
    return Decoration.none;
  }

  /*
   * `side: -1` sorts the marker before whatever sits at that offset, so text typed AT the anchor lands
   * after it and ends up INSIDE the range `End selection` will make. Extending the region is what typing
   * there means; pushing the anchor along ahead of the new text would silently exclude it.
   */
  return Decoration.set([
    Decoration.widget({
      side: -1,
      widget: new SelectionAnchorWidget()
    }).range(offset)
  ]);
}

/**
 * Reads the anchored offset out of an editor state.
 *
 * @param state - The editor state.
 * @returns The anchored offset, or `null` when the state holds no anchor.
 */
export function getSelectionAnchorOffset(state: EditorState): null | number {
  const anchor = state.field(selectionAnchorField, false);
  if (!anchor) {
    return null;
  }

  const iterator = anchor.iter();
  return iterator.value ? iterator.from : null;
}
