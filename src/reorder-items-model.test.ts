import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import { ReorderItemsModel } from './reorder-items-model.ts';
import { ReorderItemKind } from './reorder-items.ts';

let model: ReorderItemsModel;

function toLabels(): string[] {
  return model.buildRows().map((row) => `${row.groupKey}:${row.indexLabel ?? ''}:${row.label}`);
}

beforeEach(() => {
  model = new ReorderItemsModel({
    fileItems: [
      { extension: '.md', name: '1. Notes', path: 'Parent/1. Notes.md' },
      { extension: '.md', name: 'Draft', path: 'Parent/Draft.md' }
    ],
    fileNameTemplate: '{{index}}. {{safeName}}',
    folderItems: [
      { extension: '', name: '1. Alpha', path: 'Parent/1. Alpha' },
      { extension: '', name: '2. Beta', path: 'Parent/2. Beta' },
      { extension: '', name: 'Gamma', path: 'Parent/Gamma' }
    ],
    folderNameTemplate: '{{index}}. {{safeFolderName}}',
    shouldIncludeFiles: false
  });
});

describe('ReorderItemsModel', () => {
  it('should list the folders only, labelled without their numbers and badged with the number they will get', () => {
    expect(toLabels()).toEqual([
      'folders:1:Alpha',
      'folders:2:Beta',
      'folders:3:Gamma'
    ]);
  });

  it('should add the files as their own group, numbered from 1 again', () => {
    model.setShouldIncludeFiles(true);
    expect(toLabels()).toEqual([
      'folders:1:Alpha',
      'folders:2:Beta',
      'folders:3:Gamma',
      'files:1:Notes',
      'files:2:Draft'
    ]);
  });

  it('should head each group, so the two sequences read as two sequences', () => {
    expect([model.getGroupTitle('folders'), model.getGroupTitle('files')]).toEqual(['Folders', 'Files']);
  });

  it('should mark the ends of each group as unmovable in that direction', () => {
    model.setShouldIncludeFiles(true);
    expect(model.buildRows().map((row) => `${row.canMoveUp ? 'u' : '-'}${row.canMoveDown ? 'd' : '-'}`)).toEqual([
      '-d',
      'ud',
      'u-',
      '-d',
      'u-'
    ]);
  });

  it('should move a row down among its own group', () => {
    const firstRowId = ensureRowId(0);
    model.didMove({ delta: 1, id: firstRowId });
    expect(toLabels()).toEqual([
      'folders:1:Beta',
      'folders:2:Alpha',
      'folders:3:Gamma'
    ]);
  });

  it('should refuse to move past the end of a group', () => {
    expect(model.didMove({ delta: 1, id: ensureRowId(2) })).toBe(false);
    expect(model.didMove({ delta: -1, id: ensureRowId(0) })).toBe(false);
  });

  it('should refuse to move a row that does not exist', () => {
    expect(model.didMove({ delta: 1, id: -1 })).toBe(false);
  });

  it('should drop a row before another one', () => {
    model.didMoveTo({ id: ensureRowId(2), isAfter: false, targetId: ensureRowId(0) });
    expect(toLabels()).toEqual([
      'folders:1:Gamma',
      'folders:2:Alpha',
      'folders:3:Beta'
    ]);
  });

  it('should drop a row after another one', () => {
    model.didMoveTo({ id: ensureRowId(0), isAfter: true, targetId: ensureRowId(2) });
    expect(toLabels()).toEqual([
      'folders:1:Beta',
      'folders:2:Gamma',
      'folders:3:Alpha'
    ]);
  });

  it('should refuse a drop onto a row of another group, so a note never joins the folder sequence', () => {
    model.setShouldIncludeFiles(true);
    expect(model.didMoveTo({ id: ensureRowId(0), isAfter: true, targetId: ensureRowId(3) })).toBe(false);
  });

  it('should refuse a drop that changes nothing', () => {
    expect(model.didMoveTo({ id: ensureRowId(0), isAfter: false, targetId: ensureRowId(1) })).toBe(false);
  });

  it('should report the items of each kind in their current order', () => {
    model.didMove({ delta: 1, id: ensureRowId(0) });
    expect(model.getOrderedItems(ReorderItemKind.Folder).map((item) => item.name)).toEqual([
      '2. Beta',
      '1. Alpha',
      'Gamma'
    ]);
  });

  it('should report no files at all while they are not included, so nothing renames them', () => {
    expect(model.getOrderedItems(ReorderItemKind.File)).toEqual([]);
  });

  it('should report the files in their current order once they are included', () => {
    model.setShouldIncludeFiles(true);
    model.didMove({ delta: 1, id: ensureRowId(3) });
    expect(model.getOrderedItems(ReorderItemKind.File).map((item) => item.name)).toEqual(['Draft', '1. Notes']);
  });
});

function ensureRowId(rowIndex: number): number {
  const row = model.buildRows()[rowIndex];
  if (!row) {
    throw new Error(`No row at ${rowIndex.toString()}`);
  }
  return row.id;
}
