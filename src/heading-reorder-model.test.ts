import type { HeadingCache } from 'obsidian';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { SplitReorderableSectionsResult } from './heading-sections.ts';

import { HeadingReorderModel } from './heading-reorder-model.ts';
import {
  flattenTreeToOrder,
  joinReorderedSections,
  splitIntoReorderableSections
} from './heading-sections.ts';
import { ReorderDropPlacement } from './modals/reorder-modal.ts';

const NESTED_NOTE = '# A\n\n## A.1\na1\n\n## A.2\na2\n\n# B\nbbb\n';

// The reporter's own sample (issue #295): two parents with two children each.
const REPORTER_NOTE = '# A\na\n\n## A1\na1\n\n## A2\na2\n\n# B\nb\n\n## B1\nb1\n\n## B2\nb2\n';

const LCG_MULTIPLIER = 1_103_515_245;
const LCG_INCREMENT = 12_345;
const LCG_MODULUS = 2_147_483_648;
const PROPERTY_STEP_COUNT = 400;
const OPERATION_KIND_COUNT = 4;
const MIN_PROPERTY_MOVE_COUNT = 100;
const PLACEMENTS = [ReorderDropPlacement.After, ReorderDropPlacement.Before, ReorderDropPlacement.Inside];

interface ModelFixture {
  readonly model: HeadingReorderModel;
  readonly split: SplitReorderableSectionsResult;
}

function createFixture(content: string): ModelFixture {
  const split = splitIntoReorderableSections(content, parseHeadings(content));
  return { model: new HeadingReorderModel({ numbering: null, split }), split };
}

function createModel(content: string): HeadingReorderModel {
  return createFixture(content).model;
}

function id(model: HeadingReorderModel, dataLabel: string): number {
  return ensureNonNullable(model.buildRows().find((row) => row.dataLabel === dataLabel)).id;
}

