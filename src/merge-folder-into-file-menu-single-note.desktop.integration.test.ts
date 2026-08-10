import type { TFolder } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Isolation:
// `npx vitest run --project integration-tests:desktop src/merge-folder-into-file-menu-single-note.desktop.integration.test.ts`.
const PLUGIN_NAME = 'Advanced Note Composer';

interface MenuItemLike {
  dom?: HTMLElement;

  /**
   * The menu section, which every command handler sets to the plugin's name. Obsidian core contributes
   * folder-menu items of its own, so a title alone does not identify ours.
   */
  section?: string;
}

interface MenuLike {
  hide(): void;
  items: MenuItemLike[];
}

interface MenuProbe {
  hasItemForNoteAndAttachment: boolean;
  hasItemForSingleNote: boolean;
  hasItemForTwoNotes: boolean;
  hasItemForTwoNotesAcrossSubFolder: boolean;
}

/**
 * Issue #209: merging a folder that holds a single note into a single file only reproduces that note under
 * the folder's name, so the entry must not be offered at all — while a folder whose second note lives in a
 * sub-folder still has a real merge to do.
 *
 * This is the real-Obsidian confirmation that the synchronous count behind the fix actually decides what
 * the context menu renders; a unit test can only assert it against the mocked vault.
 */
describe('merge folder into file menu with too few notes (issue #209)', () => {
  it('hides the entry for a folder holding fewer than two mergeable notes', async () => {
    const result = await evalInObsidian({
      async callback({ app, obsidianModule, pluginName }): Promise<MenuProbe> {
        for (const path of ['single-note-src', 'single-note-att', 'single-note-two', 'single-note-deep']) {
          await trashIfExists(path);
        }

        // The reported shape: one note, nothing else.
        await app.vault.createFolder('single-note-src');
        await app.vault.create('single-note-src/single-note-a.md', 'alpha body');

        // One note plus an attachment is still one NOTE, so the entry stays hidden.
        await app.vault.createFolder('single-note-att');
        await app.vault.create('single-note-att/single-note-b.md', 'bravo body');
        await app.vault.createBinary('single-note-att/single-note-pic.png', new ArrayBuffer(4));

        // The control: two notes side by side.
        await app.vault.createFolder('single-note-two');
        await app.vault.create('single-note-two/single-note-c.md', 'charlie body');
        await app.vault.create('single-note-two/single-note-d.md', 'delta body');

        // The other control: the second note lives a level down, which the merge would still pick up.
        await app.vault.createFolder('single-note-deep');
        await app.vault.create('single-note-deep/single-note-e.md', 'echo body');
        await app.vault.createFolder('single-note-deep/single-note-sub');
        await app.vault.create('single-note-deep/single-note-sub/single-note-f.md', 'foxtrot body');

        return {
          hasItemForNoteAndAttachment: hasMergeFolderIntoFileItem(getFolder('single-note-att')),
          hasItemForSingleNote: hasMergeFolderIntoFileItem(getFolder('single-note-src')),
          hasItemForTwoNotes: hasMergeFolderIntoFileItem(getFolder('single-note-two')),
          hasItemForTwoNotesAcrossSubFolder: hasMergeFolderIntoFileItem(getFolder('single-note-deep'))
        };

        function getFolder(path: string): TFolder {
          const folder = app.vault.getFolderByPath(path);
          if (!folder) {
            throw new Error(`${path} was not created.`);
          }
          return folder;
        }

        /**
         * Builds the folder context menu and reports whether the plugin contributed the merge-folder entry.
         *
         * With the submenu setting ON the plugin's items are nested, so the whole section's rendered text
         * is searched rather than only the top-level item titles.
         *
         * @param targetFolder - The folder to build the menu for.
         * @returns Whether the entry is offered.
         */
        function hasMergeFolderIntoFileItem(targetFolder: TFolder): boolean {
          const menu = new obsidianModule.Menu();
          app.workspace.trigger('file-menu', menu, targetFolder, 'file-explorer-context-menu');
          const sectionText = (menu as MenuLike).items
            .filter((item) => item.section === pluginName)
            .map((item) => item.dom?.textContent ?? '')
            .join('\n');
          (menu as MenuLike).hide();
          return sectionText.includes('Merge folder contents into a single file...');
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }
      },
      input: { pluginName: PLUGIN_NAME },
      vaultPath: getTemporaryVault().path
    });

    expect(result.hasItemForSingleNote).toBe(false);
    expect(result.hasItemForNoteAndAttachment).toBe(false);
    expect(result.hasItemForTwoNotes).toBe(true);
    expect(result.hasItemForTwoNotesAcrossSubFolder).toBe(true);
  });
});
