import type {
  App as AppOriginal,
  TFolder
} from 'obsidian';

import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import type { FlattenPreviewRow } from './flatten-preview.ts';

import { buildFlattenPreviewRows } from './flatten-preview.ts';

let app: AppOriginal;

function buildRows(folderPath: string): FlattenPreviewRow[] {
  const folder = getFolder(folderPath);
  return buildFlattenPreviewRows({
    app,
    children: [...folder.children],
    parentFolder: ensureNonNullable(folder.parent)
  });
}

function getFolder(path: string): TFolder {
  return ensureNonNullable(app.vault.getFolderByPath(path));
}

function initApp(files: Record<string, string>): void {
  app = App.createConfigured__({ files }).asOriginalType__();
}

describe('buildFlattenPreviewRows', () => {
  beforeEach(() => {
    initApp({});
  });

  it('should keep the name of a child that collides with nothing', () => {
    initApp({
      'parent/a/note.md': 'note',
      'parent/a/sub/deep.md': 'deep'
    });

    // The vault decides the order children come back in; only the mapping matters here.
    const rows = buildRows('parent/a');
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({ name: 'note.md', targetName: 'note.md' });
    expect(rows).toContainEqual({ name: 'sub', targetName: 'sub' });
  });

  it('should show the de-duplicated name a colliding child will get', () => {
    initApp({
      'parent/a/note.md': 'inner',
      'parent/note.md': 'existing'
    });

    expect(buildRows('parent/a')).toStrictEqual([{ name: 'note.md', targetName: 'note 1.md' }]);
  });

  it('should not hand the same name to two children', () => {
    // `note.md` is pushed to `note 1.md` by the existing sibling, which is exactly what the SECOND child
    // Is already called — so a preview that only asked the vault would promise both the same name.
    initApp({
      'parent/a/note.md': 'inner',
      'parent/a/note 1.md': 'inner one',
      'parent/note.md': 'existing'
    });

    const rows = buildRows('parent/a');
    const targetNames = rows.map((row) => row.targetName);
    expect(new Set(targetNames).size).toBe(rows.length);
    // Exactly what the flatten itself produces: the first rename occupies `note 1.md`, so the second child
    // Is de-duplicated off ITS own name (`note 1` + ` 1`), not off `note`.
    expect(rows).toContainEqual({ name: 'note.md', targetName: 'note 1.md' });
    expect(rows).toContainEqual({ name: 'note 1.md', targetName: 'note 1 1.md' });
  });

  it('should de-duplicate a colliding folder, which has no extension to preserve', () => {
    initApp({
      'parent/a/sub/deep.md': 'deep',
      'parent/sub/other.md': 'other'
    });

    expect(buildRows('parent/a')).toStrictEqual([{ name: 'sub', targetName: 'sub 1' }]);
  });

  it('should return no rows for an empty folder', async () => {
    initApp({ 'parent/keep.md': 'keep' });
    await app.vault.createFolder('parent/a');

    expect(buildRows('parent/a')).toStrictEqual([]);
  });
});
