import type {
  App,
  CachedMetadata,
  Editor,
  HeadingCache,
  MetadataCache,
  SectionCache,
  TFile
} from 'obsidian';

import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  getHorizontalRuleBlocks,
  getSelectionBetweenHorizontalRules,
  resolveHorizontalRuleBlockName
} from './horizontal-rules.ts';

// The unit tests hand-build the `sections` array, so they only verify the range math given a parsed cache.
// Real Obsidian tagging of `---` / `***` / `___` / spaced rules as `thematicBreak` sections (and NOT
// frontmatter delimiters or `---` inside code fences) is confirmed by the desktop integration test.

function createMockApp(cache: CachedMetadata | null): App {
  return strictProxy<App>({
    metadataCache: strictProxy<MetadataCache>({
      getFileCache: vi.fn().mockReturnValue(cache)
    })
  });
}

function createMockEditor(lines: string[]): Editor {
  return strictProxy<Editor>({
    getLine: vi.fn((n: number) => lines[n] ?? ''),
    lineCount: vi.fn(() => lines.length)
  });
}

function createMockFile(): TFile {
  return strictProxy<TFile>({ path: 'test/note.md' });
}

/**
A one-line `thematicBreak` (horizontal rule) section at `line`.
*/
function rule(line: number): SectionCache {
  return section('thematicBreak', line);
}

/**
A one-line section of the given type at `line`.
*/
function section(type: string, line: number): SectionCache {
  return strictProxy<SectionCache>({
    position: {
      end: { col: 0, line, offset: 0 },
      start: { col: 0, line, offset: 0 }
    },
    type
  });
}

describe('getSelectionBetweenHorizontalRules', () => {
  it('returns null when there is no cache', () => {
    const app = createMockApp(null);
    const editor = createMockEditor(['a', '---', 'b']);
    expect(getSelectionBetweenHorizontalRules({ app, editor, file: createMockFile(), lineNumber: 0 })).toBeNull();
  });

  it('returns null when the note has no sections', () => {
    const app = createMockApp({});
    const editor = createMockEditor(['a', 'b']);
    expect(getSelectionBetweenHorizontalRules({ app, editor, file: createMockFile(), lineNumber: 0 })).toBeNull();
  });

  it('returns null when the note has no horizontal rules', () => {
    const app = createMockApp({ sections: [section('paragraph', 0)] });
    const editor = createMockEditor(['a', 'b']);
    expect(getSelectionBetweenHorizontalRules({ app, editor, file: createMockFile(), lineNumber: 0 })).toBeNull();
  });

  it('extracts the section strictly between two rules', () => {
    const app = createMockApp({ sections: [rule(1), rule(3)] });
    const editor = createMockEditor(['a', '---', 'middle', '---', 'b']);
    const result = getSelectionBetweenHorizontalRules({ app, editor, file: createMockFile(), lineNumber: 2 });
    expect(result).toEqual({
      end: { ch: 'middle'.length, line: 2 },
      start: { ch: 0, line: 2 }
    });
  });

  it('uses the note start as the top boundary when the cursor is above the first rule', () => {
    const app = createMockApp({ sections: [rule(1)] });
    const editor = createMockEditor(['top', '---', 'below']);
    const result = getSelectionBetweenHorizontalRules({ app, editor, file: createMockFile(), lineNumber: 0 });
    expect(result).toEqual({
      end: { ch: 'top'.length, line: 0 },
      start: { ch: 0, line: 0 }
    });
  });

  it('uses the note end as the bottom boundary when the cursor is below the last rule', () => {
    const app = createMockApp({ sections: [rule(1)] });
    const editor = createMockEditor(['above', '---', 'bottom']);
    const result = getSelectionBetweenHorizontalRules({ app, editor, file: createMockFile(), lineNumber: 2 });
    expect(result).toEqual({
      end: { ch: 'bottom'.length, line: 2 },
      start: { ch: 0, line: 2 }
    });
  });

  it('treats a rule the cursor is on as the top boundary (extracts the section below)', () => {
    const app = createMockApp({ sections: [rule(1), rule(3)] });
    const editor = createMockEditor(['a', '---', 'mid', '---', 'b']);
    const result = getSelectionBetweenHorizontalRules({ app, editor, file: createMockFile(), lineNumber: 1 });
    expect(result).toEqual({
      end: { ch: 'mid'.length, line: 2 },
      start: { ch: 0, line: 2 }
    });
  });

  it('extracts to the note end when the cursor is on the last rule', () => {
    const app = createMockApp({ sections: [rule(1), rule(3)] });
    const editor = createMockEditor(['a', '---', 'mid', '---', 'tail']);
    const result = getSelectionBetweenHorizontalRules({ app, editor, file: createMockFile(), lineNumber: 3 });
    expect(result).toEqual({
      end: { ch: 'tail'.length, line: 4 },
      start: { ch: 0, line: 4 }
    });
  });

  it('bounds the section at the nearest rule below when several rules follow the cursor', () => {
    const app = createMockApp({ sections: [rule(2), rule(4)] });
    const editor = createMockEditor(['top', '', '---', 'a', '---', 'b']);
    const result = getSelectionBetweenHorizontalRules({ app, editor, file: createMockFile(), lineNumber: 0 });
    expect(result).toEqual({
      end: { ch: 'top'.length, line: 0 },
      start: { ch: 0, line: 0 }
    });
  });

  it('trims leading and trailing blank lines inside the section', () => {
    const app = createMockApp({ sections: [rule(0), rule(4)] });
    const editor = createMockEditor(['---', '', 'content', '', '---']);
    const result = getSelectionBetweenHorizontalRules({ app, editor, file: createMockFile(), lineNumber: 2 });
    expect(result).toEqual({
      end: { ch: 'content'.length, line: 2 },
      start: { ch: 0, line: 2 }
    });
  });

  it('keys off the section type, not the line text (a rule-looking line that is not a thematicBreak is content)', () => {
    // Line 2 reads `---` but is inside a fenced code block, so it is a `code` section, not a rule.
    const app = createMockApp({ sections: [rule(0), section('code', 1), rule(5)] });
    const editor = createMockEditor(['---', '```', '---', '```', 'text', '---']);
    const result = getSelectionBetweenHorizontalRules({ app, editor, file: createMockFile(), lineNumber: 2 });
    expect(result).toEqual({
      end: { ch: 'text'.length, line: 4 },
      start: { ch: 0, line: 1 }
    });
  });

  it('returns null for an empty section between two adjacent rules', () => {
    const app = createMockApp({ sections: [rule(0), rule(1)] });
    const editor = createMockEditor(['---', '---']);
    expect(getSelectionBetweenHorizontalRules({ app, editor, file: createMockFile(), lineNumber: 0 })).toBeNull();
  });

  it('returns null for a section that is only a blank line', () => {
    const app = createMockApp({ sections: [rule(0), rule(2)] });
    const editor = createMockEditor(['---', '', '---']);
    expect(getSelectionBetweenHorizontalRules({ app, editor, file: createMockFile(), lineNumber: 1 })).toBeNull();
  });
});

