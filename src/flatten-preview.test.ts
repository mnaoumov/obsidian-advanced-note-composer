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
import { createMovedNameSequence } from './numbered-moved-name.ts';

/**
 * The auto-numbering templates a case runs under (issue #273). Both default to empty, which is the shipped
 * opt-out — so every pre-#273 case below still asks exactly what it always asked.
 */
interface NameTemplates {
  readonly folderNameTemplate?: string;
  readonly noteNameTemplate?: string;
}

let app: AppOriginal;

function buildRows(folderPath: string, nameTemplates: NameTemplates = {}): FlattenPreviewRow[] {
  const folder = getFolder(folderPath);
  return buildRowsFor(folderPath, [...folder.children], nameTemplates);
}

function buildRowsFor(folderPath: string, children: readonly TAbstractFile[], nameTemplates: NameTemplates = {}): FlattenPreviewRow[] {
  const folder = getFolder(folderPath);
  const parentFolder = ensureNonNullable(folder.parent);
  return buildFlattenPreviewRows({
    app,
    children,
    folder,
    movedNameSequence: createMovedNameSequence({
      folderNameTemplate: nameTemplates.folderNameTemplate ?? '',
      noteNameTemplate: nameTemplates.noteNameTemplate ?? '',
      targetFolder: parentFolder
    }),
    parentFolder
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

  it('should preview the auto-numbered name, advancing across the batch', () => {
    // The destination's folders run `1, 3` — with the flattened folder `a` itself unnumbered — so the two
    // Promoted folders continue at `4` and `5`. A gap is never backfilled (issue #269's rule, issue #273's
    // Commands), and the count ADVANCES: the second folder cannot re-read `1 + max` and get `4` again.
    initApp({
      'parent/1. one/x.md': 'one',
      'parent/3. three/y.md': 'three',
      'parent/a/b/deep.md': 'deep',
      'parent/a/c/deep.md': 'deep'
    });

    const rows = buildRows('parent/a', { folderNameTemplate: '{{index}}. {{safeFolderName}}' });
    const targetNames = rows.map((row) => row.targetName);
    expect(new Set(targetNames)).toStrictEqual(new Set(['4. b', '5. c']));
    expect(rows.every((row) => row.isRenamed)).toBe(true);
  });

  it('should renumber a folder that already carries an index rather than numbering it twice', () => {
    initApp({
      'parent/7. seven/x.md': 'seven',
      'parent/a/3. b/deep.md': 'deep'
    });

    expect(buildRows('parent/a', { folderNameTemplate: '{{index}}. {{safeFolderName}}' }))
      .toStrictEqual([{ isRenamed: true, name: '3. b', targetName: '8. b' }]);
  });

  it('should number notes on their own sequence and leave an attachment alone', () => {
    // Folders and notes are two sequences, and a non-markdown file belongs to neither — so the note
    // Continues `2, 5` at `6` while the image keeps the name it has.
    initApp({
      'parent/2. two.md': 'two',
      'parent/5. five.md': 'five',
      'parent/a/diagram.png': 'binary',
      'parent/a/note.md': 'note'
    });

    const rows = buildRows('parent/a', { noteNameTemplate: '{{index}}. {{safeName}}' });
    expect(rows).toContainEqual({ isRenamed: true, name: 'note.md', targetName: '6. note.md' });
    expect(rows).toContainEqual({ isRenamed: false, name: 'diagram.png', targetName: 'diagram.png' });
  });
});
