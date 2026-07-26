import type {
  Editor,
  HeadingCache
} from 'obsidian';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { Level } from './markdown-heading-document.ts';

import {
  doesSelectionIntersectHeadingOfLevel,
  extractHeading
} from './headings.ts';

function createHeading(level: Level, line: number): HeadingCache {
  return strictProxy<HeadingCache>({
    heading: `Heading ${String(line)}`,
    level,
    position: {
      end: { col: 0, line, offset: 0 },
      start: { col: 0, line, offset: 0 }
    }
  });
}

function createMockEditor(selection: string): Editor {
  return strictProxy<Editor>({
    getSelection: vi.fn().mockReturnValue(selection)
  });
}

// These cases drive the internal extractHeadingFromLine parsing through the public extractHeading API.
// Single-line selections are used; a non-heading line yields null internally, surfaced as an empty string.
describe('extractHeading line parsing', () => {
  it('should extract heading from h1 line', () => {
    expect(extractHeading(createMockEditor('# Hello World'))).toBe('Hello World');
  });

  it('should extract heading from h2 line', () => {
    expect(extractHeading(createMockEditor('## Sub Heading'))).toBe('Sub Heading');
  });

  it('should extract heading from h3 line', () => {
    expect(extractHeading(createMockEditor('### Deep Heading'))).toBe('Deep Heading');
  });

  it('should extract heading from h4 line', () => {
    expect(extractHeading(createMockEditor('#### Level 4'))).toBe('Level 4');
  });

  it('should extract heading from h5 line', () => {
    expect(extractHeading(createMockEditor('##### Level 5'))).toBe('Level 5');
  });

  it('should extract heading from h6 line', () => {
    expect(extractHeading(createMockEditor('###### Level 6'))).toBe('Level 6');
  });

  it('should return empty string for non-heading line', () => {
    expect(extractHeading(createMockEditor('regular text'))).toBe('');
  });

  it('should return empty string for empty string', () => {
    expect(extractHeading(createMockEditor(''))).toBe('');
  });

  it('should return empty string for more than 6 hashes', () => {
    expect(extractHeading(createMockEditor('####### Not a heading'))).toBe('');
  });

  it('should return empty string for hash without space', () => {
    expect(extractHeading(createMockEditor('#NoSpace'))).toBe('');
  });

  it('should extract heading with special characters', () => {
    expect(extractHeading(createMockEditor('## Hello *world* `code`'))).toBe('Hello *world* `code`');
  });
});

describe('extractHeading', () => {
  it('should extract heading from first line of selection', () => {
    const editor = createMockEditor('## My Heading\nsome content');
    expect(extractHeading(editor)).toBe('My Heading');
  });

  it('should return empty string when no heading in first line', () => {
    const editor = createMockEditor('regular text\n## Heading');
    expect(extractHeading(editor)).toBe('');
  });

  it('should return empty string for empty selection', () => {
    const editor = createMockEditor('');
    expect(extractHeading(editor)).toBe('');
  });

  it('should extract heading from single-line selection', () => {
    const editor = createMockEditor('# Title');
    expect(extractHeading(editor)).toBe('Title');
  });
});

describe('doesSelectionIntersectHeadingOfLevel', () => {
  it('should return false when there are no headings', () => {
    expect(doesSelectionIntersectHeadingOfLevel({
      headings: [],
      level: 2,
      selectionEndLine: 3,
      selectionStartLine: 3
    })).toBe(false);
  });

  it('should return false when no heading matches the level', () => {
    expect(doesSelectionIntersectHeadingOfLevel({
      headings: [createHeading(1, 0), createHeading(3, 2)],
      level: 2,
      selectionEndLine: 2,
      selectionStartLine: 2
    })).toBe(false);
  });

  it('should return true when the cursor is on the heading line itself', () => {
    expect(doesSelectionIntersectHeadingOfLevel({
      headings: [createHeading(2, 4)],
      level: 2,
      selectionEndLine: 4,
      selectionStartLine: 4
    })).toBe(true);
  });

  it('should return true when the cursor is below the heading in its unbounded section', () => {
    expect(doesSelectionIntersectHeadingOfLevel({
      headings: [createHeading(1, 0), createHeading(2, 2)],
      level: 2,
      selectionEndLine: 10,
      selectionStartLine: 10
    })).toBe(true);
  });

  it('should return true when the cursor is inside a bounded section of the level', () => {
    expect(doesSelectionIntersectHeadingOfLevel({
      headings: [createHeading(2, 0), createHeading(2, 5)],
      level: 2,
      selectionEndLine: 3,
      selectionStartLine: 3
    })).toBe(true);
  });

  it('should return false when the cursor is before every section of the level', () => {
    expect(doesSelectionIntersectHeadingOfLevel({
      headings: [createHeading(1, 0), createHeading(2, 5)],
      level: 2,
      selectionEndLine: 1,
      selectionStartLine: 1
    })).toBe(false);
  });

  it('should return false when the cursor is after a bounded section of the level', () => {
    expect(doesSelectionIntersectHeadingOfLevel({
      headings: [createHeading(2, 0), createHeading(1, 5)],
      level: 2,
      selectionEndLine: 8,
      selectionStartLine: 8
    })).toBe(false);
  });

  it('should return true for a parent level whose section contains a deeply nested cursor', () => {
    expect(doesSelectionIntersectHeadingOfLevel({
      headings: [createHeading(1, 0), createHeading(2, 2), createHeading(3, 4)],
      level: 1,
      selectionEndLine: 6,
      selectionStartLine: 6
    })).toBe(true);
  });

  it('should return true when a multi-line selection overlaps the edge of a section', () => {
    expect(doesSelectionIntersectHeadingOfLevel({
      headings: [createHeading(1, 0), createHeading(2, 5)],
      level: 2,
      selectionEndLine: 6,
      selectionStartLine: 1
    })).toBe(true);
  });
});
