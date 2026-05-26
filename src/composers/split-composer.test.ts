import type { Editor } from 'obsidian';

import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { getSelections } from './split-composer.ts';

vi.mock('obsidian-dev-utils/html-element', () => ({
  createFragmentAsync: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/link', () => ({
  editLinks: vi.fn(),
  updateLink: vi.fn(),
  updateLinksInContent: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/metadata-cache', () => ({
  getBacklinksForFileSafe: vi.fn(),
  getCacheSafe: vi.fn(),
  getFrontmatterSafe: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/vault', () => ({
  process: vi.fn()
}));

vi.mock('obsidian-dev-utils/string', () => ({
  replaceAll: vi.fn()
}));

vi.mock('obsidian-dev-utils/function', () => ({
  noop: vi.fn()
}));

vi.mock('obsidian-dev-utils/object-utils', () => ({
  extractDefaultExportInterop: (m: unknown) => m
}));

vi.mock('../markdown-heading-document.ts', () => ({
  parseMarkdownHeadingDocument: vi.fn()
}));

describe('getSelections', () => {
  function createMockEditor(selections: { anchor: number; head: number }[]): Editor {
    return {
      listSelections: vi.fn().mockReturnValue(
        selections.map((s) => ({
          anchor: { ch: s.anchor, line: 0 },
          head: { ch: s.head, line: 0 }
        }))
      ),
      posToOffset: vi.fn((pos: { ch: number }) => pos.ch)
    } as unknown as Editor;
  }

  it('should return selections in sorted order', () => {
    const editor = createMockEditor([
      { anchor: 20, head: 30 },
      { anchor: 0, head: 10 }
    ]);

    const result = getSelections(editor);
    expect(result[0]?.startOffset).toBe(0);
    expect(result[1]?.startOffset).toBe(20);
  });

  it('should normalize reversed selections', () => {
    const editor = createMockEditor([
      { anchor: 30, head: 10 }
    ]);

    const result = getSelections(editor);
    expect(result[0]?.startOffset).toBe(10);
    expect(result[0]?.endOffset).toBe(30);
  });

  it('should handle single selection', () => {
    const editor = createMockEditor([
      { anchor: 5, head: 15 }
    ]);

    const result = getSelections(editor);
    expect(result).toHaveLength(1);
    expect(result[0]?.startOffset).toBe(5);
    expect(result[0]?.endOffset).toBe(15);
  });

  it('should handle empty selections', () => {
    const editor = createMockEditor([]);
    const result = getSelections(editor);
    expect(result).toHaveLength(0);
  });
});
