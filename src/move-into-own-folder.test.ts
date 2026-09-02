import type {
  App as AppOriginal,
  TFile,
  TFolder
} from 'obsidian';

import { noopAsync } from 'obsidian-dev-utils/function';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from './plugin-settings-component.ts';
import type { PluginSettings } from './plugin-settings.ts';

import { moveIntoOwnFolder } from './move-into-own-folder.ts';

interface SettingsOverrides {
  readonly numberedSplitFolderNameTemplate?: string;
  readonly splitIntoFolderNoteNameTemplate?: string;
}

function createPluginSettingsComponent(settingsOverrides: SettingsOverrides): PluginSettingsComponent {
  return strictProxy<PluginSettingsComponent>({
    settings: castTo<PluginSettings>({
      numberedSplitFolderNameTemplate: '',
      reorderedFolderNameTemplate: '{{index}}. {{safeFolderName}}',
      replacement: '_',
      shouldReplaceInvalidTitleCharacters: true,
      splitIntoFolderNoteNameTemplate: '',
      ...settingsOverrides
    })
  });
}

/**
 * Wraps `parent/D.md` in a folder of its own, in a vault built from `files`, and reports where the note
 * ended up.
 *
 * @param files - The vault contents, which must include the note being moved.
 * @param settingsOverrides - The settings under test.
 * @param notePath - The note to wrap.
 * @returns The note's path after the move.
 */
async function wrap(
  files: Record<string, string>,
  settingsOverrides: SettingsOverrides,
  notePath = 'parent/D.md'
): Promise<string> {
  const app: AppOriginal = App.createConfigured__({ files }).asOriginalType__();
  const file = ensureNonNullable(app.vault.getFileByPath(notePath));
  await moveIntoOwnFolder({
    app,
    file,
    pluginSettingsComponent: createPluginSettingsComponent(settingsOverrides),
    sourceFile: null
  });
  return file.path;
}

describe('moveIntoOwnFolder', () => {
  describe('numberedSplitFolderNameTemplate', () => {
    it('should continue the reporter\'s own gapped sequence at 1 + max', async () => {
      // Issue #269's example verbatim: the number goes on the FOLDER, and `1, 3, 4` continues at `5`.
      expect(await wrap({
        'parent/1. A/a.md': 'a',
        'parent/3. B/b.md': 'b',
        'parent/4. C/c.md': 'c',
        'parent/D.md': 'd'
      }, { numberedSplitFolderNameTemplate: '{{index}}. {{safeFolderName}}' })).toBe('parent/5. D/D.md');
    });

    it('should restart at 1 in a folder with no numbered subfolders, as each recursive pass does', async () => {
      expect(await wrap({
        'parent/D.md': 'd'
      }, { numberedSplitFolderNameTemplate: '{{index}}. {{safeFolderName}}' })).toBe('parent/1. D/D.md');
    });

    it('should ignore numbered NOTES, which are not part of the folder sequence', async () => {
      expect(await wrap({
        'parent/9. note.md': 'note',
        'parent/D.md': 'd'
      }, { numberedSplitFolderNameTemplate: '{{index}}. {{safeFolderName}}' })).toBe('parent/1. D/D.md');
    });

    it('should name the folder after the note when the template is empty, which is the opt-out', async () => {
      expect(await wrap({
        'parent/1. A/a.md': 'a',
        'parent/D.md': 'd'
      }, {})).toBe('parent/D/D.md');
    });

    it('should de-duplicate a numbered folder name that already exists', async () => {
      expect(await wrap({
        'parent/1. A/a.md': 'a',
        'parent/2. D/squatter.md': 'squatter',
        'parent/D.md': 'd'
      }, { numberedSplitFolderNameTemplate: '{{index}}. {{safeFolderName}}' })).toBe('parent/3. D/D.md');
    });

    it('should number a folder created at the vault root', async () => {
      expect(await wrap({
        '1. A/a.md': 'a',
        'D.md': 'd'
      }, { numberedSplitFolderNameTemplate: '{{index}}. {{safeFolderName}}' }, 'D.md')).toBe('2. D/D.md');
    });

    it('should fall back to the note\'s name when the template renders to nothing', async () => {
      // `{{folderName}}` is what this template PRODUCES, so it resolves to nothing here; the validator
      // Rejects it, and a hand-edited setting must not leave the folder nameless.
      expect(await wrap({
        'parent/D.md': 'd'
      }, { numberedSplitFolderNameTemplate: '{{folderName}}' })).toBe('parent/D/D.md');
    });

    it('should scan the vault root for a note reporting no parent at all', async () => {
      // `TFile.parent` is nullable in the API even though a note in a vault always has one, so the
      // Fallback is defensive — but it has to be the ROOT rather than nothing, or there would be no
      // Folder to read the sibling numbering from.
      const renameFile = vi.fn(() => noopAsync());
      const app = strictProxy<AppOriginal>({
        fileManager: strictProxy({ renameFile }),
        vault: strictProxy({
          adapter: strictProxy({ exists: vi.fn().mockResolvedValue(false) }),
          createFolder: vi.fn().mockResolvedValue(null),
          getAbstractFileByPath: vi.fn().mockReturnValue(null),
          getRoot: (): TFolder =>
            strictProxy<TFolder>({
              children: [],
              name: '',
              path: '/'
            })
        })
      });

      await moveIntoOwnFolder({
        app,
        file: strictProxy<TFile>({ basename: 'D', parent: null }),
        pluginSettingsComponent: createPluginSettingsComponent({ numberedSplitFolderNameTemplate: '{{index}}. {{safeFolderName}}' }),
        sourceFile: null
      });

      expect(renameFile).toHaveBeenCalledWith(expect.anything(), '1. D/D.md');
    });

    it('should let the note-name template read the number the folder just got', async () => {
      // `splitIntoFolderNoteNameTemplate`'s folder tokens are parsed back out of the created folder through
      // `reorderedFolderNameTemplate`, so numbering the folder makes them carry the new number.
      expect(await wrap({
        'parent/4. C/c.md': 'c',
        'parent/D.md': 'd'
      }, {
        numberedSplitFolderNameTemplate: '{{index}}. {{safeFolderName}}',
        splitIntoFolderNoteNameTemplate: '{{index}} {{safeFolderName}}'
      })).toBe('parent/5. D/5 D.md');
    });
  });
});
