import type {
  App,
  CachedMetadata,
  Editor,
  MetadataCache,
  SectionCache,
  TFile
} from 'obsidian';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { getSelectionBetweenHorizontalRules } from './horizontal-rules.ts';

// The unit tests hand-build the `sections` array, so they only verify the range math given a parsed cache.
// Real Obsidian tagging of `---` / `***` / `___` / spaced rules as `thematicBreak` sections (and NOT
// Frontmatter delimiters or `---` inside code fences) is confirmed by the desktop integration test.

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

/** A one-line `thematicBreak` (horizontal rule) section at `line`. */
function rule(line: number): SectionCache {
  return section('thematicBreak', line);
}

/** A one-line section of the given type at `line`. */
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