function parseHeadings(content: string): HeadingCache[] {
  const headings: HeadingCache[] = [];
  let offset = 0;
  for (const line of content.split('\n')) {
    const match = /^(?<Hashes>#+)\s+(?<Text>.*)$/.exec(line);
    const hashes = match?.groups?.['Hashes'];
    const text = match?.groups?.['Text'];
    if (hashes !== undefined && text !== undefined) {
      headings.push(castTo<HeadingCache>({
        heading: text,
        level: hashes.length,
        position: { start: { offset } }
      }));
    }
    offset += line.length + 1;
  }
  return headings;
}

function rows(model: HeadingReorderModel): string[] {
  return model.buildRows().map((row) => `${row.depth.toString()}:${row.label}`);
}

function write(split: SplitReorderableSectionsResult): string {
  return joinReorderedSections(split, flattenTreeToOrder(split.roots));
}

describe('HeadingReorderModel', () => {
  it('should render the tree as indented rows carrying their heading level', () => {
    expect(rows(createModel(NESTED_NOTE))).toEqual(['0:# A', '1:## A.1', '1:## A.2', '0:# B']);
  });

  it('should identify each row by its heading text alone', () => {
    expect(createModel(NESTED_NOTE).buildRows().map((row) => row.dataLabel)).toEqual(['A', 'A.1', 'A.2', 'B']);
  });

  it('should number nothing, since reordering headings renames nothing', () => {
    expect(createModel(NESTED_NOTE).buildRows().every((row) => row.indexLabel === null)).toBe(true);
  });

  it('should preview the number each heading will carry, and follow a move (issue #295)', () => {
    const split = splitIntoReorderableSections(NESTED_NOTE, parseHeadings(NESTED_NOTE));
    const numbering = { shouldNumber: true, template: '{{index}}. {{headingText}}', wasNumbered: false };
    const model = new HeadingReorderModel({ numbering, split });
    expect(rows(model)).toEqual(['0:# 1. A', '1:## 1. A.1', '1:## 2. A.2', '0:# 2. B']);

    model.didMove({ delta: -1, id: id(model, 'B') });
    expect(rows(model)).toEqual(['0:# 1. B', '0:# 2. A', '1:## 1. A.1', '1:## 2. A.2']);

    numbering.shouldNumber = false;
    expect(rows(model)).toEqual(['0:# B', '0:# A', '1:## A.1', '1:## A.2']);
  });

  it('should put every heading in one group, so a drag can reach any heading (issue #295)', () => {
    expect(new Set(createModel(NESTED_NOTE).buildRows().map((row) => row.groupKey)).size).toBe(1);
  });

  it('should be nestable and render no group headers', () => {
    const model = createModel(NESTED_NOTE);
    expect(model.isNestable).toBe(true);
    expect(model.getGroupTitle('headings')).toBeNull();
  });

  it('should offer indent only below a sibling and outdent only under a parent', () => {
    expect(createModel(NESTED_NOTE).buildRows().map((row) => [row.dataLabel, row.canIndent, row.canOutdent])).toEqual([
      ['A', false, false],
      ['A.1', false, true],
      ['A.2', true, true],
      ['B', true, false]
    ]);
  });

  describe('didMove', () => {
    it('should move a heading among its siblings, carrying everything nested under it', () => {
      const model = createModel(NESTED_NOTE);
      expect(model.didMove({ delta: 1, id: id(model, 'A') })).toBe(true);
      expect(model.buildRows().map((row) => row.dataLabel)).toEqual(['B', 'A', 'A.1', 'A.2']);
    });

    it('should move a heading up before its previous sibling', () => {
      const model = createModel(NESTED_NOTE);
      expect(model.didMove({ delta: -1, id: id(model, 'A.2') })).toBe(true);
      expect(model.buildRows().map((row) => row.dataLabel)).toEqual(['A', 'A.2', 'A.1', 'B']);
    });

    it('should refuse a move past the end of a sibling list', () => {
      const model = createModel(NESTED_NOTE);
      expect(model.didMove({ delta: 1, id: id(model, 'B') })).toBe(false);
    });

    it('should refuse to move a heading that is not in the tree', () => {
      expect(createModel(NESTED_NOTE).didMove({ delta: 1, id: -1 })).toBe(false);
    });

    it('should give a swapped heading its neighbor\'s level, so mixed-level siblings do not nest on write', () => {
      const { model, split } = createFixture('# P\n\n### x\n\n## y\n');
      expect(model.didMove({ delta: -1, id: id(model, 'y') })).toBe(true);
      expect(write(split)).toBe('# P\n\n### y\n\n### x\n');
    });
  });

  describe('didMoveTo', () => {
    it('should drop a heading before or after one of its own siblings', () => {
      const before = createModel(NESTED_NOTE);
      expect(before.didMoveTo({ id: id(before, 'A.2'), placement: ReorderDropPlacement.Before, targetId: id(before, 'A.1') })).toBe(true);
      expect(before.buildRows().map((row) => row.dataLabel)).toEqual(['A', 'A.2', 'A.1', 'B']);

      const after = createModel(NESTED_NOTE);
      expect(after.didMoveTo({ id: id(after, 'A.1'), placement: ReorderDropPlacement.After, targetId: id(after, 'A.2') })).toBe(true);
      expect(after.buildRows().map((row) => row.dataLabel)).toEqual(['A', 'A.2', 'A.1', 'B']);
    });

    it('should move a sub-heading under a different parent, as in the reporter\'s video (issue #295)', () => {
      const { model, split } = createFixture(REPORTER_NOTE);
      expect(model.didMoveTo({ id: id(model, 'A1'), placement: ReorderDropPlacement.Before, targetId: id(model, 'B2') })).toBe(true);
      expect(rows(model)).toEqual(['0:# A', '1:## A2', '0:# B', '1:## B1', '1:## A1', '1:## B2']);
      expect(write(split)).toBe('# A\na\n\n## A2\na2\n\n# B\nb\n\n## B1\nb1\n\n## A1\na1\n\n## B2\nb2\n');
    });

    it('should re-level a larger heading and its subtree when it moves under a junior one', () => {
      const { model, split } = createFixture(REPORTER_NOTE);
      expect(model.didMoveTo({ id: id(model, 'A'), placement: ReorderDropPlacement.Inside, targetId: id(model, 'B1') })).toBe(true);
      expect(rows(model)).toEqual(['0:# B', '1:## B1', '2:### A', '3:#### A1', '3:#### A2', '1:## B2']);
      expect(write(split)).toBe('# B\nb\n\n## B1\nb1\n\n### A\na\n\n#### A1\na1\n\n#### A2\na2\n\n## B2\nb2\n');
    });

    it('should drop inside a heading as its first child, taking that child\'s level', () => {
      const { model } = createFixture('# A\n\n### deep\n\n# B\n');
      expect(model.didMoveTo({ id: id(model, 'B'), placement: ReorderDropPlacement.Inside, targetId: id(model, 'A') })).toBe(true);
      expect(rows(model)).toEqual(['0:# A', '1:### B', '1:### deep']);
    });

    it('should land a drop just below a heading with children as its first child', () => {
      const { model } = createFixture(REPORTER_NOTE);
      expect(model.didMoveTo({ id: id(model, 'B2'), placement: ReorderDropPlacement.After, targetId: id(model, 'A') })).toBe(true);
      expect(rows(model).slice(0, 2)).toEqual(['0:# A', '1:## B2']);
    });

    it('should lift a sub-heading to the top level beside a top-level heading', () => {
      const { model } = createFixture(REPORTER_NOTE);
      expect(model.didMoveTo({ id: id(model, 'A2'), placement: ReorderDropPlacement.After, targetId: id(model, 'B2') })).toBe(true);
      expect(rows(model).at(-1)).toBe('1:## A2');
      const { model: rootModel } = createFixture(REPORTER_NOTE);
      expect(rootModel.didMoveTo({ id: id(rootModel, 'A2'), placement: ReorderDropPlacement.Before, targetId: id(rootModel, 'B') })).toBe(true);
      expect(rows(rootModel)).toEqual(['0:# A', '1:## A1', '0:# A2', '0:# B', '1:## B1', '1:## B2']);
    });

    it('should refuse a drop into the heading\'s own subtree, or onto itself', () => {
      const model = createModel(REPORTER_NOTE);
      expect(model.canMoveTo({ id: id(model, 'A'), placement: ReorderDropPlacement.Inside, targetId: id(model, 'A1') })).toBe(false);
      expect(model.canMoveTo({ id: id(model, 'A'), placement: ReorderDropPlacement.Before, targetId: id(model, 'A') })).toBe(false);
    });

    it('should refuse a drop that changes nothing', () => {
      const model = createModel(NESTED_NOTE);
      expect(model.didMoveTo({ id: id(model, 'A.1'), placement: ReorderDropPlacement.Before, targetId: id(model, 'A.2') })).toBe(false);
      expect(model.didMoveTo({ id: id(model, 'A.1'), placement: ReorderDropPlacement.Inside, targetId: id(model, 'A') })).toBe(false);
    });

    it('should refuse to move a heading that is not in the tree, or onto one', () => {
      const model = createModel(NESTED_NOTE);
      expect(model.didMoveTo({ id: -1, placement: ReorderDropPlacement.Before, targetId: 0 })).toBe(false);
      expect(model.didMoveTo({ id: 0, placement: ReorderDropPlacement.Before, targetId: -1 })).toBe(false);
    });

    it('should refuse a move that would push a heading past level 6', () => {
      const model = createModel('# A\n\n##### deep\n\n# B\n\n## C\n');
      expect(model.canMoveTo({ id: id(model, 'A'), placement: ReorderDropPlacement.Inside, targetId: id(model, 'C') })).toBe(false);
      expect(model.canMoveTo({ id: id(model, 'A'), placement: ReorderDropPlacement.Inside, targetId: id(model, 'B') })).toBe(true);
    });
  });

  describe('didChangeDepth', () => {
    it('should indent a heading under the heading above it, as that heading\'s last child', () => {
      const { model, split } = createFixture(REPORTER_NOTE);
      expect(model.didChangeDepth({ delta: 1, id: id(model, 'B') })).toBe(true);
      expect(rows(model)).toEqual(['0:# A', '1:## A1', '1:## A2', '1:## B', '2:### B1', '2:### B2']);
      expect(write(split)).toContain('## A2\na2\n\n## B\nb\n\n### B1\nb1');
    });

    it('should indent under a childless heading one level deeper than it', () => {
      const { model } = createFixture('# A\n\n# B\n');
      expect(model.didChangeDepth({ delta: 1, id: id(model, 'B') })).toBe(true);
      expect(rows(model)).toEqual(['0:# A', '1:## B']);
    });

    it('should outdent a heading to right after its parent, at the parent\'s level', () => {
      const { model } = createFixture(REPORTER_NOTE);
      expect(model.didChangeDepth({ delta: -1, id: id(model, 'A1') })).toBe(true);
      expect(rows(model)).toEqual(['0:# A', '1:## A2', '0:# A1', '0:# B', '1:## B1', '1:## B2']);
    });

    it('should refuse to indent the first sibling or outdent a top-level heading', () => {
      const model = createModel(REPORTER_NOTE);
      expect(model.didChangeDepth({ delta: 1, id: id(model, 'A') })).toBe(false);
      expect(model.didChangeDepth({ delta: -1, id: id(model, 'A') })).toBe(false);
      expect(model.didChangeDepth({ delta: 1, id: -1 })).toBe(false);
    });
  });

  it('should mutate the caller\'s own tree and levels, which is how the confirmed order is read back', () => {
    const { model, split } = createFixture(NESTED_NOTE);
    model.didMove({ delta: 1, id: id(model, 'A') });
    model.didChangeDepth({ delta: 1, id: id(model, 'A') });
    expect(flattenTreeToOrder(split.roots)).toEqual([3, 0, 1, 2]);
    expect(split.levels).toEqual([2, 3, 3, 1]);
  });

  it('should always write a note that re-parses to the tree the modal showed', () => {
    const { model, split } = createFixture('intro\n\n## P\n\n#### skipped\n\n### q\n\n# R\n\n## S\n\n### T\n\n#### U\n\n## V\n');
    let seed = 1;
    function next(bound: number): number {
      seed = (seed * LCG_MULTIPLIER + LCG_INCREMENT) % LCG_MODULUS;
      // The high bits: the low bits of a power-of-two LCG cycle with a tiny period.
      return Math.floor(seed / LCG_MODULUS * bound);
    }

    let moveCount = 0;
    for (let step = 0; step < PROPERTY_STEP_COUNT; step++) {
      const ids = model.buildRows().map((row) => row.id);
      const rowId = ensureNonNullable(ids[next(ids.length)]);
      const targetId = ensureNonNullable(ids[next(ids.length)]);
      const delta = next(2) === 0 ? -1 : 1;
      const placement = ensureNonNullable(PLACEMENTS[next(PLACEMENTS.length)]);
      const operations = [
        (): boolean => model.didMove({ delta, id: rowId }),
        (): boolean => model.didChangeDepth({ delta, id: rowId }),
        (): boolean => model.didMoveTo({ id: rowId, placement, targetId }),
        (): boolean => model.didMoveTo({ id: rowId, placement, targetId })
      ];
      if (!ensureNonNullable(operations[next(OPERATION_KIND_COUNT)])()) {
        continue;
      }
      moveCount++;

      const written = write(split);
      expect(rows(createModel(written))).toEqual(rows(model));
    }
    expect(moveCount).toBeGreaterThan(MIN_PROPERTY_MOVE_COUNT);
  });
});
