import type { HeadingCache } from 'obsidian';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import {
  describe,
  expect,
  it
} from 'vitest';

import { HeadingReorderModel } from './heading-reorder-model.ts';
import {
  flattenTreeToOrder,
  splitIntoReorderableSections
} from './heading-sections.ts';

const NESTED_NOTE = '# A\n\n## A.1\na1\n\n## A.2\na2\n\n# B\nbbb\n';

function createModel(content: string): HeadingReorderModel {
  const split = splitIntoReorderableSections(content, parseHeadings(content));
  return new HeadingReorderModel({ split });
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

function toRowIds(model: HeadingReorderModel, dataLabels: readonly string[]): number[] {
  return dataLabels.map((dataLabel) => ensureNonNullable(model.buildRows().find((row) => row.dataLabel === dataLabel)).id);
}

describe('HeadingReorderModel', () => {
  it('should render the tree as indented rows carrying their heading level', () => {
    const model = createModel(NESTED_NOTE);
    expect(model.buildRows().map((row) => `${row.depth.toString()}:${row.label}`)).toEqual([
      '0:# A',
      '1:## A.1',
      '1:## A.2',
      '0:# B'
    ]);
  });

  it('should identify each row by its heading text alone', () => {
    const model = createModel(NESTED_NOTE);
    expect(model.buildRows().map((row) => row.dataLabel)).toEqual(['A', 'A.1', 'A.2', 'B']);
  });

  it('should number nothing, since reordering headings renames nothing', () => {
    const model = createModel(NESTED_NOTE);
    expect(model.buildRows().every((row) => row.indexLabel === null)).toBe(true);
  });

  it('should group each heading under its parent, so only siblings share a group', () => {
    const model = createModel(NESTED_NOTE);
    const groupKeys = model.buildRows().map((row) => row.groupKey);
    expect(groupKeys[0]).toBe(groupKeys[3]);
    expect(groupKeys[1]).toBe(groupKeys[2]);
    expect(groupKeys[0]).not.toBe(groupKeys[1]);
  });

  it('should render no group headers, the groups being a drag constraint rather than sections', () => {
    const model = createModel(NESTED_NOTE);
    expect(model.getGroupTitle('root')).toBeNull();
  });

  it('should move a heading among its siblings, carrying everything nested under it', () => {
    const model = createModel(NESTED_NOTE);
    const [idA] = toRowIds(model, ['A']);
    expect(model.didMove({ delta: 1, id: ensureNonNullable(idA) })).toBe(true);
    expect(model.buildRows().map((row) => row.dataLabel)).toEqual(['B', 'A', 'A.1', 'A.2']);
  });

  it('should refuse a move past the end of a sibling list', () => {
    const model = createModel(NESTED_NOTE);
    const [idB] = toRowIds(model, ['B']);
    expect(model.didMove({ delta: 1, id: ensureNonNullable(idB) })).toBe(false);
  });

  it('should drop a heading before one of its own siblings', () => {
    const model = createModel(NESTED_NOTE);
    const [idA2, idA1] = toRowIds(model, ['A.2', 'A.1']);
    expect(model.didMoveTo({ id: ensureNonNullable(idA2), isAfter: false, targetId: ensureNonNullable(idA1) })).toBe(true);
    expect(model.buildRows().map((row) => row.dataLabel)).toEqual(['A', 'A.2', 'A.1', 'B']);
  });

  it('should drop a heading after one of its own siblings', () => {
    const model = createModel(NESTED_NOTE);
    const [idA1, idA2] = toRowIds(model, ['A.1', 'A.2']);
    expect(model.didMoveTo({ id: ensureNonNullable(idA1), isAfter: true, targetId: ensureNonNullable(idA2) })).toBe(true);
    expect(model.buildRows().map((row) => row.dataLabel)).toEqual(['A', 'A.2', 'A.1', 'B']);
  });

  it('should refuse a drop onto a heading with a different parent, which would restructure the note', () => {
    const model = createModel(NESTED_NOTE);
    const [idA1, idB] = toRowIds(model, ['A.1', 'B']);
    expect(model.didMoveTo({ id: ensureNonNullable(idA1), isAfter: false, targetId: ensureNonNullable(idB) })).toBe(false);
  });

  it('should refuse a drop that changes nothing', () => {
    const model = createModel(NESTED_NOTE);
    const [idA1, idA2] = toRowIds(model, ['A.1', 'A.2']);
    expect(model.didMoveTo({ id: ensureNonNullable(idA1), isAfter: false, targetId: ensureNonNullable(idA2) })).toBe(false);
  });

  it('should refuse to move a heading that is not in the tree', () => {
    const model = createModel(NESTED_NOTE);
    expect(model.didMoveTo({ id: -1, isAfter: false, targetId: 0 })).toBe(false);
  });

  it('should mutate the caller\'s own tree, which is how the confirmed order is read back', () => {
    const content = NESTED_NOTE;
    const split = splitIntoReorderableSections(content, parseHeadings(content));
    const model = new HeadingReorderModel({ split });
    const [idA] = toRowIds(model, ['A']);
    model.didMove({ delta: 1, id: ensureNonNullable(idA) });
    expect(flattenTreeToOrder(split.roots)).toEqual([3, 0, 1, 2]);
  });
});
