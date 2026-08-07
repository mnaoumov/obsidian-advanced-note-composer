import type { TFolder } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Isolation:
// `npx vitest run --project integration-tests:desktop src/flatten-folder-menu-attachment-only.desktop.integration.test.ts`.
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
  attachmentOnlyTitles: string[];
  plainSubFolderTitles: string[];
}

/**
 * Issue #185: a folder whose only child folder is the attachment folder of a note staying behind has
 * nothing either folder-only flatten could promote, so those two entries must not be offered at all.
 *
 * This is the real-Obsidian confirmation that the synchronous attachment resolution behind the fix agrees
 * with the asynchronous one the executor runs — a unit test can only assert it against the mocked vault.
 */
describe('flatten folder menu with an attachment-only folder (issue #185)', () => {
  it('hides the folder-only flatten entries when the sole child folder holds the staying note\'s attachments', async () => {
    const result = await evalInObsidian({
      // eslint-disable-next-line unicorn/name-replacements -- `args` is an `obsidian-integration-testing` parameter name.
      args: { pluginName: PLUGIN_NAME },
      // eslint-disable-next-line unicorn/name-replacements -- `fn` is an `obsidian-integration-testing` parameter name.
      async fn({ app, obsidianModule, pluginName }): Promise<MenuProbe> {
        const originalAttachmentFolderPath = app.vault.getConfig('attachmentFolderPath');
        try {
          // A per-folder attachment sub-folder is the configuration the issue is reported against.
          app.vault.setConfig('attachmentFolderPath', './att-only-assets');

          await trashIfExists('att-only-src');
          await trashIfExists('att-only-plain');

          // The reported shape: one note, and the folder holding exactly that note's attachments.
          await app.vault.createFolder('att-only-src');
          await app.vault.createFolder('att-only-src/att-only-assets');
          await app.vault.createBinary('att-only-src/att-only-assets/att-only-pic.png', new ArrayBuffer(4));
          await app.vault.create('att-only-src/att-only-note.md', 'See ![[att-only-pic.png]].');

          // The control: the same shape plus an ordinary child folder, which the commands CAN promote.
          await app.vault.createFolder('att-only-plain');
          await app.vault.createFolder('att-only-plain/att-only-assets');
          await app.vault.createBinary('att-only-plain/att-only-assets/att-only-pic2.png', new ArrayBuffer(4));
          await app.vault.create('att-only-plain/att-only-note2.md', 'See ![[att-only-pic2.png]].');
          await app.vault.createFolder('att-only-plain/att-only-sub');
          await app.vault.create('att-only-plain/att-only-sub/att-only-deep.md', 'deep body');

          return {
            attachmentOnlyTitles: collectFlattenTitles(getFolder('att-only-src')),
            plainSubFolderTitles: collectFlattenTitles(getFolder('att-only-plain'))
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
      vaultPath: getTempVault().path
    });

    // The two folder-only commands are gone; `Flatten folder...` stays, because it promotes every direct
    // Child — the attachment folder and the note alike — and therefore still has something to do.
    expect(result.attachmentOnlyTitles).toStrictEqual(['Flatten folder...']);
    // One ordinary child folder is enough to bring both of them back.
    expect(result.plainSubFolderTitles).toStrictEqual([
      'Flatten folder...',
      'Flatten folder (child folders only)...',
      'Flatten folder recursively (all folders at any depth)...'
    ]);
  });
});
