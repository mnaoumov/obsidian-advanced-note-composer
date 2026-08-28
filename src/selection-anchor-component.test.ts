import type {
  App as AppOriginal,
  Editor,
  TFile,
  View,
  WorkspaceLeaf
} from 'obsidian';

import {
  EditorState,
  StateEffect
} from '@codemirror/state';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  buildSelectionAnchorDecorations,
  getSelectionAnchorOffset,
  replaceSelectionAnchorEffect,
  SelectionAnchorComponent,
  selectionAnchorField
} from './selection-anchor-component.ts';

/**
 * The anchor marker widget, as this suite needs it.
 *
 * Narrower than `WidgetType`, whose `toDOM` takes an `EditorView`: the marker's own override needs no view
 * (it renders one fixed element), and this suite has no view to hand it.
 */
interface AnchorWidget {
  eq(other: AnchorWidget): boolean;
  toDOM(): HTMLElement;
}

interface AnchorWidgetSpec {
  readonly widget: AnchorWidget;
}

interface DecoratedRange {
  readonly spec: AnchorWidgetSpec;
}

interface DispatchedTransactionSpec {
  readonly effects: StateEffect<unknown>;
}

const DOC = 'hello world';

function anchoredState(offset: number, doc = DOC): EditorState {
  return EditorState.create({ doc, extensions: [selectionAnchorField] })
    .update({ effects: replaceSelectionAnchorEffect.of(buildSelectionAnchorDecorations(offset)) }).state;
}

function editorWithState(state: EditorState, dispatch = vi.fn()): Editor {
  return strictProxy<Editor>({
    cm: castTo<Editor['cm']>({
      dispatch,
      state
    })
  });
}

function file(path: string): TFile {
  return strictProxy<TFile>({ path });
}

describe('buildSelectionAnchorDecorations', () => {
  it('builds no decoration for no anchor', () => {
    expect(buildSelectionAnchorDecorations(null).size).toBe(0);
  });

  it('builds one widget for an anchor', () => {
    expect(buildSelectionAnchorDecorations(4).size).toBe(1);
  });

  // Offset 0 is falsy, and an anchor at the very top of a note is an ordinary thing to want.
  it('builds a widget for an anchor at the start of the document', () => {
    expect(buildSelectionAnchorDecorations(0).size).toBe(1);
  });
});

describe('the anchor marker widget', () => {
  function widget(): AnchorWidget {
    const iterator = buildSelectionAnchorDecorations(4).iter();
    return castTo<DecoratedRange>(iterator.value).spec.widget;
  }

  it('renders an element carrying the anchor class', () => {
    expect(widget().toDOM().hasClass('advanced-note-composer-selection-anchor')).toBe(true);
  });

  // Every marker looks the same, so CodeMirror never has to replace one already in the DOM.
  it('compares equal to any other anchor marker', () => {
    expect(widget().eq(widget())).toBe(true);
  });
});

describe('selectionAnchorField', () => {
  it('starts empty and applies the replace effect', () => {
    expect(EditorState.create({ doc: DOC, extensions: [selectionAnchorField] }).field(selectionAnchorField).size).toBe(0);
    expect(anchoredState(6).field(selectionAnchorField).size).toBe(1);
  });

  it('ignores unrelated effects', () => {
    const unrelatedEffect = StateEffect.define();
    expect(getSelectionAnchorOffset(anchoredState(6).update({ effects: unrelatedEffect.of(null) }).state)).toBe(6);
  });

  /*
   * THE test for this feature. `Start selection` and `End selection` are two separate user actions with
   * arbitrary typing in between — that is the whole design, and it is why the anchor is a `StateField`
   * rather than a number held beside the editor. A raw offset drifts the moment text is inserted above
   * it and the user silently selects the wrong range; a test that never edits in between passes against
   * exactly that broken implementation.
   */
  it('maps the anchor through an edit made above it', () => {
    expect(getSelectionAnchorOffset(anchoredState(6).update({ changes: { from: 0, insert: 'XYZ' } }).state)).toBe(9);
  });

  it('leaves the anchor alone for an edit made below it', () => {
    expect(getSelectionAnchorOffset(anchoredState(6).update({ changes: { from: 8, insert: 'XYZ' } }).state)).toBe(6);
  });

  /*
   * What `side: -1` buys, and the reason it is not `side: 1`: text typed AT the anchor lands after it, so
   * it ends up INSIDE the range `End selection` will make. Typing there means extending the region.
   */
  it('stays put when text is typed at the anchor, so the new text falls inside the range', () => {
    expect(getSelectionAnchorOffset(anchoredState(6).update({ changes: { from: 6, insert: 'XYZ' } }).state)).toBe(6);
  });

  it('maps the anchor back through a deletion above it', () => {
    expect(getSelectionAnchorOffset(anchoredState(6).update({ changes: { from: 0, to: 3 } }).state)).toBe(3);
  });
});