function heading(text: string, line: number): HeadingCache {
  return {
    heading: text,
    level: 1,
    position: {
      end: { col: 0, line, offset: 0 },
      start: { col: 0, line, offset: 0 }
    }
  };
}

describe('getHorizontalRuleBlocks', () => {
  it('returns no block when the note has no horizontal rule', () => {
    const editor = createMockEditor(['a', 'b']);
    expect(getHorizontalRuleBlocks({ cache: {}, lines: editor })).toEqual([]);
    expect(getHorizontalRuleBlocks({ cache: { sections: [section('paragraph', 0)] }, lines: editor })).toEqual([]);
  });

  it('cuts the note at every rule, trimming blank lines and dropping empty blocks', () => {
    const editor = createMockEditor(['', 'first', '', '***', '', '---', '# Second', 'body', '---', 'third', '']);
    expect(getHorizontalRuleBlocks({
      cache: { headings: [heading('  Second ', 6)], sections: [rule(8), rule(3), rule(5)] },
      lines: editor
    })).toEqual([
      { end: { ch: 5, line: 1 }, name: 'first', start: { ch: 0, line: 1 } },
      { end: { ch: 4, line: 7 }, name: 'Second', start: { ch: 0, line: 6 } },
      { end: { ch: 5, line: 9 }, name: 'third', start: { ch: 0, line: 9 } }
    ]);
  });

  it('leaves the frontmatter out of the first block', () => {
    const editor = createMockEditor(['---', 'a: 1', '---', 'intro', '---', 'outro']);
    expect(getHorizontalRuleBlocks({
      cache: {
        frontmatterPosition: { end: { col: 0, line: 2, offset: 0 }, start: { col: 0, line: 0, offset: 0 } },
        sections: [rule(4)]
      },
      lines: editor
    })).toEqual([
      { end: { ch: 5, line: 3 }, name: 'intro', start: { ch: 0, line: 3 } },
      { end: { ch: 5, line: 5 }, name: 'outro', start: { ch: 0, line: 5 } }
    ]);
  });

  it('ignores a rule reported inside the frontmatter', () => {
    const editor = createMockEditor(['---', '---', '---', 'body']);
    expect(getHorizontalRuleBlocks({
      cache: {
        frontmatterPosition: { end: { col: 0, line: 2, offset: 0 }, start: { col: 0, line: 0, offset: 0 } },
        sections: [rule(1)]
      },
      lines: editor
    })).toEqual([
      { end: { ch: 4, line: 3 }, name: 'body', start: { ch: 0, line: 3 } }
    ]);
  });
});

describe('resolveHorizontalRuleBlockName', () => {
  it.each([
    ['plain text', 'plain text'],
    ['> > quoted', 'quoted'],
    ['## heading', 'heading'],
    ['- [ ] task **bold**', 'task bold'],
    ['1. item with [[target|alias]] and [[plain]]', 'item with alias and plain'],
    ['see ![image](a.png) and [link](https://x.y)', 'see image and link'],
    ['  many   spaces  ', 'many spaces'],
    ['', '']
  ])('turns %j into %j', (line, expected) => {
    expect(resolveHorizontalRuleBlockName(line)).toBe(expected);
  });

  it('cuts a long line at the last word boundary that fits', () => {
    const name = resolveHorizontalRuleBlockName(`${'word '.repeat(30)}end`);
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.endsWith('word')).toBe(true);
  });

  it('cuts a long line with no space at the limit', () => {
    expect(resolveHorizontalRuleBlockName('x'.repeat(150))).toBe('x'.repeat(100));
  });
});
