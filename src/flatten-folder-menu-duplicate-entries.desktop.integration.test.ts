import type { TFolder } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only, matching the plugin's established integration convention. G99: it drives only public APIs
// (`Vault`, the `file-menu` workspace event), with no dependence on minified Obsidian internals, so
// Verifying on public-latest is sufficient.
// Isolation:
// `npx vitest run --project integration-tests:desktop src/flatten-folder-menu-duplicate-entries.desktop.integration.test.ts`.
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
  flatFoldersOnlyTitles: string[];
  flatWithFileTitles: string[];
  nestedFoldersOnlyTitles: string[];
  nestedWithFileTitles: string[];
}

/**
 * Issue #210: the reporter kept being offered `Flatten folder recursively (all folders at any depth)...` on a
 * folder whose sub-folders hold no sub-folders of their own, where it can only repeat
 * `Flatten folder (child folders only)...`. A variant is now offered only where it would move something a
 * simpler variant would not, which also takes the child-folders-only entry away from a folder holding
 * nothing but folders (there it repeats `Flatten folder...`).
 *
 * The four shapes below are the whole rule: nesting decides the third entry, a file of the folder's own
 * decides the second. Real Obsidian rather than a unit test, because what is under test is which entries the
 * folder context menu ends up with.
 */
describe('flatten folder menu duplicate entries (issue #210)', () => {
  it('offers a flatten variant only where it moves something a simpler variant would not', async () => {
    const result = await evalInObsidian({
      async callback({ app, obsidianModule, pluginName }): Promise<MenuProbe> {
        const originalAttachmentFolderPath = app.vault.getConfig('attachmentFolderPath');
        try {
          // Attachments beside their note: no folder here is an attachment folder, so the entries are
          // Decided by the duplicate rule alone.
          app.vault.setConfig('attachmentFolderPath', './');

          await trashIfExists('t417-flat-with-file');
          await trashIfExists('t417-nested-with-file');
          await trashIfExists('t417-flat-folders-only');
          await trashIfExists('t417-nested-folders-only');

          // 1. A file of its own plus one flat child folder: the recursive variant would move that same
          // Single folder.
          await app.vault.createFolder('t417-flat-with-file');
          await app.vault.createFolder('t417-flat-with-file/t417-sub');
          await app.vault.create('t417-flat-with-file/t417-note.md', 'body');
          await app.vault.create('t417-flat-with-file/t417-sub/t417-deep.md', 'deep body');

          // 2. The same, nested one level deeper: now the recursive variant promotes a folder nothing else
          // Would.
          await app.vault.createFolder('t417-nested-with-file');
          await app.vault.createFolder('t417-nested-with-file/t417-sub');
          await app.vault.createFolder('t417-nested-with-file/t417-sub/t417-deeper');
          await app.vault.create('t417-nested-with-file/t417-note2.md', 'body');
          await app.vault.create('t417-nested-with-file/t417-sub/t417-deeper/t417-deepest.md', 'deepest body');

          // 3. Nothing but a flat child folder: every variant moves exactly that folder, so only the
          // Original command — the one a hotkey may be bound to — is left.
          await app.vault.createFolder('t417-flat-folders-only');
          await app.vault.createFolder('t417-flat-folders-only/t417-sub');
          await app.vault.create('t417-flat-folders-only/t417-sub/t417-deep3.md', 'deep body');

          // 4. Nothing but folders, nested: the child-folders-only variant still repeats
          // `Flatten folder...`, while the recursive one does not.
          await app.vault.createFolder('t417-nested-folders-only');
          await app.vault.createFolder('t417-nested-folders-only/t417-sub');
          await app.vault.createFolder('t417-nested-folders-only/t417-sub/t417-deeper');
          await app.vault.create('t417-nested-folders-only/t417-sub/t417-deeper/t417-deepest4.md', 'deepest body');

          return {
            flatFoldersOnlyTitles: collectFlattenTitles(getFolder('t417-flat-folders-only')),
            flatWithFileTitles: collectFlattenTitles(getFolder('t417-flat-with-file')),
            nestedFoldersOnlyTitles: collectFlattenTitles(getFolder('t417-nested-folders-only')),
            nestedWithFileTitles: collectFlattenTitles(getFolder('t417-nested-with-file'))
          };
        } finally {
          app.vault.setConfig('attachmentFolderPath', originalAttachmentFolderPath);
        }

        /**
         * Builds the folder context menu and returns the titles of the plugin's flatten entries.
         *
         * With the submenu setting ON the plugin's items are nested, so the whole section's rendered text
         * is searched rather than only the top-level item titles.
         *
         * @param targetFolder - The folder to build the menu for.
         * @returns The flatten entry titles found, in menu order.
         */
        function collectFlattenTitles(targetFolder: TFolder): string[] {
          const menu = new obsidianModule.Menu();
          app.workspace.trigger('file-menu', menu, targetFolder, 'file-explorer-context-menu');
          const sectionText = (menu as MenuLike).items
            .filter((item) => item.section === pluginName)
            .map((item) => item.dom?.textContent ?? '')
            .join('\n');
          (menu as MenuLike).hide();

          return [
            'Flatten folder...',
            'Flatten folder (child folders only)...',
            'Flatten folder recursively (all folders at any depth)...'
          ].filter((title) => sectionText.includes(title));
        }

        function getFolder(path: string): TFolder {
          const folder = app.vault.getFolderByPath(path);
          if (!folder) {
            throw new Error(`${path} was not created.`);
          }
          return folder;
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

    // The reported case: the recursive entry is gone, the two it cannot duplicate stay.
    expect(result.flatWithFileTitles).toStrictEqual([
      'Flatten folder...',
      'Flatten folder (child folders only)...'
    ]);
    // One nested folder brings it straight back.
    expect(result.nestedWithFileTitles).toStrictEqual([
      'Flatten folder...',
      'Flatten folder (child folders only)...',
      'Flatten folder recursively (all folders at any depth)...'
    ]);
    // Nothing stays behind, so both newer variants repeat the original one.
    expect(result.flatFoldersOnlyTitles).toStrictEqual(['Flatten folder...']);
    // The middle variant is still a duplicate here; the recursive one is not.
    expect(result.nestedFoldersOnlyTitles).toStrictEqual([
      'Flatten folder...',
      'Flatten folder recursively (all folders at any depth)...'
    ]);
  });
});
