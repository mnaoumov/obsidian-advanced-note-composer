import {
  describe,
  expect,
  it
} from 'vitest';

import type {
  BulkRenameItem,
  BulkRenamePlan,
  BulkRenameRequest
} from './bulk-rename-plan.ts';

import {
  buildBulkRenamePlan,
  buildBulkRenameSteps,
  BulkRenameCaseChange,
  changeCase,
  DEFAULT_BULK_RENAME_REQUEST
} from './bulk-rename-plan.ts';

function file(path: string): BulkRenameItem {
  const slashIndex = path.lastIndexOf('/');
  const parentFolderPath = slashIndex === -1 ? '/' : path.slice(0, slashIndex);
  const fileName = path.slice(slashIndex + 1);
  const dotIndex = fileName.lastIndexOf('.');
  return {
    extension: fileName.slice(dotIndex),
    isFolder: false,
    name: fileName.slice(0, dotIndex),
    parentFolder: parentFolderPath === '/' ? '' : parentFolderPath.slice(parentFolderPath.lastIndexOf('/') + 1),
    parentFolderPath,
    path
  };
}

function folder(path: string): BulkRenameItem {
  const slashIndex = path.lastIndexOf('/');
  const parentFolderPath = slashIndex === -1 ? '/' : path.slice(0, slashIndex);
  return {
    extension: '',
    isFolder: true,
    name: path.slice(slashIndex + 1),
    parentFolder: parentFolderPath === '/' ? '' : parentFolderPath.slice(parentFolderPath.lastIndexOf('/') + 1),
    parentFolderPath,
    path
  };
}

function newNames(bulkRenamePlan: BulkRenamePlan): string[] {
  return bulkRenamePlan.entries.map((entry) => entry.newName);
}

function plan(items: readonly BulkRenameItem[], options: Partial<BulkRenameRequest>, occupiedPaths: readonly string[] = []): BulkRenamePlan {
  const occupied = new Set(occupiedPaths.map((path) => path.toLowerCase()));
  return buildBulkRenamePlan({
    isPathOccupied: (path) => occupied.has(path.toLowerCase()),
    items,
    request: { ...DEFAULT_BULK_RENAME_REQUEST, ...options }
  });
}

describe('buildBulkRenamePlan', () => {
  it('should change nothing with the default options', () => {
    const result = plan([file('a/One.md')], {});
    expect(result.changedCount).toBe(0);
    expect(result.error).toBeNull();
    expect(result.entries[0]?.isChanged).toBe(false);
  });

  it('should find and replace plain text in every match, case-insensitively by default', () => {
    const result = plan([file('a/Draft draft.md'), file('a/Other.md')], { findText: 'draft', replaceText: 'Final' });
    expect(newNames(result)).toEqual(['Final Final.md', 'Other.md']);
    expect(result.changedCount).toBe(1);
  });

  it('should match case when asked', () => {
    const result = plan([file('a/Draft draft.md')], { findText: 'draft', isCaseSensitive: true, replaceText: 'final' });
    expect(newNames(result)).toEqual(['Draft final.md']);
  });

  it('should insert a plain-text replacement literally', () => {
    const result = plan([file('a/x.md')], { findText: 'x', replaceText: '$&$&' });
    expect(newNames(result)).toEqual(['$&$&.md']);
  });

  it('should expand groups in a regular expression replacement', () => {
    const result = plan([file('a/2024-01-05 Notes.md')], {
      findText: String.raw`(\d{4})-(\d{2})-(\d{2})`,
      isRegularExpression: true,
      replaceText: '$3.$2.$1'
    });
    expect(newNames(result)).toEqual(['05.01.2024 Notes.md']);
  });

  it('should report a regular expression that does not parse, and change nothing', () => {
    const result = plan([file('a/x.md')], { findText: '(', isRegularExpression: true });
    expect(result.error).toMatch(/^Invalid regular expression/);
    expect(result.changedCount).toBe(0);
    expect(newNames(result)).toEqual(['x.md']);
  });

  it('should report an unknown token, and change nothing', () => {
    const result = plan([file('a/x.md')], { prefix: '{{nope}}' });
    expect(result.error).toBe('Invalid template key: nope');
    expect(result.changedCount).toBe(0);
  });

  it('should number the items through the prefix, padded and from the start number', () => {
    const result = plan([file('a/x.md'), folder('a/y')], { prefix: '{{index:00}}. ', startIndex: 9 });
    expect(newNames(result)).toEqual(['09. x.md', '10. y']);
  });

  it('should resolve every token in the suffix', () => {
    const result = plan([file('a/b/x.md')], { suffix: ' ({{parentFolder}}, {{parentFolderPath}}, {{extension}}, {{name}}, {{index}})' });
    expect(newNames(result)).toEqual(['x (b, a/b, .md, x, 1).md']);
  });

  it('should keep a folder name with a dot whole', () => {
    const result = plan([folder('a/v1.2')], { suffix: ' old' });
    expect(newNames(result)).toEqual(['v1.2 old']);
    expect(result.entries[0]?.newPath).toBe('a/v1.2 old');
  });

  it('should place an item at the vault root at the root', () => {
    const result = plan([file('x.md')], { prefix: 'new ' });
    expect(result.entries[0]?.newPath).toBe('new x.md');
  });

  it('should flag an empty name', () => {
    const result = plan([file('a/x.md')], { findText: 'x' });
    expect(result.entries[0]?.problem).toBe('The name is empty.');
    expect(result.problemCount).toBe(1);
  });

  it('should flag a character a file name cannot hold', () => {
    const result = plan([file('a/x.md')], { suffix: '/y' });
    expect(result.entries[0]?.problem).toMatch(/^The name holds a character/);
  });

  it('should flag a leading dot', () => {
    const result = plan([file('a/x.md')], { prefix: '.' });
    expect(result.entries[0]?.problem).toBe('The name starts with a dot, which hides it.');
  });

  it('should flag a trailing dot or space', () => {
    const result = plan([folder('a/x')], { suffix: '.' });
    expect(result.entries[0]?.problem).toBe('The name ends with a dot or a space.');
  });

  it('should flag two items getting the same name, ignoring case', () => {
    const result = plan([file('a/x1.md'), file('a/X2.md')], { findText: String.raw`\d`, isRegularExpression: true });
    expect(result.entries.map((entry) => entry.problem)).toEqual([
      'Another item in this batch gets the same name.',
      'Another item in this batch gets the same name.'
    ]);
  });

  it('should flag an item renamed onto one the batch leaves alone', () => {
    const result = plan([file('a/x.md'), file('a/y.md')], { findText: 'x', replaceText: 'y' });
    expect(result.entries[0]?.problem).toBe('Another item in this batch gets the same name.');
  });

  it('should flag a name something outside the batch already holds', () => {
    const result = plan([file('a/x.md')], { findText: 'x', replaceText: 'Taken' }, ['a/taken.md']);
    expect(result.entries[0]?.problem).toBe('Something with this name already exists in the folder.');
  });

  it('should allow a destination the batch frees, and a case-only rename', () => {
    const chain = plan([file('a/ab.md'), file('a/abb.md')], { findText: 'b$', isRegularExpression: true }, ['a/ab.md', 'a/abb.md']);
    expect(newNames(chain)).toEqual(['a.md', 'ab.md']);
    expect(chain.problemCount).toBe(0);

    const caseOnly = plan([file('a/note.md')], { caseChange: BulkRenameCaseChange.Title }, ['a/note.md']);
    expect(newNames(caseOnly)).toEqual(['Note.md']);
    expect(caseOnly.entries[0]?.problem).toBeNull();
  });
});

