import type { HeadingCache } from 'obsidian';

import {
  describe,
  expect,
  it
} from 'vitest';

import { InsertMode } from '../composers/insert-mode.ts';
import { resolveHeadingInsertOffset } from './heading-insert-offset.ts';

// The headings are built from the content the way the metadata cache reports ATX headings: the position
// spans the heading line, without its line break.
function buildHeadings(content: string): HeadingCache[] {
  const headings: HeadingCache[] = [];
  let offset = 0;
  const lines = content.split('\n');
  for (const [line, text] of lines.entries()) {
    const match = /^(?<marks>#+) (?<heading>.*)$/.exec(text);
    if (match?.groups) {
      headings.push({
        heading: match.groups['heading'] ?? '',
        level: match.groups['marks']?.length ?? 0,
        position: {
          end: { col: text.length, line, offset: offset + text.length },
          start: { col: 0, line, offset }
        }
      });
    }
    offset += text.length + 1;
  }
  return headings;
}

function insertAt(content: string, headingIndex: number, insertMode: InsertMode): string {
  const offset = resolveHeadingInsertOffset({ content, headingIndex, headings: buildHeadings(content), insertMode });
  return `${content.slice(0, offset)}|${content.slice(offset)}`;
}

describe('resolveHeadingInsertOffset', () => {
  const content = '# A\nalpha\n\n## B\nbeta\n\n## C\n';

  it('should prepend right after the heading line', () => {
    expect(insertAt(content, 1, InsertMode.Prepend)).toBe('# A\nalpha\n\n## B|\nbeta\n\n## C\n');
  });

  it('should append after the last non-blank character of the heading body', () => {
    expect(insertAt(content, 1, InsertMode.Append)).toBe('# A\nalpha\n\n## B\nbeta|\n\n## C\n');
  });

  it('should end the body at the next heading of any level', () => {
    expect(insertAt(content, 0, InsertMode.Append)).toBe('# A\nalpha|\n\n## B\nbeta\n\n## C\n');
  });

  it('should append at the end of the heading line when the body is empty', () => {
    expect(insertAt(content, 2, InsertMode.Append)).toBe('# A\nalpha\n\n## B\nbeta\n\n## C|\n');
  });

  it('should run the last heading body to the end of the note', () => {
    expect(insertAt('# A\nalpha\nomega\n\n', 0, InsertMode.Append)).toBe('# A\nalpha\nomega|\n\n');
  });
});
