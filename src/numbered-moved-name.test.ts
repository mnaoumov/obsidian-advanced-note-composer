import type {
  App as AppOriginal,
  TAbstractFile,
  TFolder
} from 'obsidian';

import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it
} from 'vitest';

import { createMovedNameSequence } from './numbered-moved-name.ts';

const DEFAULT_FOLDER_NAME_TEMPLATE = '{{index}}. {{safeFolderName}}';
const DEFAULT_NOTE_NAME_TEMPLATE = '{{index}}. {{safeName}}';

let app: AppOriginal;

/**
 * The templates a case runs under. Both default to empty, the shipped opt-out.
 */
interface NameTemplates {
  readonly folderNameTemplate?: string;
  readonly noteNameTemplate?: string;
}

function getFolder(path: string): TFolder {
  return ensureNonNullable(app.vault.getFolderByPath(path));
}

function getItem(path: string): TAbstractFile {
  return ensureNonNullable(app.vault.getAbstractFileByPath(path));
}

function initApp(files: Record<string, string>): void {
  app = App.createConfigured__({ files }).asOriginalType__();
}

/**
 * Runs one sequence over the named items, in order, and returns the names it hands out — which is how both
 * callers use it.
 *
 * @param files - The vault to build.
 * @param targetFolderPath - The destination folder.
 * @param itemPaths - The items about to be relocated, in move order.
 * @param nameTemplates - The templates for this case.
 * @returns One name per item, in the same order.
 */
function resolveNames(
  files: Record<string, string>,
  targetFolderPath: string,
  itemPaths: readonly string[],
  nameTemplates: NameTemplates = {}
): string[] {
  initApp(files);
  const sequence = createMovedNameSequence({
    folderNameTemplate: nameTemplates.folderNameTemplate ?? '',
    noteNameTemplate: nameTemplates.noteNameTemplate ?? '',
    targetFolder: getFolder(targetFolderPath)
  });
  return itemPaths.map((itemPath) => sequence.resolveName(getItem(itemPath)));
}

