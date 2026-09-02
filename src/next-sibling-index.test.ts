import type {
  App as AppOriginal,
  TFolder
} from 'obsidian';

import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it
} from 'vitest';

import {
  buildNumberedSiblingRegExp,
  resolveNextSiblingIndex
} from './next-sibling-index.ts';
import { ReorderItemKind } from './reorder-items.ts';

const DEFAULT_FILE_NAME_TEMPLATE = '{{index}}. {{safeName}}';
const DEFAULT_NAME_TEMPLATE = '{{index}}. {{safeFolderName}}';

let app: AppOriginal;

function getFolder(path: string): TFolder {
  return ensureNonNullable(app.vault.getFolderByPath(path));
}

function initApp(files: Record<string, string>): void {
  app = App.createConfigured__({ files }).asOriginalType__();
}

function nextFileIndex(files: Record<string, string>, nameTemplate = DEFAULT_FILE_NAME_TEMPLATE): number {
  initApp(files);
  return resolveNextSiblingIndex({ kind: ReorderItemKind.File, nameTemplate, parentFolder: getFolder('parent') });
}

function nextIndex(files: Record<string, string>, nameTemplate = DEFAULT_NAME_TEMPLATE): number {
  initApp(files);
  return resolveNextSiblingIndex({ kind: ReorderItemKind.Folder, nameTemplate, parentFolder: getFolder('parent') });
}

describe('buildNumberedSiblingRegExp', () => {
  it('should widen every non-index token, so any numbered sibling matches', () => {
    // Substituting the real name instead would only match a folder of the SAME name, so nothing would ever
    // Be found and every folder would be numbered 1.
    const regExp = ensureNonNullable(buildNumberedSiblingRegExp(DEFAULT_NAME_TEMPLATE));
    expect(regExp.source).toBe(String.raw`^(?<Index>\d+)\. .*$`);
  });

  it('should escape the literal text', () => {
    const regExp = ensureNonNullable(buildNumberedSiblingRegExp('({{index}})'));
    expect(regExp.source).toBe(String.raw`^\((?<Index>\d+)\)$`);
  });

  it('should capture only the first index token, since a duplicate group name is a syntax error', () => {
    const regExp = ensureNonNullable(buildNumberedSiblingRegExp('{{index}}-{{index}}'));
    expect(regExp.source).toBe(String.raw`^(?<Index>\d+)-\d+$`);
  });

  it('should return null when the template does not number anything', () => {
    expect(buildNumberedSiblingRegExp('{{safeFolderName}}')).toBeNull();
  });
});

describe('resolveNextSiblingIndex', () => {
  describe('folders', () => {
    it('should start at 1 when no sibling is numbered', () => {
      expect(nextIndex({ 'parent/Notes/a.md': 'a' })).toBe(1);
    });

    it('should start at 1 when the parent has no children at all', () => {
      expect(nextIndex({ 'parent/.keep': '' })).toBe(1);
    });

    it('should continue the sequence from the highest numbered sibling', () => {
      expect(nextIndex({
        'parent/1. Alpha/a.md': 'a',
        'parent/3. Beta/b.md': 'b'
      })).toBe(4);
    });

    it('should ignore siblings that do not match the template', () => {
      expect(nextIndex({
        'parent/2. Beta/b.md': 'b',
        'parent/Notes/a.md': 'a'
      })).toBe(3);
    });

    it('should ignore numbered NOTES, which are not part of the folder sequence', () => {
      expect(nextIndex({
        'parent/1. Alpha/a.md': 'a',
        'parent/9. note.md': 'note'
      })).toBe(2);
    });

    it('should read a zero-padded sibling as its numeric value', () => {
      expect(nextIndex({ 'parent/007 - Alpha/a.md': 'a' }, '{{index:000}} - {{safeFolderName}}')).toBe(8);
    });

    it('should not backfill a gap below the maximum', () => {
      expect(nextIndex({
        'parent/1. Alpha/a.md': 'a',
        'parent/5. Beta/b.md': 'b'
      })).toBe(6);
    });

    it('should return 1 when the template has no index token', () => {
      expect(nextIndex({ 'parent/1. Alpha/a.md': 'a' }, '{{safeFolderName}}')).toBe(1);
    });
  });

  describe('notes', () => {
    it('should start at 1 when no sibling note is numbered', () => {
      expect(nextFileIndex({ 'parent/Alpha.md': 'a' })).toBe(1);
    });

    it('should continue the reporter\'s own gapped sequence at 1 + max', () => {
      // Issue #269's example verbatim: `1, 3, 4` continues at `5`, not at `2` and not at `4`.
      expect(nextFileIndex({
        'parent/1. A.md': 'a',
        'parent/3. B.md': 'b',
        'parent/4. C.md': 'c'
      })).toBe(5);
    });

    it('should match the BASENAME, so the extension never has to appear in the template', () => {
      expect(nextFileIndex({ 'parent/2. Alpha.md': 'a' })).toBe(3);
    });

    it('should ignore numbered FOLDERS, which are not part of the note sequence', () => {
      expect(nextFileIndex({
        'parent/1. Alpha.md': 'a',
        'parent/9. Beta/b.md': 'b'
      })).toBe(2);
    });

    it('should ignore a numbered attachment, which is not a note', () => {
      expect(nextFileIndex({
        'parent/1. Alpha.md': 'a',
        'parent/9. diagram.png': ''
      })).toBe(2);
    });

    it('should read an index written as a suffix', () => {
      expect(nextFileIndex({ 'parent/Alpha (4).md': 'a' }, '{{safeName}} ({{index}})')).toBe(5);
    });

    it('should return 1 when the template has no index token', () => {
      expect(nextFileIndex({ 'parent/1. Alpha.md': 'a' }, '{{safeName}}')).toBe(1);
    });
  });
});
