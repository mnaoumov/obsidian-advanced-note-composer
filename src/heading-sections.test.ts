import type { HeadingCache } from 'obsidian';

import { castTo } from 'obsidian-dev-utils/object-utils';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { SplitReorderableSectionsResult } from './heading-sections.ts';

import {
  flattenHeadingTree,
  flattenTreeToOrder,
  hasReorderableSiblings,
  joinReorderedSections,
  moveSibling,
  splitIntoReorderableSections
} from './heading-sections.ts';

function heading(level: number, text: string, offset: number): HeadingCache {
  return castTo<HeadingCache>({
    heading: text,
    level,
    position: { start: { offset } }
  });
}

/**
 * Parses a content string into a heading cache, computing real offsets, so the test data stays in sync
 * with the content.
 *
 * @param content - The note content.
 * @returns The parsed heading cache entries.
 */
function parseHeadings(content: string): HeadingCache[] {
  const headings: HeadingCache[] = [];
  let offset = 0;
  for (const line of content.split('\n')) {
    const match = /^(?<hashes>#+)\s+(?<text>.*)$/.exec(line);
    const hashes = match?.groups?.['hashes'];
    const text = match?.groups?.['text'];
    if (hashes !== undefined && text !== undefined) {
      headings.push(heading(hashes.length, text, offset));
    }
    offset += line.length + 1;
  }
  return headings;
}

const NESTED_CONTENT = [
  'intro',
  '',
  '# A',
  'aaa',
  '',
  '## A.1',
  'a1',
  '',
  '## A.2',
  'a2',
  '',
  '# B',
  'bbb',
  ''
].join('\n');
const NESTED_HEADINGS = parseHeadings(NESTED_CONTENT);

describe('heading-sections', () => {
  describe('hasReorderableSiblings', () => {
    it('should return false when there are no headings', () => {
      expect(hasReorderableSiblings([])).toBe(false);
    });

    it('should return false with a single heading', () => {
      expect(hasReorderableSiblings([heading(1, 'A', 0)])).toBe(false);
    });

    it('should return false when the only headings are a parent and its single child', () => {
      expect(hasReorderableSiblings([heading(1, 'A', 0), heading(2, 'A.1', 4)])).toBe(false);
    });

    it('should return true with two or more top-level headings', () => {
      expect(hasReorderableSiblings([heading(1, 'A', 0), heading(1, 'B', 4)])).toBe(true);
    });

    it('should return true when a nested level has two or more siblings', () => {
      expect(hasReorderableSiblings([heading(1, 'A', 0), heading(2, 'A.1', 4), heading(2, 'A.2', 10)])).toBe(true);
    });
  });

  describe('splitIntoReorderableSections', () => {
    it('should return the whole content as preamble when there are no headings', () => {
      const result = splitIntoReorderableSections('just text', []);
      expect(result.preamble).toBe('just text');
      expect(result.sections).toHaveLength(0);
      expect(result.roots).toHaveLength(0);
    });

    it('should split into a preamble, flat own-text sections, and a nesting tree', () => {
      const result = splitIntoReorderableSections(NESTED_CONTENT, NESTED_HEADINGS);
      expect(result.preamble).toBe('intro\n\n');
      expect(result.sections).toHaveLength(4);
      expect(result.sections[0]?.headingText).toBe('A');
      expect(result.sections[0]?.level).toBe(1);
      expect(result.sections[0]?.text).toBe('# A\naaa\n\n');
      expect(result.sections[1]?.text).toBe('## A.1\na1\n\n');
      expect(result.sections[3]?.text).toBe('# B\nbbb\n');
      expect(result.roots.map((node) => node.index)).toStrictEqual([0, 3]);
      expect(result.roots[0]?.children.map((node) => node.index)).toStrictEqual([1, 2]);
      expect(result.roots[1]?.children).toHaveLength(0);
    });
  });

  describe('flattenHeadingTree', () => {
    it('should flatten depth-first with depth and sibling-move flags', () => {
      const split = splitIntoReorderableSections(NESTED_CONTENT, NESTED_HEADINGS);
      const rows = flattenHeadingTree(split);
      expect(rows.map((row) => [row.section.headingText, row.depth, row.canMoveUp, row.canMoveDown])).toStrictEqual([
        ['A', 0, false, true],
        ['A.1', 1, false, true],
        ['A.2', 1, true, false],
        ['B', 0, true, false]
      ]);
    });

    it('should skip a node whose section index is out of range', () => {
      const split = castTo<SplitReorderableSectionsResult>({
        preamble: '',
        roots: [{ children: [], index: 5 }],
        sections: []
      });
      expect(flattenHeadingTree(split)).toHaveLength(0);
    });
  });

  describe('flattenTreeToOrder', () => {
    it('should return the depth-first pre-order of section indices', () => {
      const split = splitIntoReorderableSections(NESTED_CONTENT, NESTED_HEADINGS);
      expect(flattenTreeToOrder(split.roots)).toStrictEqual([0, 1, 2, 3]);
    });
  });

  describe('moveSibling', () => {
    it('should swap a top-level section down with its next sibling', () => {
      const split = splitIntoReorderableSections(NESTED_CONTENT, NESTED_HEADINGS);
      expect(moveSibling(split.roots, 0, 1)).toBe(true);
      expect(flattenTreeToOrder(split.roots)).toStrictEqual([3, 0, 1, 2]);
    });

    it('should swap a nested section without affecting other branches', () => {
      const split = splitIntoReorderableSections(NESTED_CONTENT, NESTED_HEADINGS);
      expect(moveSibling(split.roots, 1, 1)).toBe(true);
      expect(flattenTreeToOrder(split.roots)).toStrictEqual([0, 2, 1, 3]);
    });

    it('should not move above the first sibling', () => {
      const split = splitIntoReorderableSections(NESTED_CONTENT, NESTED_HEADINGS);
      expect(moveSibling(split.roots, 0, -1)).toBe(false);
      expect(flattenTreeToOrder(split.roots)).toStrictEqual([0, 1, 2, 3]);
    });

    it('should not move below the last sibling', () => {
      const split = splitIntoReorderableSections(NESTED_CONTENT, NESTED_HEADINGS);
      expect(moveSibling(split.roots, 3, 1)).toBe(false);
    });

    it('should return false when the index is not in the tree', () => {
      const split = splitIntoReorderableSections(NESTED_CONTENT, NESTED_HEADINGS);
      expect(moveSibling(split.roots, 999, 1)).toBe(false);
    });
  });

  describe('joinReorderedSections', () => {
    it('should rebuild the note with a top-level section moved, keeping its descendants with it', () => {
      const split = splitIntoReorderableSections(NESTED_CONTENT, NESTED_HEADINGS);
      const result = joinReorderedSections(split, [3, 0, 1, 2]);
      expect(result).toBe('intro\n\n# B\nbbb\n\n# A\naaa\n\n## A.1\na1\n\n## A.2\na2\n');
    });

    it('should rebuild the note with a nested section reordered', () => {
      const split = splitIntoReorderableSections(NESTED_CONTENT, NESTED_HEADINGS);
      const result = joinReorderedSections(split, [0, 2, 1, 3]);
      expect(result.indexOf('## A.2')).toBeLessThan(result.indexOf('## A.1'));
      expect(result.indexOf('# A')).toBeLessThan(result.indexOf('## A.2'));
      expect(result.indexOf('## A.1')).toBeLessThan(result.indexOf('# B'));
    });

    it('should emit no leading preamble when the note starts with a heading', () => {
      const content = '# X\nx\n\n# Y\ny\n';
      const split = splitIntoReorderableSections(content, parseHeadings(content));
      const result = joinReorderedSections(split, [1, 0]);
      expect(result).toBe('# Y\ny\n\n# X\nx\n');
    });

    it('should skip an out-of-range index defensively', () => {
      const split = splitIntoReorderableSections(NESTED_CONTENT, NESTED_HEADINGS);
      const result = joinReorderedSections(split, [0, 1, 2, 3, 99]);
      expect(result).toContain('# A');
      expect(result).toContain('# B');
    });
  });
});
