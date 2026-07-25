import type { TFile } from 'obsidian';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { MarkedSwapSelection } from './swap-selection-buffer.ts';

import { SwapSelectionBuffer } from './swap-selection-buffer.ts';

function createMarked(): MarkedSwapSelection {
  return {
    endOffset: 10,
    selectedText: 'text',
    sourceFile: strictProxy<TFile>({ path: 'a.md' }),
    sourceMtime: 1000,
    startOffset: 3
  };
}

describe('SwapSelectionBuffer', () => {
  it('should start empty', () => {
    const buffer = new SwapSelectionBuffer();
    expect(buffer.get()).toBeNull();
    expect(buffer.hasMark()).toBe(false);
  });

  it('should hold a marked selection', () => {
    const buffer = new SwapSelectionBuffer();
    const marked = createMarked();
    buffer.mark(marked);
    expect(buffer.get()).toBe(marked);
    expect(buffer.hasMark()).toBe(true);
  });

  it('should replace an existing mark', () => {
    const buffer = new SwapSelectionBuffer();
    buffer.mark(createMarked());
    const second = createMarked();
    buffer.mark(second);
    expect(buffer.get()).toBe(second);
  });

  it('should clear the mark', () => {
    const buffer = new SwapSelectionBuffer();
    buffer.mark(createMarked());
    buffer.clear();
    expect(buffer.get()).toBeNull();
    expect(buffer.hasMark()).toBe(false);
  });
});
