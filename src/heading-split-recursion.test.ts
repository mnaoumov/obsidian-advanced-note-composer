import type { HeadingCache } from 'obsidian';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it
} from 'vitest';

import {
  buildRecursiveSplitPreviewRows,
  findNextHeadingToSplit,
  getHeadingSubtree,
  MAX_HEADING_LEVEL
} from './heading-split-recursion.ts';

const CONTENT = [
  '# A',
  '',
  'intro',
  '',
  '## B',
  '',
  'b body',
  '',
  '### C',
  '',
  'c body',
  '',
  '## D',
  '',
  'd body',
  ''
].join('\n');

function createHeading(level: number, headingText: string, offset: number): HeadingCache {
  return strictProxy<HeadingCache>({
    heading: headingText,
    level,
    position: {
      end: { col: 0, line: 0, offset: offset + level + 1 + headingText.length },
      start: { col: 0, line: 0, offset }
    }
  });
}

function createHeadingOnLine(level: number, headingText: string, line: number): HeadingCache {
  return strictProxy<HeadingCache>({
    heading: headingText,
    level,
    position: {
      end: { col: 0, line, offset: 0 },
      start: { col: 0, line, offset: 0 }
    }
  });
}

function createHeadings(): HeadingCache[] {
  return [
    createHeading(1, 'A', CONTENT.indexOf('# A')),
    createHeading(2, 'B', CONTENT.indexOf('## B')),
    createHeading(3, 'C', CONTENT.indexOf('### C')),
    createHeading(2, 'D', CONTENT.indexOf('## D'))
  ];
}

/**
 * The same `# A` / `## B` / `### C` / `## D` note, but positioned by LINE — which is what
 * {@link getHeadingSubtree} matches on (the cursor gives a line, not an offset).
 *
 * @returns The headings, in document order.
 */
function createLineHeadings(): HeadingCache[] {
  return [
    createHeadingOnLine(1, 'A', 0),
    createHeadingOnLine(2, 'B', 4),
    createHeadingOnLine(3, 'C', 8),
    createHeadingOnLine(2, 'D', 12)
  ];
}

describe('findNextHeadingToSplit', () => {
  it('should return null when there are no headings', () => {
    expect(findNextHeadingToSplit([], 1)).toBeNull();
  });

  it('should return null when every heading is above the minimum level', () => {
    // Recursing into an extracted note passes `minLevel` past that note's own title heading; when nothing
    // Deeper is left, there is nothing more to split.
    expect(findNextHeadingToSplit([createHeading(1, 'A', 0), createHeading(2, 'B', 10)], 3)).toBeNull();
  });

  it('should return the first heading of the shallowest level', () => {
    const headings = createHeadings();
    expect(findNextHeadingToSplit(headings, 1)).toBe(headings[0]);
  });

  it('should skip the note own title heading when the minimum level excludes it', () => {
    // The extracted note still begins with `# A`, so recursing with `minLevel` 2 must pick `## B`, not `# A`
    // (which would extract the whole note into a nested copy of itself).
    const headings = createHeadings();
    expect(findNextHeadingToSplit(headings, 2)).toBe(headings[1]);
  });

  it('should return the first sibling when several headings share the shallowest level', () => {
    const headings = createHeadings();
    // `B` and `D` are both H2; `B` comes first in document order.
    expect(findNextHeadingToSplit(headings, 2)?.heading).toBe('B');
  });

  it('should pick the shallowest level present even when levels are skipped', () => {
    // An H1 whose only sub-headings are H3s: recursing with `minLevel` 2 must still find the H3.
    const headings = [createHeading(1, 'A', 0), createHeading(3, 'C', 10)];
    expect(findNextHeadingToSplit(headings, 2)).toBe(headings[1]);
  });

  it('should ignore document order when a deeper heading precedes a shallower one', () => {
    const headings = [createHeading(3, 'C', 0), createHeading(1, 'A', 10)];
    expect(findNextHeadingToSplit(headings, 1)).toBe(headings[1]);
  });
});

describe('buildRecursiveSplitPreviewRows', () => {
  it('should return no rows when the note has no headings', () => {
    expect(buildRecursiveSplitPreviewRows('just text\n', [])).toEqual([]);
  });

  it('should list every heading with its nesting depth', () => {
    expect(buildRecursiveSplitPreviewRows(CONTENT, createHeadings())).toEqual([
      { depth: 0, headingText: 'A' },
      { depth: 1, headingText: 'B' },
      { depth: 2, headingText: 'C' },
      { depth: 1, headingText: 'D' }
    ]);
  });

  it('should report the depth a skipped level actually nests at, not its heading level', () => {
    const content = '# A\n\n### C\n';
    const headings = [createHeading(1, 'A', 0), createHeading(3, 'C', content.indexOf('### C'))];
    expect(buildRecursiveSplitPreviewRows(content, headings)).toEqual([
      { depth: 0, headingText: 'A' },
      { depth: 1, headingText: 'C' }
    ]);
  });
});

describe('getHeadingSubtree', () => {
  it('should return nothing when no heading starts on that line', () => {
    expect(getHeadingSubtree(createLineHeadings(), 3)).toEqual([]);
  });

  it('should return nothing when the note has no headings', () => {
    expect(getHeadingSubtree([], 0)).toEqual([]);
  });

  it('should return the heading and everything nested under it', () => {
    // `B` owns `C`, and stops at `D` — its own H2 sibling.
    expect(getHeadingSubtree(createLineHeadings(), 4).map((heading) => heading.heading)).toEqual(['B', 'C']);
  });

  it('should stop at a heading of the same level', () => {
    // `D` is the last H2 and has nothing under it, so the subtree is `D` alone.
    expect(getHeadingSubtree(createLineHeadings(), 12).map((heading) => heading.heading)).toEqual(['D']);
  });

  it('should return the whole note when the target heading is the shallowest one', () => {
    expect(getHeadingSubtree(createLineHeadings(), 0).map((heading) => heading.heading)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('should include a nested heading whose level is skipped', () => {
    // `####` under a `##` is still nested under it — the subtree is bounded by level, not by adjacency.
    const headings = [
      createHeadingOnLine(2, 'B', 0),
      createHeadingOnLine(4, 'Loose end', 4),
      createHeadingOnLine(2, 'D', 8)
    ];
    expect(getHeadingSubtree(headings, 0).map((heading) => heading.heading)).toEqual(['B', 'Loose end']);
  });

  it('should return a leaf heading on its own', () => {
    // The degenerate case the command is deliberately still offered for: it produces a single note.
    expect(getHeadingSubtree(createLineHeadings(), 8).map((heading) => heading.heading)).toEqual(['C']);
  });

  it('should stop at a shallower heading', () => {
    const headings = [
      createHeadingOnLine(3, 'C', 0),
      createHeadingOnLine(1, 'A', 4)
    ];
    expect(getHeadingSubtree(headings, 0).map((heading) => heading.heading)).toEqual(['C']);
  });
});

describe('MAX_HEADING_LEVEL', () => {
  it('should be the deepest markdown heading level', () => {
    expect(MAX_HEADING_LEVEL).toBe(6);
  });
});
