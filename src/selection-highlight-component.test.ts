import type {
  App as AppOriginal,
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

import type { Selection } from './composers/composer-base.ts';
import type { HighlightRange } from './selection-highlight-component.ts';

import {
  buildSelectionHighlightDecorations,
  computeHighlightRangesForFile,
  mergeHighlightRanges,
  SelectionHighlightComponent,
  selectionHighlightField,
  setSelectionHighlightsEffect
} from './selection-highlight-component.ts';

interface Highlight {
  readonly file: TFile;
  readonly ranges: Selection[];
}

function file(path: string): TFile {
  return strictProxy<TFile>({ path });
}

function selection(startOffset: number, endOffset: number): Selection {
  return { endOffset, startOffset };
}

describe('mergeHighlightRanges', () => {
  it('sorts and unions overlapping and adjacent ranges', () => {
    const merged = mergeHighlightRanges([
      { from: 8, to: 12 },
      { from: 5, to: 10 },
      { from: 12, to: 14 }
    ]);
    expect(merged).toEqual([{ from: 5, to: 14 }]);
  });

  it('keeps disjoint ranges separate', () => {
    const merged = mergeHighlightRanges([{ from: 5, to: 7 }, { from: 0, to: 2 }]);
    expect(merged).toEqual([{ from: 0, to: 2 }, { from: 5, to: 7 }]);
  });
});

describe('computeHighlightRangesForFile', () => {
  const sourceFile = file('source.md');

  it('returns nothing for an editor with no file', () => {
    const highlights: Highlight[] = [{ file: sourceFile, ranges: [selection(0, 5)] }];
    expect(computeHighlightRangesForFile({ docLength: 100, file: null, highlights })).toEqual([]);
  });

  it('ignores highlights registered for a different file', () => {
    const highlights: Highlight[] = [{ file: file('other.md'), ranges: [selection(0, 5)] }];
    expect(computeHighlightRangesForFile({ docLength: 100, file: sourceFile, highlights })).toEqual([]);
  });

  it('clamps ranges to the document length and drops empty ones', () => {
    const highlights: Highlight[] = [{ file: sourceFile, ranges: [selection(3, 10), selection(20, 20)] }];
    expect(computeHighlightRangesForFile({ docLength: 5, file: sourceFile, highlights })).toEqual([{ from: 3, to: 5 }]);
  });

  it('merges overlapping ranges across all matching highlights', () => {
    const highlights: Highlight[] = [
      { file: sourceFile, ranges: [selection(0, 5)] },
      { file: sourceFile, ranges: [selection(4, 8)] }
    ];
    expect(computeHighlightRangesForFile({ docLength: 100, file: sourceFile, highlights })).toEqual([{ from: 0, to: 8 }]);
  });
});

describe('buildSelectionHighlightDecorations', () => {
  it('builds one decoration per range', () => {
    expect(buildSelectionHighlightDecorations([{ from: 0, to: 5 }, { from: 6, to: 11 }]).size).toBe(2);
  });

  it('builds an empty set for no ranges', () => {
    expect(buildSelectionHighlightDecorations([]).size).toBe(0);
  });
});

describe('selectionHighlightField', () => {
  it('starts empty, applies the set effect, and maps through document changes', () => {
    const state = EditorState.create({ doc: 'hello world', extensions: [selectionHighlightField] });
    expect(state.field(selectionHighlightField).size).toBe(0);

    const ranges: HighlightRange[] = [{ from: 0, to: 5 }];
    const withHighlight = state.update({ effects: setSelectionHighlightsEffect.of(buildSelectionHighlightDecorations(ranges)) }).state;
    expect(withHighlight.field(selectionHighlightField).size).toBe(1);

    const afterEdit = withHighlight.update({ changes: { from: 0, insert: 'X' } }).state;
    expect(afterEdit.field(selectionHighlightField).size).toBe(1);
  });

  it('ignores unrelated effects', () => {
    const unrelatedEffect = StateEffect.define();
    const state = EditorState.create({ doc: 'hello world', extensions: [selectionHighlightField] });
    const withHighlight = state.update({ effects: setSelectionHighlightsEffect.of(buildSelectionHighlightDecorations([{ from: 0, to: 5 }])) }).state;

    const afterUnrelated = withHighlight.update({ effects: unrelatedEffect.of(null) }).state;
    expect(afterUnrelated.field(selectionHighlightField).size).toBe(1);
  });
});

describe('SelectionHighlightComponent', () => {
  let app: AppOriginal;
  let component: SelectionHighlightComponent;

  beforeEach(() => {
    app = App.createConfigured__({}).asOriginalType__();
    const fakeLeaf = strictProxy<WorkspaceLeaf>({ view: castTo<View>({}) });
    vi.spyOn(app.workspace, 'iterateAllLeaves').mockImplementation((callback) => {
      callback(fakeLeaf);
    });
    component = new SelectionHighlightComponent({ app });
    component.load();
  });

  afterEach(() => {
    component.unload();
    vi.restoreAllMocks();
  });

  it('exposes the highlight editor extension', () => {
    expect(component.getEditorExtension()).toBe(selectionHighlightField);
  });

  it('refreshes editors when a highlight is added and again when it is removed', () => {
    vi.mocked(app.workspace.iterateAllLeaves).mockClear();
    const highlight = component.addHighlight(file('source.md'), [selection(0, 5)]);
    expect(app.workspace.iterateAllLeaves).toHaveBeenCalledTimes(1);

    highlight[Symbol.dispose]();
    expect(app.workspace.iterateAllLeaves).toHaveBeenCalledTimes(2);
  });

  it('refreshes editors on active-leaf-change', () => {
    vi.mocked(app.workspace.iterateAllLeaves).mockClear();
    app.workspace.trigger('active-leaf-change', null);
    expect(app.workspace.iterateAllLeaves).toHaveBeenCalled();
  });
});
