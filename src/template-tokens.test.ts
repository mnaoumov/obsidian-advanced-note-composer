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

import type {
  CreateFolderTemplateTokens,
  ReorderedFileTemplateTokens
} from './template-tokens.ts';

import {
  getTemplateTokenKeys,
  resolveCreateFolderTemplateTokens,
  resolveFolderTemplateTokens,
  resolveReorderedFileTemplateTokens,
  resolveTemplateTokens
} from './template-tokens.ts';

const CREATE_FOLDER_TOKENS: CreateFolderTemplateTokens = {
  folderName: '1. Test Notes',
  folderPath: 'Inbox/1. Test Notes',
  index: 1,
  parentFolder: 'Inbox',
  parentFolderPath: 'Archive/Inbox',
  rawFolderName: 'test notes',
  safeFolderName: 'Test Notes'
};

describe('getTemplateTokenKeys', () => {
  it('should list the keys verbatim, in order, with duplicates kept', () => {
    expect(getTemplateTokenKeys('{{folderName}} {{index}} {{FolderName}}')).toEqual(['folderName', 'index', 'FolderName']);
  });

  it('should read the key of a formatted token', () => {
    expect(getTemplateTokenKeys('{{index:000}}')).toEqual(['index']);
  });

  it('should return nothing for a template with no tokens', () => {
    expect(getTemplateTokenKeys('plain text')).toEqual([]);
  });
});

describe('resolveCreateFolderTemplateTokens', () => {
  function resolve(template: string, tokens: CreateFolderTemplateTokens = CREATE_FOLDER_TOKENS): string {
    return resolveCreateFolderTemplateTokens({ template, tokens });
  }

  it('should resolve the folder name with its index', () => {
    expect(resolve('{{folderName}}')).toBe('1. Test Notes');
  });

  it('should resolve the folder path', () => {
    expect(resolve('{{folderPath}}')).toBe('Inbox/1. Test Notes');
  });

  it('should resolve the sanitized name without the index', () => {
    // The reporter's own output needs both spellings at once: `title` carries the index, the alias does not.
    expect(resolve('{{safeFolderName}}')).toBe('Test Notes');
  });

  it('should resolve the raw typed name', () => {
    expect(resolve('{{rawFolderName}}')).toBe('test notes');
  });

  it('should resolve the parent folder name and path', () => {
    expect(resolve('{{parentFolder}}|{{parentFolderPath}}')).toBe('Inbox|Archive/Inbox');
  });

  it('should resolve the index', () => {
    expect(resolve('{{index}}')).toBe('1');
  });

  it('should zero-pad the index to the width of the mask', () => {
    expect(resolve('{{index:000}}')).toBe('001');
  });

  it('should not truncate an index wider than its mask', () => {
    expect(resolve('{{index:00}}', { ...CREATE_FOLDER_TOKENS, index: 1234 })).toBe('1234');
  });

  it('should match keys case-insensitively', () => {
    expect(resolve('{{SafeFolderName}}')).toBe('Test Notes');
  });

  it('should resolve the shared date and time tokens', () => {
    expect(resolve('{{date:YYYY}}')).toMatch(/^\d{4}$/);
    expect(resolve('{{time}}')).toMatch(/^\d{2}:\d{2}$/);
  });

  it('should keep literal text around the tokens', () => {
    expect(resolve('# {{folderName}} notes')).toBe('# 1. Test Notes notes');
  });

  it('should throw for a note-flavored token key, which has nothing to resolve against', () => {
    expect(() => resolve('{{fromTitle}}')).toThrow('Invalid template key: fromTitle');
  });

  it('should throw for an unknown token key', () => {
    expect(() => resolve('{{unknown}}')).toThrow('Invalid template key: unknown');
  });
});

