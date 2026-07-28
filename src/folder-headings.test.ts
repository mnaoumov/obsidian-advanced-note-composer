import {
  describe,
  expect,
  it
} from 'vitest';

import {
  buildFolderHeadingPlan,
  demoteHeadings
} from './folder-headings.ts';

interface PlanSummary {
  depth: number;
  headings: string[];
}

describe('buildFolderHeadingPlan', () => {
  function plan(filePaths: string[], rootPath = 'Docs'): PlanSummary[] {
    return buildFolderHeadingPlan({ filePaths, rootPath })
      .map((entry) => ({ depth: entry.depth, headings: [...entry.headings] }));
  }

  it('should give a note directly inside the merged folder no heading', () => {
    expect(plan(['Docs/intro.md'])).toEqual([{ depth: 0, headings: [] }]);
  });

  it('should head a direct sub-folder at level one', () => {
    expect(plan(['Docs/api/get.md'])).toEqual([{ depth: 1, headings: ['# api'] }]);
  });

  it('should deepen the heading level with the folder depth', () => {
    expect(plan(['Docs/api/v2/put.md'])).toEqual([{ depth: 2, headings: ['# api', '## v2'] }]);
  });

  it('should head a folder once for all its notes', () => {
    expect(plan(['Docs/api/get.md', 'Docs/api/post.md'])).toEqual([
      { depth: 1, headings: ['# api'] },
      { depth: 1, headings: [] }
    ]);
  });

  it('should emit only the newly entered folders when descending', () => {
    expect(plan(['Docs/api/get.md', 'Docs/api/v2/put.md'])).toEqual([
      { depth: 1, headings: ['# api'] },
      { depth: 2, headings: ['## v2'] }
    ]);
  });

  it('should re-head a sibling folder after leaving the previous one', () => {
    expect(plan(['Docs/api/v2/put.md', 'Docs/guides/start.md'])).toEqual([
      { depth: 2, headings: ['# api', '## v2'] },
      { depth: 1, headings: ['# guides'] }
    ]);
  });

  it('should emit nothing extra when climbing back to an already-open folder', () => {
    expect(plan(['Docs/api/v2/put.md', 'Docs/api/get.md'])).toEqual([
      { depth: 2, headings: ['# api', '## v2'] },
      { depth: 1, headings: [] }
    ]);
  });

  it('should keep deepening past the deepest markdown heading', () => {
    /*
     * Issue #160: markdown stops at six, but clamping there made every folder from depth 6 downward
     * share `######`, so an ancestor and its descendants read as siblings. The depth is encoded instead.
     */
    const deepPath = 'Docs/a/b/c/d/e/f/g/note.md';
    const entry = buildFolderHeadingPlan({ filePaths: [deepPath], rootPath: 'Docs' })[0];
    expect(entry?.headings).toEqual(['# a', '## b', '### c', '#### d', '##### e', '###### f', '####### g']);
    expect(entry?.depth).toBe(7);
  });

  it('should keep sibling folders distinguishable past six levels', () => {
    expect(plan(['Docs/a/b/c/d/e/f/g/h/deep.md', 'Docs/a/b/c/d/e/f/i/other.md'])).toEqual([
      { depth: 8, headings: ['# a', '## b', '### c', '#### d', '##### e', '###### f', '####### g', '######## h'] },
      { depth: 7, headings: ['####### i'] }
    ]);
  });

  it('should measure depth below a nested merged folder', () => {
    expect(plan(['top/Docs/api/get.md'], 'top/Docs')).toEqual([{ depth: 1, headings: ['# api'] }]);
  });

  it('should treat a path outside the merged folder as relative to the vault root', () => {
    // Defensive: the caller always passes descendants, so this only guards against a stray path.
    expect(plan(['Other/note.md'])).toEqual([{ depth: 1, headings: ['# Other'] }]);
  });

  it('should return an empty plan for no files', () => {
    expect(plan([])).toEqual([]);
  });
});

describe('demoteHeadings', () => {
  it('should return the content untouched for a zero shift', () => {
    expect(demoteHeadings('# Title', 0)).toBe('# Title');
  });

  it('should return the content untouched for a negative shift', () => {
    expect(demoteHeadings('# Title', -1)).toBe('# Title');
  });

  it('should demote a heading by the shift', () => {
    expect(demoteHeadings('# Title', 2)).toBe('### Title');
  });

  it('should demote every heading in the content', () => {
    expect(demoteHeadings('# A\nbody\n## B', 1)).toBe('## A\nbody\n### B');
  });

  it('should demote past the deepest markdown heading rather than clamping', () => {
    /*
     * Clamping put the note's own top heading at the level its folder heading already held, making the
     * note's outline a sibling of its own folder — starting at depth six, inside markdown's own range.
     */
    expect(demoteHeadings('##### Deep', 3)).toBe('######## Deep');
  });

  it('should keep a note outline nested below its folder heading at depth six', () => {
    expect(demoteHeadings('# Top\n## Sub', 6)).toBe('####### Top\n######## Sub');
  });

  it('should demote a heading deeper than six so a re-merge keeps the relative order', () => {
    // `buildFolderHeadingPlan` emits these, so a merged note carries them into a second merge.
    expect(demoteHeadings('####### Deep', 1)).toBe('######## Deep');
  });

  it('should keep non-heading lines as they are', () => {
    expect(demoteHeadings('plain\n#not-a-heading\n', 1)).toBe('plain\n#not-a-heading\n');
  });

  it('should demote a bare heading with no text', () => {
    expect(demoteHeadings('#', 1)).toBe('##');
  });

  it('should preserve the indentation of an indented heading', () => {
    expect(demoteHeadings('   # Title', 1)).toBe('   ## Title');
  });

  it('should leave a hash line inside a backtick fence alone', () => {
    expect(demoteHeadings('```sh\n# comment\n```\n# Title', 1)).toBe('```sh\n# comment\n```\n## Title');
  });

  it('should leave a hash line inside a tilde fence alone', () => {
    expect(demoteHeadings('~~~\n# comment\n~~~\n# Title', 1)).toBe('~~~\n# comment\n~~~\n## Title');
  });

  it('should not close a backtick fence with a tilde fence', () => {
    expect(demoteHeadings('```\n~~~\n# comment\n```\n# Title', 1)).toBe('```\n~~~\n# comment\n```\n## Title');
  });

  it('should not close a fence with a shorter run of the same character', () => {
    expect(demoteHeadings('````\n```\n# comment\n````\n# Title', 1)).toBe('````\n```\n# comment\n````\n## Title');
  });

  it('should leave headings alone in an unterminated fence', () => {
    expect(demoteHeadings('```\n# comment\n# more', 1)).toBe('```\n# comment\n# more');
  });
});
