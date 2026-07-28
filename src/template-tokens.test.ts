import type {
  TFile,
  TFolder
} from 'obsidian';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import {
  describe,
  expect,
  it
} from 'vitest';

import {
  resolveFolderTemplateTokens,
  resolveTemplateTokens
} from './template-tokens.ts';

describe('resolveTemplateTokens', () => {
  function createFile(path: string, parentFolderName: null | string): TFile {
    const basename = ensureNonNullable(path.split('/').pop()).replace(/\.md$/, '');
    return strictProxy<TFile>({
      basename,
      parent: parentFolderName === null ? null : strictProxy<TFolder>({ name: parentFolderName }),
      path
    });
  }

  const sourceFile = createFile('Projects/Alpha/Source Note.md', 'Alpha');
  const targetFile = createFile('Archive/Target Note.md', 'Archive');

  function resolve(template: string): string {
    return resolveTemplateTokens({ content: 'BODY', sourceFile, targetFile, template });
  }

  it('should substitute the content token', () => {
    expect(resolve('before {{content}} after')).toBe('before BODY after');
  });

  it('should substitute the source path and title tokens', () => {
    expect(resolve('{{fromPath}} | {{fromTitle}}')).toBe('Projects/Alpha/Source Note.md | Source Note');
  });

  it('should substitute the target path and title tokens', () => {
    expect(resolve('{{newPath}} | {{newTitle}}')).toBe('Archive/Target Note.md | Target Note');
  });

  it('should substitute the source parent folder token', () => {
    expect(resolve('{{fromParentFolder}}')).toBe('Alpha');
  });

  it('should substitute the target parent folder token', () => {
    expect(resolve('{{newParentFolder}}')).toBe('Archive');
  });

  it('should treat the bare parentFolder token as the target parent folder', () => {
    expect(resolve('{{parentFolder}}')).toBe('Archive');
  });

  it('should be case-insensitive for token keys', () => {
    expect(resolve('{{ParentFolder}}')).toBe('Archive');
  });

  it('should return an empty string for the parent folder of a root-level file', () => {
    const rootFile = createFile('Root Note.md', '');
    expect(resolveTemplateTokens({ content: '', sourceFile, targetFile: rootFile, template: '{{parentFolder}}' })).toBe('');
  });

  it('should return an empty string when the file has no parent', () => {
    const orphan = createFile('Orphan.md', null);
    expect(resolveTemplateTokens({ content: '', sourceFile, targetFile: orphan, template: '{{parentFolder}}' })).toBe('');
  });

  it('should format the date token with the provided format', () => {
    expect(resolve('{{date:YYYY}}')).toMatch(/^\d{4}$/);
  });

  it('should format the date token with the default format', () => {
    expect(resolve('{{date}}')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('should format the time token with the default format', () => {
    expect(resolve('{{time}}')).toMatch(/^\d{2}:\d{2}$/);
  });

  it('should format the time token with the provided format', () => {
    expect(resolve('{{time:HH}}')).toMatch(/^\d{2}$/);
  });

  it('should throw for an unknown token key', () => {
    expect(() => resolve('{{unknown}}')).toThrow('Invalid template key: unknown');
  });
});

describe('resolveFolderTemplateTokens', () => {
  function createFolder(path: string, parentFolderName: null | string): TFolder {
    return strictProxy<TFolder>({
      name: ensureNonNullable(path.split('/').pop()),
      parent: parentFolderName === null ? null : strictProxy<TFolder>({ name: parentFolderName }),
      path
    });
  }

  const sourceFolder = createFolder('Projects/Alpha', 'Projects');

  function resolve(template: string): string {
    return resolveFolderTemplateTokens({ sourceFolder, template });
  }

  it('should substitute the folder name and path tokens', () => {
    expect(resolve('{{folderName}} | {{folderPath}}')).toBe('Alpha | Projects/Alpha');
  });

  it('should substitute the parent folder token', () => {
    expect(resolve('{{parentFolder}}')).toBe('Projects');
  });

  it('should be case-insensitive for token keys', () => {
    expect(resolve('{{FolderName}}')).toBe('Alpha');
  });

  it('should return an empty string when the folder has no parent', () => {
    const orphan = createFolder('Orphan', null);
    expect(resolveFolderTemplateTokens({ sourceFolder: orphan, template: '{{parentFolder}}' })).toBe('');
  });

  it('should format the date token', () => {
    expect(resolve('{{date:YYYY}}')).toMatch(/^\d{4}$/);
  });

  it('should format the time token', () => {
    expect(resolve('{{time}}')).toMatch(/^\d{2}:\d{2}$/);
  });

  it('should keep literal text around the tokens', () => {
    expect(resolve('{{folderName}} summary')).toBe('Alpha summary');
  });

  it('should throw for a note-flavored token key, which has nothing to resolve against', () => {
    expect(() => resolve('{{fromTitle}}')).toThrow('Invalid template key: fromTitle');
  });

  it('should throw for an unknown token key', () => {
    expect(() => resolve('{{unknown}}')).toThrow('Invalid template key: unknown');
  });
});
