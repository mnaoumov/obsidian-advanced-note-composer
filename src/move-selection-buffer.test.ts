import type {
  Editor,
  EditorPosition,
  TFile
} from 'obsidian';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { MarkedSelection } from './move-selection-buffer.ts';

import { MoveSelectionBuffer } from './move-selection-buffer.ts';

function createMarkedSelection(overrides: Partial<MarkedSelection> = {}): MarkedSelection {
  return {
    abortController: new AbortController(),
    capturedSelections: [{ endOffset: 10, startOffset: 5 }],
    lock: { [Symbol.dispose]: vi.fn() },
    selectedText: 'marked text',
    sourceFile: strictProxy<TFile>({ path: 'source.md' }),
    sourceMtime: 123,
    ...overrides
  };
}

function createMockEditor(cursorOffset: number): Editor {
  return strictProxy<Editor>({
    getCursor: vi.fn<() => EditorPosition>().mockReturnValue({ ch: 0, line: 0 }),
    posToOffset: vi.fn<() => number>().mockReturnValue(cursorOffset)
  });
}

describe('MoveSelectionBuffer', () => {
  it('starts empty', () => {
    const buffer = new MoveSelectionBuffer();
    expect(buffer.hasMark()).toBe(false);
    expect(buffer.get()).toBeNull();
  });

  it('stores a marked selection', () => {
    const buffer = new MoveSelectionBuffer();
    const marked = createMarkedSelection();
    buffer.mark(marked);
    expect(buffer.hasMark()).toBe(true);
    expect(buffer.get()).toBe(marked);
  });

  it('disposes the held lock on clear', () => {
    const buffer = new MoveSelectionBuffer();
    const marked = createMarkedSelection();
    buffer.mark(marked);
    buffer.clear();
    expect(marked.lock[Symbol.dispose]).toHaveBeenCalledTimes(1);
    expect(buffer.hasMark()).toBe(false);
    expect(buffer.get()).toBeNull();
  });

  it('is a no-op to clear when empty', () => {
    const buffer = new MoveSelectionBuffer();
    expect(() => {
      buffer.clear();
    }).not.toThrow();
    expect(buffer.hasMark()).toBe(false);
  });

  it('releases the previous lock when re-marking', () => {
    const buffer = new MoveSelectionBuffer();
    const first = createMarkedSelection();
    const second = createMarkedSelection();
    buffer.mark(first);
    buffer.mark(second);
    expect(first.lock[Symbol.dispose]).toHaveBeenCalledTimes(1);
    expect(second.lock[Symbol.dispose]).not.toHaveBeenCalled();
    expect(buffer.get()).toBe(second);
  });

  it('reports the cursor inside a marked selection', () => {
    const buffer = new MoveSelectionBuffer();
    buffer.mark(createMarkedSelection({ capturedSelections: [{ endOffset: 10, startOffset: 5 }] }));
    expect(buffer.isCursorInsideMarkedSelection(createMockEditor(7))).toBe(true);
  });

  it('reports the cursor outside a marked selection', () => {
    const buffer = new MoveSelectionBuffer();
    buffer.mark(createMarkedSelection({ capturedSelections: [{ endOffset: 10, startOffset: 5 }] }));
    expect(buffer.isCursorInsideMarkedSelection(createMockEditor(20))).toBe(false);
  });

  it('treats the selection boundaries as outside', () => {
    const buffer = new MoveSelectionBuffer();
    buffer.mark(createMarkedSelection({ capturedSelections: [{ endOffset: 10, startOffset: 5 }] }));
    expect(buffer.isCursorInsideMarkedSelection(createMockEditor(5))).toBe(false);
    expect(buffer.isCursorInsideMarkedSelection(createMockEditor(10))).toBe(false);
  });

  it('reports the cursor as outside when nothing is marked', () => {
    const buffer = new MoveSelectionBuffer();
    expect(buffer.isCursorInsideMarkedSelection(createMockEditor(7))).toBe(false);
  });
});
