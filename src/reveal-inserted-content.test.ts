import type { Editor } from 'obsidian';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  resolveInsertedContentRange,
  resolveInsertedTextStartOffset
} from './reveal-inserted-content.ts';

/*
 * The locating half of the jump — the cascade that answers "where did the content we just wrote end up".
 * Its branches are not hypothetical: the recorded offset is what issue #175 added after a move to the bottom
 * of a note landed the cursor on an earlier identical copy, and the fallbacks below it are what a note whose
 * body shifted under that offset (a frontmatter merge) is left with. The completion notice's destination link
 * (issue #232) resolves through exactly the same cascade, only later.
 */
describe('resolveInsertedTextStartOffset', () => {
  it('should trust the recorded offset when the content really is there', () => {
    // `test` appears TWICE, and the recorded offset points at the second one. Taking the offset is the only
    // Way to land on the copy that was actually written (issue #175).
    expect(resolveInsertedTextStartOffset({
      editorValue: 'a test here and a test there',
      insertedContent: 'test',
      insertedContentOffset: 18
    })).toBe(18);
  });

  it('should skip the template\'s own leading whitespace so the cursor lands on the text', () => {
    // The shipped `mergeTemplate` is `\n\n{{content}}`, so the recorded string starts with blank lines the
    // User did not write and should not be sent to.
    expect(resolveInsertedTextStartOffset({
      editorValue: 'body\n\nmoved',
      insertedContent: '\n\nmoved',
      insertedContentOffset: 4
    })).toBe(6);
  });

  it('should fall back to searching when the recorded offset is stale', () => {
    // A later write (the frontmatter merge) shifted the body, so the offset no longer holds the content.
    expect(resolveInsertedTextStartOffset({
      editorValue: '---\ntitle: x\n---\nmoved',
      insertedContent: 'moved',
      insertedContentOffset: 0
    })).toBe(17);
  });

  it('should search when no offset was recorded at all', () => {
    // The heading-aware merge cannot name one splice point, so it records the string only.
    expect(resolveInsertedTextStartOffset({
      editorValue: 'intro\nmoved',
      insertedContent: 'moved',
      insertedContentOffset: null
    })).toBe(6);
  });

  it('should fall back to the TRIMMED content when the padded string is nowhere to be found', () => {
    // What the heading-aware merge writes is the content re-wrapped section by section, so the padded string
    // It recorded never appears verbatim — only its trimmed form does.
    expect(resolveInsertedTextStartOffset({
      editorValue: 'intro\n\nmoved\n',
      insertedContent: '\n\n\n\nmoved\n\n\n\n',
      insertedContentOffset: null
    })).toBe(7);
  });

  it('should give up rather than answer 0 for whitespace-only content', () => {
    // `indexOf('')` answers 0, which would silently send the cursor to the top of the note and read as a
    // Jump that went to the wrong place rather than as one that did not happen.
    expect(resolveInsertedTextStartOffset({
      editorValue: 'body',
      insertedContent: ' '.repeat(3),
      insertedContentOffset: null
    })).toBeNull();
  });

  it('should give up when the content is not in the note at all', () => {
    expect(resolveInsertedTextStartOffset({
      editorValue: 'body',
      insertedContent: 'gone',
      insertedContentOffset: null
    })).toBeNull();
  });
});

describe('resolveInsertedContentRange', () => {
  it('should span the trimmed content', () => {
    const range = resolveInsertedContentRange({
      editor: createEditorDouble('intro\n\nmoved text\n'),
      insertedContent: '\n\nmoved text\n',
      insertedContentOffset: 5
    });

    // Start past the template's blank lines, end just after the last character of the text — the trailing
    // Newline the template contributed is not part of what the user extracted.
    expect(range).toEqual({ endPos: { ch: 17, line: 0 }, startPos: { ch: 7, line: 0 } });
  });

  it('should span the trimmed content reached through the fallback search', () => {
    // The padded string the heading-aware merge recorded is nowhere in the note, but its trimmed form is —
    // And the range has to cover that text rather than the padding that never made it in.
    const range = resolveInsertedContentRange({
      editor: createEditorDouble('intro\nmoved text'),
      insertedContent: '\n\nmoved text\n\n',
      insertedContentOffset: null
    });

    expect(range).toEqual({ endPos: { ch: 16, line: 0 }, startPos: { ch: 6, line: 0 } });
  });

  it('should answer null when the content cannot be located', () => {
    expect(resolveInsertedContentRange({
      editor: createEditorDouble('body'),
      insertedContent: 'gone',
      insertedContentOffset: null
    })).toBeNull();
  });
});

function createEditorDouble(value: string): Editor {
  return strictProxy<Editor>({
    getValue: vi.fn().mockReturnValue(value),
    offsetToPos: vi.fn((offset: number) => ({ ch: offset, line: 0 }))
  });
}
