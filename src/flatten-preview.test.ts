import type {
  App as AppOriginal,
  TAbstractFile,
  TFolder
} from 'obsidian';

import { isFolder } from 'obsidian-dev-utils/obsidian/file-system';
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
  return buildRowsFor(folderPath, [...folder.children]);
}

function buildRowsFor(folderPath: string, children: readonly TAbstractFile[]): FlattenPreviewRow[] {
  const folder = getFolder(folderPath);
  return buildFlattenPreviewRows({
    app,
    children,
    folder,
    parentFolder: ensureNonNullable(folder.parent)
  });
}

function collectFoldersRecursively(folder: TFolder, folders: TFolder[] = []): TFolder[] {
  for (const child of folder.children) {
    if (!isFolder(child)) {
      continue;
    }

    folders.push(child);
    collectFoldersRecursively(child, folders);
  }
  return folders;
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
    expect(rows).toContainEqual({ isRenamed: false, name: 'note.md', targetName: 'note.md' });
    expect(rows).toContainEqual({ isRenamed: false, name: 'sub', targetName: 'sub' });
  });

  it('should show the de-duplicated name a colliding child will get', () => {
    initApp({
      'parent/a/note.md': 'inner',
      'parent/note.md': 'existing'
    });

    expect(buildRows('parent/a')).toStrictEqual([{ isRenamed: true, name: 'note.md', targetName: 'note 1.md' }]);
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
    expect(rows).toContainEqual({ isRenamed: true, name: 'note.md', targetName: 'note 1.md' });
    expect(rows).toContainEqual({ isRenamed: true, name: 'note 1.md', targetName: 'note 1 1.md' });
  });

  it('should de-duplicate a colliding folder, which has no extension to preserve', () => {
    initApp({
      'parent/a/sub/deep.md': 'deep',
      'parent/sub/other.md': 'other'
    });

    expect(buildRows('parent/a')).toStrictEqual([{ isRenamed: true, name: 'sub', targetName: 'sub 1' }]);
  });

  it('should return no rows for an empty folder', async () => {
    initApp({ 'parent/keep.md': 'keep' });
    await app.vault.createFolder('parent/a');

    expect(buildRows('parent/a')).toStrictEqual([]);
  });

  it('should append a folder\'s de-duplication counter after a dot in its name, not inside it', () => {
    // `getAvailablePath` would read `.2` as an extension and produce `v1 1.2`; a folder has no extension,
    // So the counter belongs at the end (issues #170/#171 made folder moves the common case).
    initApp({
      'parent/a/v1.2/deep.md': 'deep',
      'parent/v1.2/other.md': 'other'
    });

    expect(buildRows('parent/a')).toStrictEqual([{ isRenamed: true, name: 'v1.2', targetName: 'v1.2 1' }]);
  });

  it('should name a deeply nested item by its path relative to the flattened folder', () => {
    // Under the recursive mode two promoted folders can share a base name, so the row has to say which is
    // Which — and the second one still shows the de-duplicated name it will actually get.
    initApp({
      'parent/a/b/x/deep.md': 'deep',
      'parent/a/y/x/other.md': 'other'
    });

    const rows = buildRowsFor('parent/a', collectFoldersRecursively(getFolder('parent/a')));
    expect(rows).toContainEqual({ isRenamed: false, name: 'b', targetName: 'b' });
    // A nested item's `name` is its relative path, so it differs from `targetName` without being renamed —
    // Which is exactly why the dialog's arrow reads `isRenamed` instead of comparing the two.
    expect(rows).toContainEqual({ isRenamed: false, name: 'b/x', targetName: 'x' });
    expect(rows).toContainEqual({ isRenamed: false, name: 'y', targetName: 'y' });
    expect(rows).toContainEqual({ isRenamed: true, name: 'y/x', targetName: 'x 1' });
  });
});