describe('createMovedNameSequence', () => {
  describe('the opt-out', () => {
    it('should leave a folder\'s name alone when its template is empty', () => {
      expect(resolveNames(
        {
          'dst/1. one/x.md': 'one',
          'src/b/y.md': 'b'
        },
        'dst',
        ['src/b']
      )).toStrictEqual(['b']);
    });

    it('should leave a note\'s name alone when its template is empty', () => {
      expect(resolveNames(
        {
          'dst/1. one.md': 'one',
          'src/b.md': 'b'
        },
        'dst',
        ['src/b.md']
      )).toStrictEqual(['b.md']);
    });

    it('should leave the name alone when the template renders to nothing', () => {
      // Unreachable from the settings UI — the validator requires `{{index}}` and the base token — but the
      // Template is a parameter here, and a name is never allowed to become the empty string.
      expect(resolveNames(
        {
          'dst/keep.md': 'keep',
          'src/b/y.md': 'b'
        },
        'dst',
        ['src/b'],
        { folderNameTemplate: ' ' }
      )).toStrictEqual(['b']);
    });
  });

  describe('folders', () => {
    it('should continue the destination\'s numbering rather than restart it', () => {
      expect(resolveNames(
        {
          'dst/1. one/x.md': 'one',
          'dst/3. three/y.md': 'three',
          'src/b/z.md': 'b'
        },
        'dst',
        ['src/b'],
        { folderNameTemplate: DEFAULT_FOLDER_NAME_TEMPLATE }
      )).toStrictEqual(['4. b']);
    });

    it('should not backfill a gap, continuing at 1 + max', () => {
      // Issue #269's rule, which issue #273 inherits verbatim: `1, 3, 4` continues at `5`.
      expect(resolveNames(
        {
          'dst/1. A/x.md': 'a',
          'dst/3. B/y.md': 'b',
          'dst/4. C/z.md': 'c',
          'src/D/w.md': 'd'
        },
        'dst',
        ['src/D'],
        { folderNameTemplate: DEFAULT_FOLDER_NAME_TEMPLATE }
      )).toStrictEqual(['5. D']);
    });

    it('should start at 1 when the destination has nothing numbered', () => {
      expect(resolveNames(
        {
          'dst/Notes/x.md': 'notes',
          'src/b/y.md': 'b'
        },
        'dst',
        ['src/b'],
        { folderNameTemplate: DEFAULT_FOLDER_NAME_TEMPLATE }
      )).toStrictEqual(['1. b']);
    });

    it('should RENUMBER a folder that already carries an index instead of numbering it twice', () => {
      expect(resolveNames(
        {
          'dst/7. seven/x.md': 'seven',
          'src/3. B/y.md': 'b'
        },
        'dst',
        ['src/3. B'],
        { folderNameTemplate: DEFAULT_FOLDER_NAME_TEMPLATE }
      )).toStrictEqual(['8. B']);
    });

    it('should advance the number across a batch instead of answering the same one twice', () => {
      // The whole reason the sequence counts rather than re-reading the vault: the flatten preview has no
      // Vault state to read, so a re-read would give every promoted folder the same number.
      expect(resolveNames(
        {
          'dst/2. two/x.md': 'two',
          'src/b/y.md': 'b',
          'src/c/z.md': 'c',
          'src/d/w.md': 'd'
        },
        'dst',
        ['src/b', 'src/c', 'src/d'],
        { folderNameTemplate: DEFAULT_FOLDER_NAME_TEMPLATE }
      ))
        .toStrictEqual(['3. b', '4. c', '5. d']);
    });

    it('should honor a template that zero-pads and puts the index last', () => {
      expect(resolveNames(
        {
          'dst/one (4)/x.md': 'one',
          'src/b/y.md': 'b'
        },
        'dst',
        ['src/b'],
        { folderNameTemplate: '{{safeFolderName}} ({{index:000}})' }
      )).toStrictEqual(['b (005)']);
    });

    it('should resolve the parent tokens against the DESTINATION, not where the folder came from', () => {
      expect(resolveNames(
        {
          'dst/x.md': 'x',
          'src/b/y.md': 'b'
        },
        'dst',
        ['src/b'],
        { folderNameTemplate: '{{index}}. {{parentFolder}} {{safeFolderName}}' }
      ))
        .toStrictEqual(['1. dst b']);
    });
  });

  describe('notes', () => {
    it('should number a note and keep its extension', () => {
      expect(resolveNames(
        {
          'dst/2. two.md': 'two',
          'src/note.md': 'note'
        },
        'dst',
        ['src/note.md'],
        { noteNameTemplate: DEFAULT_NOTE_NAME_TEMPLATE }
      )).toStrictEqual(['3. note.md']);
    });

    it('should renumber a note that already carries an index', () => {
      expect(resolveNames(
        {
          'dst/5. five.md': 'five',
          'src/2. note.md': 'note'
        },
        'dst',
        ['src/2. note.md'],
        { noteNameTemplate: DEFAULT_NOTE_NAME_TEMPLATE }
      )).toStrictEqual(['6. note.md']);
    });

    it('should run notes and folders as two independent sequences', () => {
      // A numbered folder beside a numbered note belongs to the other sequence, so neither counter can be
      // Nudged by the other — the rule `next-sibling-index.ts` already states for the scan.
      expect(resolveNames(
        {
          'dst/4. four.md': 'four',
          'dst/9. nine/x.md': 'nine',
          'src/b/y.md': 'b',
          'src/note.md': 'note'
        },
        'dst',
        ['src/b', 'src/note.md'],
        {
          folderNameTemplate: DEFAULT_FOLDER_NAME_TEMPLATE,
          noteNameTemplate: DEFAULT_NOTE_NAME_TEMPLATE
        }
      )).toStrictEqual(['10. b', '5. note.md']);
    });

    it('should leave a non-markdown file alone, and let it consume no number', () => {
      // An attachment is in no sequence at all, so it is neither renamed nor allowed to push the note that
      // Follows it off the number it should get.
      expect(resolveNames(
        {
          'dst/1. one.md': 'one',
          'src/diagram.png': 'binary',
          'src/note.md': 'note'
        },
        'dst',
        ['src/diagram.png', 'src/note.md'],
        { noteNameTemplate: DEFAULT_NOTE_NAME_TEMPLATE }
      ))
        .toStrictEqual(['diagram.png', '2. note.md']);
    });
  });
});
