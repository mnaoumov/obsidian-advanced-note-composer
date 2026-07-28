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

  it('should cap the heading level at the deepest markdown heading', () => {
    const deepPath = 'Docs/a/b/c/d/e/f/g/note.md';
    const entry = buildFolderHeadingPlan({ filePaths: [deepPath], rootPath: 'Docs' })[0];
    expect(entry?.headings.at(-1)).toBe('###### g');
    expect(entry?.headings.at(-2)).toBe('###### f');
    expect(entry?.depth).toBe(7);
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

  it('should cap the demoted level at the deepest markdown heading', () => {
    expect(demoteHeadings('##### Deep', 3)).toBe('###### Deep');
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