describe('changeCase', () => {
  it('should apply every case change', () => {
    expect(changeCase('hello WORLD', BulkRenameCaseChange.Lower)).toBe('hello world');
    expect(changeCase('hello WORLD', BulkRenameCaseChange.Upper)).toBe('HELLO WORLD');
    expect(changeCase('hello WORLD', BulkRenameCaseChange.Title)).toBe('Hello World');
    expect(changeCase('1. hello WORLD', BulkRenameCaseChange.Sentence)).toBe('1. Hello world');
    expect(changeCase('hello WORLD', BulkRenameCaseChange.Unchanged)).toBe('hello WORLD');
  });
});

describe('buildBulkRenameSteps', () => {
  it('should rename the deepest items first, so a child is renamed while its folder keeps its old name', () => {
    const result = plan([folder('a'), file('a/x.md')], { suffix: '2' });
    const steps = buildBulkRenameSteps({ entries: result.entries, resolveTemporaryPath: (path) => `${path} tmp` });
    expect(steps).toEqual([
      { fromPath: 'a/x.md', isTemporary: false, toPath: 'a/x2.md' },
      { fromPath: 'a', isTemporary: false, toPath: 'a2' }
    ]);
  });

  it('should break a swap by parking one item under a temporary name of its kind', () => {
    const entries = [
      { depth: 2, isChanged: true, isFolder: true, newName: 'B', newPath: 'p/B', oldName: 'A', oldPath: 'p/A', problem: null },
      { depth: 2, isChanged: true, isFolder: false, newName: 'A', newPath: 'p/A', oldName: 'B', oldPath: 'p/B', problem: null },
      { depth: 2, isChanged: false, isFolder: false, newName: 'C', newPath: 'p/C', oldName: 'C', oldPath: 'p/C', problem: null }
    ];
    const kinds: string[] = [];
    const steps = buildBulkRenameSteps({
      entries,
      resolveTemporaryPath: (path, isFolder) => {
        kinds.push(`${path}:${String(isFolder)}`);
        return `${path} tmp`;
      }
    });
    expect(steps).toEqual([
      { fromPath: 'p/A', isTemporary: true, toPath: 'p/B tmp' },
      { fromPath: 'p/B', isTemporary: false, toPath: 'p/A' },
      { fromPath: 'p/B tmp', isTemporary: false, toPath: 'p/B' }
    ]);
    expect(kinds).toEqual(['p/B:true']);
  });
});
