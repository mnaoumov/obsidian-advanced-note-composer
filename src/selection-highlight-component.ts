import type { Extension } from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import type {
  App,
  TFile,
  WorkspaceLeaf
} from 'obsidian';

import {
  StateEffect,
  StateField
} from '@codemirror/state';
import {
  Decoration,
  EditorView
} from '@codemirror/view';
import {
  Component,
  MarkdownView
} from 'obsidian';

import type { Selection } from './composers/composer-base.ts';

const HIGHLIGHT_CLASS = 'advanced-note-composer-pending-selection';

/**
 * A resolved highlight range in a note (document offsets).
 */
export interface HighlightRange {
  readonly from: number;
  readonly to: number;
}

/**
 * Parameters for creating a {@link SelectionHighlightComponent}.
 */
export interface SelectionHighlightComponentConstructorParams {
  readonly app: App;
}

/**
 * A registered highlight: the captured selection ranges of a pending operation in a source note.
 */
interface Highlight {
  readonly file: TFile;
  readonly ranges: Selection[];
}

/**
 * The effect that replaces the pending-selection highlights of a single editor.
 */
export const setSelectionHighlightsEffect = StateEffect.define<DecorationSet>();

/**
 * The editor extension that stores and renders the pending-selection highlights. Register once via
 * `plugin.registerEditorExtension`; {@link SelectionHighlightComponent.refresh} dispatches
 * {@link setSelectionHighlightsEffect} to update each editor.
 */
export const selectionHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  provide(field) {
    return EditorView.decorations.from(field);
  },
  update(highlights, tr) {
    highlights = highlights.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setSelectionHighlightsEffect)) {
        highlights = effect.value;
      }
    }
    return highlights;
  }
});

/**
 * Renders a persistent highlight over the captured selection of a pending operation (a smart-cut mark, or
 * a split/extract setup) in its source note, in every editor showing that note, until the operation
 * completes or is cancelled. Register the extension via `plugin.registerEditorExtension`, then call
 * {@link addHighlight} for the duration of the operation.
 */
export class SelectionHighlightComponent extends Component {
  private readonly app: App;
  private readonly highlights = new Map<symbol, Highlight>();

  public constructor(params: SelectionHighlightComponentConstructorParams) {
    super();
    this.app = params.app;
  }

  /**
   * Registers a highlight over the given ranges in the given file, shown until the returned
   * {@link Disposable} is disposed.
   *
   * @param file - The source note to highlight in.
   * @param ranges - The captured selection ranges to highlight.
   * @returns A {@link Disposable} that removes the highlight when disposed.
   */
  public addHighlight(file: TFile, ranges: Selection[]): Disposable {
    const key = Symbol('highlight');
    this.highlights.set(key, { file, ranges });
    this.refresh();
    return {
      [Symbol.dispose]: (): void => {
        this.highlights.delete(key);
        this.refresh();
      }
    };
  }

  /**
   * The editor extension backing the highlights. Register it once with `plugin.registerEditorExtension`.
   *
   * @returns The editor extension.
   */
  public getEditorExtension(): Extension {
    return selectionHighlightField;
  }

  public override onload(): void {
    super.onload();
    // A newly revealed editor (a split, or a re-opened source note) needs the current highlights.
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
      this.refresh();
    }));
  }

  /**
   * Re-applies the current highlights to every markdown editor.
   */
  public refresh(): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      this.refreshLeaf(leaf);
    });
  }

  /* v8 ignore start -- requires a real CodeMirror EditorView (view.editor.cm) + dispatch; verified via integration. */
  private refreshLeaf(leaf: WorkspaceLeaf): void {
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) {
      return;
    }
    const editorView = view.editor.cm;
    const ranges = computeHighlightRangesForFile(this.highlights.values(), view.file, editorView.state.doc.length);
    editorView.dispatch({ effects: setSelectionHighlightsEffect.of(buildSelectionHighlightDecorations(ranges)) });
  }
  /* v8 ignore stop */
}

/**
 * Builds the decoration set that highlights the given ranges.
 *
 * @param ranges - The (sorted, non-overlapping) ranges to highlight.
 * @returns The decoration set.
 */
export function buildSelectionHighlightDecorations(ranges: HighlightRange[]): DecorationSet {
  return Decoration.set(ranges.map((range) => Decoration.mark({ class: HIGHLIGHT_CLASS }).range(range.from, range.to)));
}

/**
 * Collects the highlight ranges that apply to the given file from all registered highlights, clamped to
 * the document length, with empty ranges dropped and overlaps merged.
 *
 * @param highlights - All registered highlights.
 * @param file - The file of the editor being decorated (or `null` for an editor with no file).
 * @param docLength - The length of the editor's document.
 * @returns The merged ranges to highlight in that editor.
 */
export function computeHighlightRangesForFile(highlights: Iterable<Highlight>, file: null | TFile, docLength: number): HighlightRange[] {
  if (!file) {
    return [];
  }
  const ranges: HighlightRange[] = [];
  for (const highlight of highlights) {
    if (highlight.file.path !== file.path) {
      continue;
    }
    for (const selection of highlight.ranges) {
      const from = Math.max(0, Math.min(selection.startOffset, docLength));
      const to = Math.max(0, Math.min(selection.endOffset, docLength));
      if (from < to) {
        ranges.push({ from, to });
      }
    }
  }
  return mergeHighlightRanges(ranges);
}

/**
 * Merges the given ranges into a sorted, non-overlapping set (touching/overlapping ranges are combined),
 * so overlapping highlights render as one decoration.
 *
 * @param ranges - The ranges to merge.
 * @returns The merged ranges, sorted by `from`.
 */
export function mergeHighlightRanges(ranges: HighlightRange[]): HighlightRange[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const merged: HighlightRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.from <= last.to) {
      merged[merged.length - 1] = { from: last.from, to: Math.max(last.to, range.to) };
    } else {
      merged.push(range);
    }
  }
  return merged;
}
