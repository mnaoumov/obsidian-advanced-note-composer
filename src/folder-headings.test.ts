import {
  describe,
  expect,
  it
} from 'vitest';

import type { FolderHeadingPlanItem } from './folder-headings.ts';

import {
  buildFolderHeadingPlan,
  demoteHeadings
} from './folder-headings.ts';

interface EntrySummary {
  depth: number;
  headings: string[];
}

interface PlanSummary {
  entries: EntrySummary[];
  trailingHeadings: string[];
}

describe('buildFolderHeadingPlan', () => {
  function folder(path: string): FolderHeadingPlanItem {
    return { isFolder: true, path };
  }

  // Every folder down to (and including) the last segment, outermost first — what the walk visits before
  // Reaching a note that deep.
  function folderChain(rootPath: string, ...names: string[]): FolderHeadingPlanItem[] {
    return names.map((_name, index) => folder([rootPath, ...names.slice(0, index + 1)].join('/')));
  }

  function note(path: string): FolderHeadingPlanItem {
    return { isFolder: false, path };
  }

  function plan(items: FolderHeadingPlanItem[], rootPath = 'Docs'): PlanSummary {
    const folderHeadingPlan = buildFolderHeadingPlan({ items, rootPath });
    return {
      entries: folderHeadingPlan.entries.map((entry) => ({ depth: entry.depth, headings: [...entry.headings] })),
      trailingHeadings: [...folderHeadingPlan.trailingHeadings]
    };
  }

  it('should give a note directly inside the merged folder no heading', () => {
    expect(plan([note('Docs/intro.md')])).toEqual({
      entries: [{ depth: 0, headings: [] }],
      trailingHeadings: []
    });
  });

  it('should head a direct sub-folder at level one', () => {
    expect(plan([folder('Docs/api'), note('Docs/api/get.md')])).toEqual({
      entries: [{ depth: 1, headings: ['# api'] }],
      trailingHeadings: []
    });
  });

  it('should deepen the heading level with the folder depth', () => {
    expect(plan([...folderChain('Docs', 'api', 'v2'), note('Docs/api/v2/put.md')])).toEqual({
      entries: [{ depth: 2, headings: ['# api', '## v2'] }],
      trailingHeadings: []
    });
  });

  it('should head a folder once for all its notes', () => {
    expect(plan([folder('Docs/api'), note('Docs/api/get.md'), note('Docs/api/post.md')])).toEqual({
      entries: [
        { depth: 1, headings: ['# api'] },
        { depth: 1, headings: [] }
      ],
      trailingHeadings: []
    });
  });

  it('should emit only the newly entered folders when descending', () => {
    expect(plan([folder('Docs/api'), note('Docs/api/get.md'), folder('Docs/api/v2'), note('Docs/api/v2/put.md')])).toEqual({
      entries: [
        { depth: 1, headings: ['# api'] },
        { depth: 2, headings: ['## v2'] }
      ],
      trailingHeadings: []
    });
  });

  it('should re-head a sibling folder after leaving the previous one', () => {
    expect(plan([
      ...folderChain('Docs', 'api', 'v2'),
      note('Docs/api/v2/put.md'),
      folder('Docs/guides'),
      note('Docs/guides/start.md')
    ])).toEqual({
      entries: [
        { depth: 2, headings: ['# api', '## v2'] },
        { depth: 1, headings: ['# guides'] }
      ],
      trailingHeadings: []
    });
  });

  it('should emit nothing extra when climbing back to an already-open folder', () => {
    // The real walk takes a folder's own notes before its sub-folders, so it never climbs back; this
    // Guards the plan against an input that does.
    expect(plan([...folderChain('Docs', 'api', 'v2'), note('Docs/api/v2/put.md'), note('Docs/api/get.md')])).toEqual({
      entries: [
        { depth: 2, headings: ['# api', '## v2'] },
        { depth: 1, headings: [] }
      ],
      trailingHeadings: []
    });
  });

  it('should keep deepening past the deepest markdown heading', () => {
    /*
     * Issue #160: markdown stops at six, but clamping there made every folder from depth 6 downward
     * share `######`, so an ancestor and its descendants read as siblings. The depth is encoded instead.
     */
    expect(plan([...folderChain('Docs', 'a', 'b', 'c', 'd', 'e', 'f', 'g'), note('Docs/a/b/c/d/e/f/g/note.md')])).toEqual({
      entries: [{ depth: 7, headings: ['# a', '## b', '### c', '#### d', '##### e', '###### f', '####### g'] }],
      trailingHeadings: []
    });
  });

  it('should keep sibling folders distinguishable past six levels', () => {
    expect(plan([
      ...folderChain('Docs', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'),
      note('Docs/a/b/c/d/e/f/g/h/deep.md'),
      folder('Docs/a/b/c/d/e/f/i'),
      note('Docs/a/b/c/d/e/f/i/other.md')
    ])).toEqual({
      entries: [
        { depth: 8, headings: ['# a', '## b', '### c', '#### d', '##### e', '###### f', '####### g', '######## h'] },
        { depth: 7, headings: ['####### i'] }
      ],
      trailingHeadings: []
    });
  });

  it('should measure depth below a nested merged folder', () => {
    expect(plan([folder('top/Docs/api'), note('top/Docs/api/get.md')], 'top/Docs')).toEqual({
      entries: [{ depth: 1, headings: ['# api'] }],
      trailingHeadings: []
    });
  });

  it('should treat a path outside the merged folder as relative to the vault root', () => {
    // Defensive: the caller always passes descendants, so this only guards against a stray path.
    expect(plan([note('Other/note.md')])).toEqual({
      entries: [{ depth: 1, headings: ['# Other'] }],
      trailingHeadings: []
    });
  });

  it('should return an empty plan for no items', () => {
    expect(plan([])).toEqual({ entries: [], trailingHeadings: [] });
  });

  it('should head a folder that holds no notes at all, after the last note (issue #168)', () => {
    // The reporter's vault: the merged folder's last sub-folder is empty, so no note path mentions it.
    expect(plan([folder('Docs/api'), note('Docs/api/get.md'), folder('Docs/empty')])).toEqual({
      entries: [{ depth: 1, headings: ['# api'] }],
      trailingHeadings: ['# empty']
    });
  });

  it('should head an empty folder in place when notes follow it', () => {
    expect(plan([folder('Docs/empty'), folder('Docs/guides'), note('Docs/guides/start.md')])).toEqual({
      entries: [{ depth: 1, headings: ['# empty', '# guides'] }],
      trailingHeadings: []
    });
  });

  it('should head a whole note-less subtree', () => {
    expect(plan([note('Docs/intro.md'), ...folderChain('Docs', 'empty', 'deeper')])).toEqual({
      entries: [{ depth: 0, headings: [] }],
      trailingHeadings: ['# empty', '## deeper']
    });
  });

  it('should head an empty folder with no notes anywhere in the merged folder', () => {
    expect(plan([folder('Docs/empty')])).toEqual({ entries: [], trailingHeadings: ['# empty'] });
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