describe('getSelectionAnchorOffset', () => {
  it('returns null for a state that never registered the field', () => {
    expect(getSelectionAnchorOffset(EditorState.create({ doc: DOC }))).toBeNull();
  });

  it('returns null when nothing is anchored', () => {
    expect(getSelectionAnchorOffset(EditorState.create({ doc: DOC, extensions: [selectionAnchorField] }))).toBeNull();
  });

  it('returns the anchored offset', () => {
    expect(getSelectionAnchorOffset(anchoredState(6))).toBe(6);
  });
});

describe('SelectionAnchorComponent', () => {
  let app: AppOriginal;
  let component: SelectionAnchorComponent;
  const sourceFile = file('source.md');

  beforeEach(() => {
    app = App.createConfigured__({}).asOriginalType__();
    const fakeLeaf = strictProxy<WorkspaceLeaf>({ view: castTo<View>({}) });
    vi.spyOn(app.workspace, 'iterateAllLeaves').mockImplementation((callback) => {
      callback(fakeLeaf);
    });
    component = new SelectionAnchorComponent({ app });
    component.load();
  });

  afterEach(() => {
    component.unload();
    vi.restoreAllMocks();
  });

  it('exposes the anchor editor extension', () => {
    expect(component.getEditorExtension()).toBe(selectionAnchorField);
  });

  it('holds no anchor to begin with', () => {
    expect(component.hasAnchor(sourceFile)).toBe(false);
  });

  it('anchors at the cursor and dispatches the marker', () => {
    const dispatch = vi.fn();
    const state = EditorState.create({ doc: DOC, extensions: [selectionAnchorField], selection: { anchor: 4 } });
    component.setAnchor(editorWithState(state, dispatch), sourceFile);

    expect(component.hasAnchor(sourceFile)).toBe(true);
    const spec = castTo<DispatchedTransactionSpec>(dispatch.mock.calls[0]?.[0]);
    expect(getSelectionAnchorOffset(state.update({ effects: spec.effects }).state)).toBe(4);
  });

  it('reads the anchored offset back out of the editor', () => {
    expect(component.getAnchorOffset(editorWithState(anchoredState(6)))).toBe(6);
  });

  // An anchor set in one note must not enable `End selection` in another — the field is per-editor, but
  // Obsidian reuses one editor per leaf across file switches, so the note is what decides.
  it('does not report an anchor for a different note', () => {
    component.setAnchor(editorWithState(EditorState.create({ doc: DOC, extensions: [selectionAnchorField] })), sourceFile);
    expect(component.hasAnchor(file('other.md'))).toBe(false);
  });

  it('does not report an anchor when there is no note', () => {
    component.setAnchor(editorWithState(EditorState.create({ doc: DOC, extensions: [selectionAnchorField] })), sourceFile);
    expect(component.hasAnchor(null)).toBe(false);
  });

  it('clears the anchor and refreshes every editor', () => {
    component.setAnchor(editorWithState(EditorState.create({ doc: DOC, extensions: [selectionAnchorField] })), sourceFile);
    vi.mocked(app.workspace.iterateAllLeaves).mockClear();

    component.clearAnchor();

    expect(component.hasAnchor(sourceFile)).toBe(false);
    expect(app.workspace.iterateAllLeaves).toHaveBeenCalledOnce();
  });

  it('does nothing when clearing with no anchor set', () => {
    vi.mocked(app.workspace.iterateAllLeaves).mockClear();
    component.clearAnchor();
    expect(app.workspace.iterateAllLeaves).not.toHaveBeenCalled();
  });

  it('drops the anchor when another note is opened', () => {
    component.setAnchor(editorWithState(EditorState.create({ doc: DOC, extensions: [selectionAnchorField] })), sourceFile);
    app.workspace.trigger('file-open', file('other.md'));
    expect(component.hasAnchor(sourceFile)).toBe(false);
  });

  it('drops the anchor when the last note is closed', () => {
    component.setAnchor(editorWithState(EditorState.create({ doc: DOC, extensions: [selectionAnchorField] })), sourceFile);
    app.workspace.trigger('file-open', null);
    expect(component.hasAnchor(sourceFile)).toBe(false);
  });

  it('keeps the anchor when its own note is re-opened', () => {
    component.setAnchor(editorWithState(EditorState.create({ doc: DOC, extensions: [selectionAnchorField] })), sourceFile);
    app.workspace.trigger('file-open', file('source.md'));
    expect(component.hasAnchor(sourceFile)).toBe(true);
  });

  it('ignores a file-open while nothing is anchored', () => {
    vi.mocked(app.workspace.iterateAllLeaves).mockClear();
    app.workspace.trigger('file-open', file('other.md'));
    expect(app.workspace.iterateAllLeaves).not.toHaveBeenCalled();
  });

  it('drops the anchor on unload, so a reload never starts armed', () => {
    component.setAnchor(editorWithState(EditorState.create({ doc: DOC, extensions: [selectionAnchorField] })), sourceFile);
    component.unload();
    expect(component.hasAnchor(sourceFile)).toBe(false);
  });
});
