import type { Editor } from 'obsidian';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  extractHeading,
  extractHeadingFromLine
} from './headings.ts';

describe('extractHeadingFromLine', () => {
  it('should extract heading from h1 line', () => {
    expect(extractHeadingFromLine('# Hello World')).toBe('Hello World');
  });

  it('should extract heading from h2 line', () => {
    expect(extractHeadingFromLine('## Sub Heading')).toBe('Sub Heading');
  });

  it('should extract heading from h3 line', () => {
    expect(extractHeadingFromLine('### Deep Heading')).toBe('Deep Heading');
  });

  it('should extract heading from h4 line', () => {
    expect(extractHeadingFromLine('#### Level 4')).toBe('Level 4');
  });

  it('should extract heading from h5 line', () => {
    expect(extractHeadingFromLine('##### Level 5')).toBe('Level 5');
  });

  it('should extract heading from h6 line', () => {
    expect(extractHeadingFromLine('###### Level 6')).toBe('Level 6');
  });

  it('should return null for non-heading line', () => {
    expect(extractHeadingFromLine('regular text')).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(extractHeadingFromLine('')).toBeNull();
  });

  it('should return null for more than 6 hashes', () => {
    expect(extractHeadingFromLine('####### Not a heading')).toBeNull();
  });

  it('should return null for hash without space', () => {
    expect(extractHeadingFromLine('#NoSpace')).toBeNull();
  });

  it('should extract heading with special characters', () => {
    expect(extractHeadingFromLine('## Hello *world* `code`')).toBe('Hello *world* `code`');
  });
});

describe('extractHeading', () => {
  function createMockEditor(selection: string): Editor {
    return strictProxy<Editor>({
      getSelection: vi.fn().mockReturnValue(selection)
    });
  }

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