describe('resolveTemplateTokens', () => {
  function createFile(path: string, parentFolderName: null | string): TFile {
    const basename = ensureNonNullable(path.split('/').pop()).replace(/\.md$/, '');
    const parentPath = path.split('/').slice(0, -1).join('/');
    return strictProxy<TFile>({
      basename,
      // The folder carries a `path` as well as a `name` since issue #227: `{{folderPath}}` reads it.
      parent: parentFolderName === null ? null : strictProxy<TFolder>({ name: parentFolderName, path: parentPath }),
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

  // Issue #244 — `Create empty note in folder...` creates a note out of nothing, so there is no note it
  // Came FROM and the three `from` tokens have nothing to name.
  it('should resolve the source tokens to nothing when there is no source note', () => {
    expect(resolveTemplateTokens({
      content: '',
      sourceFile: null,
      targetFile,
      template: '[{{fromPath}}][{{fromTitle}}][{{fromParentFolder}}]'
    })).toBe('[][][]');
  });

  it('should keep resolving the target tokens when there is no source note', () => {
    expect(resolveTemplateTokens({
      content: 'BODY',
      sourceFile: null,
      targetFile,
      template: '{{newTitle}}: {{content}}'
    })).toBe('Target Note: BODY');
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

  // Issue #227 — the `Create folder with notes...` folder vocabulary, resolved against the folder the
  // Target note ends up in.
  describe('folder tokens', () => {
    const FOLDER_NAME_TEMPLATE = '{{index}}. {{safeFolderName}}';

    function resolveInFolder(template: string): string {
      return resolveTemplateTokens({
        content: 'BODY',
        folderNameTemplate: FOLDER_NAME_TEMPLATE,
        sourceFile,
        targetFile: createFile('Notes/3. Alpha/3. Alpha.md', '3. Alpha'),
        template
      });
    }

    /**
     * The same note, with the folder tokens pointed at a folder it is not in yet — what
     * `splitIntoFolderNoteNameTemplate` does, since it resolves before the note is renamed into the folder
     * being created.
     *
     * @param template - The template to resolve.
     * @param folderPath - The folder the folder tokens must name.
     * @returns The resolved template.
     */
    function resolveWithFolderOverride(template: string, folderPath: string): string {
      return resolveTemplateTokens({
        content: 'BODY',
        folderNameTemplate: FOLDER_NAME_TEMPLATE,
        folderPath,
        sourceFile,
        targetFile: createFile('Notes/3. Alpha/3. Alpha.md', '3. Alpha'),
        template
      });
    }

    it('should name the target note\'s own folder', () => {
      expect(resolveInFolder('{{folderName}} | {{folderPath}}')).toBe('3. Alpha | Notes/3. Alpha');
    });

    it('should treat parentFolderPath as that same folder, matching the bare parentFolder token', () => {
      expect(resolveInFolder('{{parentFolderPath}} | {{parentFolder}}')).toBe('Notes/3. Alpha | 3. Alpha');
    });

    it('should read the index and the un-numbered name back through the folder name template', () => {
      expect(resolveInFolder('{{index}} | {{safeFolderName}}')).toBe('3 | Alpha');
    });

    it('should zero-pad the index to the width of its mask', () => {
      expect(resolveInFolder('{{index:000}}')).toBe('003');
    });

    it('should follow the folder name template rather than assuming a numbering scheme', () => {
      const resolved = resolveTemplateTokens({
        content: '',
        folderNameTemplate: '{{safeFolderName}} ({{index}})',
        sourceFile,
        targetFile: createFile('Notes/Alpha (7)/Note.md', 'Alpha (7)'),
        template: '{{index}} | {{safeFolderName}}'
      });

      expect(resolved).toBe('7 | Alpha');
    });

    it('should report no index for a folder the name template did not produce, keeping its whole name', () => {
      const resolved = resolveTemplateTokens({
        content: '',
        folderNameTemplate: FOLDER_NAME_TEMPLATE,
        sourceFile,
        targetFile: createFile('Notes/Alpha/Note.md', 'Alpha'),
        template: '[{{index}}] | {{safeFolderName}}'
      });

      expect(resolved).toBe('[] | Alpha');
    });

    it('should treat a folder as unnumbered when no folder name template is given', () => {
      const resolved = resolveTemplateTokens({
        content: '',
        sourceFile,
        targetFile: createFile('Notes/3. Alpha/Note.md', '3. Alpha'),
        template: '[{{index}}] | {{safeFolderName}}'
      });

      expect(resolved).toBe('[] | 3. Alpha');
    });

    // The `Split into folder note name template` is resolved before the note is renamed into the folder
    // Being created, so it names that folder explicitly.
    it('should name the overriding folder instead of the note\'s current parent', () => {
      expect(resolveWithFolderOverride('{{folderName}} | {{folderPath}} | {{safeFolderName}}', 'Notes/9. Beta')).toBe('9. Beta | Notes/9. Beta | Beta');
    });

    // `{{parentFolder}}` is a shipped token: an override must not quietly move it one level down.
    it('should leave the parentFolder token on the note\'s own parent when the folder is overridden', () => {
      expect(resolveWithFolderOverride('{{parentFolder}}', 'Notes/9. Beta')).toBe('3. Alpha');
    });

    it('should leave the folder path of a root-level note as the vault reports it', () => {
      const resolved = resolveTemplateTokens({
        content: '',
        folderNameTemplate: FOLDER_NAME_TEMPLATE,
        sourceFile,
        targetFile: strictProxy<TFile>({
          basename: 'Root Note',
          parent: strictProxy<TFolder>({ name: '', path: '/' }),
          path: 'Root Note.md'
        }),
        template: '{{folderName}} | {{folderPath}}'
      });

      expect(resolved).toBe(' | /');
    });

    it('should resolve to nothing when the note has no parent at all', () => {
      const resolved = resolveTemplateTokens({
        content: '',
        folderNameTemplate: FOLDER_NAME_TEMPLATE,
        sourceFile,
        targetFile: createFile('Orphan.md', null),
        template: '[{{folderName}}] | [{{folderPath}}]'
      });

      expect(resolved).toBe('[] | []');
    });

    // The two keys of that vocabulary a split cannot answer.
    it('should still throw for the create-folder keys a split has no value for', () => {
      expect(() => resolveInFolder('{{rawFolderName}}')).toThrow('Invalid template key: rawFolderName');
      expect(() => resolveInFolder('{{file}}')).toThrow('Invalid template key: file');
    });
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

describe('resolveReorderedFileTemplateTokens', () => {
  const TOKENS: ReorderedFileTemplateTokens = {
    extension: '.md',
    index: 7,
    name: '7. Meeting',
    parentFolder: 'Projects',
    parentFolderPath: 'Work/Projects',
    path: 'Work/Projects/7. Meeting.md',
    safeName: 'Meeting'
  };

  function resolve(template: string): string {
    return resolveReorderedFileTemplateTokens({ template, tokens: TOKENS });
  }

  it('should substitute the basename without its number', () => {
    expect(resolve('{{safeName}}')).toBe('Meeting');
  });

  it('should substitute the new basename with its number', () => {
    expect(resolve('{{name}}')).toBe('7. Meeting');
  });

  it('should substitute the extension, which renumbering never rewrites', () => {
    expect(resolve('{{extension}}')).toBe('.md');
  });

  it('should substitute the path', () => {
    expect(resolve('{{path}}')).toBe('Work/Projects/7. Meeting.md');
  });

  it('should substitute both parent tokens', () => {
    expect(resolve('{{parentFolder}}|{{parentFolderPath}}')).toBe('Projects|Work/Projects');
  });

  it('should substitute the index', () => {
    expect(resolve('{{index}}')).toBe('7');
  });

  it('should zero-pad the index to the width of its mask', () => {
    expect(resolve('{{index:000}}')).toBe('007');
  });

  it('should be case-insensitive for token keys', () => {
    expect(resolve('{{SafeName}}')).toBe('Meeting');
  });

  it('should format the date token', () => {
    expect(resolve('{{date:YYYY}}')).toMatch(/^\d{4}$/);
  });

  it('should throw for an unknown token key', () => {
    expect(() => resolve('{{unknown}}')).toThrow('Invalid template key: unknown');
  });
});
