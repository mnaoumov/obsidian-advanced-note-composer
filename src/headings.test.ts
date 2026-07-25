import type { Editor } from 'obsidian';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { extractHeading } from './headings.ts';

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
