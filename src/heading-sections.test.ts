import type { HeadingCache } from 'obsidian';

import { castTo } from 'obsidian-dev-utils/object-utils';
import {
  describe,
  expect,
  it
} from 'vitest';

import {
  countReorderableSections,
  joinReorderedSections,
  splitIntoReorderableSections
} from './heading-sections.ts';

function heading(level: number, text: string, offset: number): HeadingCache {
  return castTo<HeadingCache>({
    heading: text,
    level,
    position: { start: { offset } }
  });
}

// 'intro\n\n# A\naaa\n\n## A.1\nsub\n\n# B\nbbb\n'
const CONTENT = 'intro\n\n# A\naaa\n\n## A.1\nsub\n\n# B\nbbb\n';
const HEADINGS: HeadingCache[] = [
  heading(1, 'A', 7),
  heading(2, 'A.1', 16),
  heading(1, 'B', 28)
];

describe('heading-sections', () => {
  describe('countReorderableSections', () => {
    it('should return 0 when there are no headings', () => {
      expect(countReorderableSections([])).toBe(0);
    });

    it('should count only the shallowest-level headings', () => {
      expect(countReorderableSections(HEADINGS)).toBe(2);
    });

    it('should count sections when the note starts at a deeper level', () => {
      const headings = [heading(2, 'X', 0), heading(3, 'X.1', 10), heading(2, 'Y', 20)];
      expect(countReorderableSections(headings)).toBe(2);
    });
  });

  describe('splitIntoReorderableSections', () => {
    it('should return the whole content as preamble when there are no headings', () => {
      const result = splitIntoReorderableSections('just text', []);
      expect(result.preamble).toBe('just text');
      expect(result.sections).toHaveLength(0);
    });

    it('should split into a preamble and top-level sections, keeping nested headings inside their parent', () => {
      const result = splitIntoReorderableSections(CONTENT, HEADINGS);
      expect(result.preamble).toBe('intro\n\n');
      expect(result.sections).toHaveLength(2);
      expect(result.sections[0]?.headingText).toBe('A');
      expect(result.sections[0]?.level).toBe(1);
      expect(result.sections[0]?.text).toContain('## A.1');
      expect(result.sections[1]?.headingText).toBe('B');
    });
  });

  describe('joinReorderedSections', () => {
    it('should rebuild the note with the sections reordered, preamble kept first', () => {
      const split = splitIntoReorderableSections(CONTENT, HEADINGS);
      const result = joinReorderedSections(split, [1, 0]);
      expect(result.startsWith('intro')).toBe(true);
      expect(result.indexOf('# B')).toBeLessThan(result.indexOf('# A'));
      expect(result).toContain('## A.1');
      expect(result.endsWith('\n')).toBe(true);
    });

    it('should preserve the original order when unchanged', () => {
      const split = splitIntoReorderableSections(CONTENT, HEADINGS);
      const result = joinReorderedSections(split, [0, 1]);
      expect(result.indexOf('# A')).toBeLessThan(result.indexOf('# B'));
    });

    it('should emit no leading preamble when the note starts with a heading', () => {
      const content = '# X\nx\n\n# Y\ny\n';
      const headings = [heading(1, 'X', 0), heading(1, 'Y', 7)];
      const split = splitIntoReorderableSections(content, headings);
      const result = joinReorderedSections(split, [1, 0]);
      expect(result).toBe('# Y\ny\n\n# X\nx\n');
    });

    it('should skip an out-of-range index defensively', () => {
      const split = splitIntoReorderableSections(CONTENT, HEADINGS);
      const result = joinReorderedSections(split, [0, 5]);
      expect(result).toContain('# A');
      expect(result).not.toContain('# B');
    });
  });
});
