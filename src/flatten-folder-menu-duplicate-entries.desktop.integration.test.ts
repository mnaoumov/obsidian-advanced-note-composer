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

/**
 * The subset of `obsidian-dev-utils`' extended-resolution parameters the stub below reads.
 */
interface ExtendedAttachmentParams {
  readonly attachmentFileBaseName: string;
  readonly attachmentFileExtension: string;
  readonly notePathOrFile: null | string;
}

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

interface PluginOwnedMenuProbe {
  flatTitles: string[];
  nestedTitles: string[];
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

  /*
   * Issue #230: the same reporter met the recursive entry again, this time with Custom Attachment Location
   * installed. A plugin owning the attachment resolution makes the collector answer `null`, which used to
   * offer every variant unconditionally — so the rule above simply did not apply in their vault. How deep
   * the folders go is not the attachment question, and it is answered from the folder itself.
   */
  it('keeps judging the nesting rule while an attachment-location plugin owns the resolution (issue #230)', async () => {
    const result = await evalInObsidian({
      async callback({ app, obsidianModule, pluginName }): Promise<PluginOwnedMenuProbe> {
        const originalAttachmentFolderPath = app.vault.getConfig('attachmentFolderPath');
        const hasOwnGetAvailablePathForAttachments = Object.hasOwn(app.vault, 'getAvailablePathForAttachments');
        const originalGetAvailablePathForAttachments = app.vault.getAvailablePathForAttachments;

        try {
          app.vault.setConfig('attachmentFolderPath', './');
          stubAttachmentLocationPlugin();

          await trashIfExists('t444-flat');
          await trashIfExists('t444-nested');

          // The reporter's vault: a note of its own plus one child folder that nests nothing. A note has to
          // Be in there — with none, no attachment folder is resolved and the collector answers
          // Synchronously after all.
          await app.vault.createFolder('t444-flat');
          await app.vault.create('t444-flat/t444-note.md', 'body');
          await app.vault.createFolder('t444-flat/t444-sub');
          await app.vault.create('t444-flat/t444-sub/t444-deep.md', 'deep body');

          // The control, one level deeper: the recursive entry is judged, not suppressed.
          await app.vault.createFolder('t444-nested');
          await app.vault.create('t444-nested/t444-note2.md', 'body');
          await app.vault.createFolder('t444-nested/t444-sub2');
          await app.vault.createFolder('t444-nested/t444-sub2/t444-deeper');
          await app.vault.create('t444-nested/t444-sub2/t444-deeper/t444-deepest.md', 'deepest body');

          return {
            flatTitles: collectFlattenTitles(getFolder('t444-flat')),
            nestedTitles: collectFlattenTitles(getFolder('t444-nested'))
          };
        } finally {
          app.vault.setConfig('attachmentFolderPath', originalAttachmentFolderPath);
          if (hasOwnGetAvailablePathForAttachments) {
            app.vault.getAvailablePathForAttachments = originalGetAvailablePathForAttachments;
          } else {
            // The real member lives on `Vault.prototype`; the stub only shadowed it on the instance, so the
            // Instance property has to go rather than be overwritten with a copy.
            Reflect.deleteProperty(app.vault, 'getAvailablePathForAttachments');
          }
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

        /**
         * Derives the folder from the note's own folder, the shape Custom Attachment Location produces for
         * its default `./@` setting.
         *
         * @param parameters - The extended-resolution parameters.
         * @returns The resolved attachment file path.
         */
        function resolveExtendedAttachmentPath(parameters: ExtendedAttachmentParams): Promise<string> {
          const notePath = typeof parameters.notePathOrFile === 'string' ? parameters.notePathOrFile : '';
          const noteFolderPath = notePath.replace(/\/[^/]+$/, '');
          return Promise.resolve(`${noteFolderPath}/@/${parameters.attachmentFileBaseName}.${parameters.attachmentFileExtension}`);
        }

        /**
         * Models Custom Attachment Location: the `extended` member it hangs on Obsidian's
         * `getAvailablePathForAttachments` is what `obsidian-dev-utils` dispatches to instead of the native
         * resolution, and its mere PRESENCE is what says the resolution is owned elsewhere. Installed on the
         * INSTANCE — the real member lives on `Vault.prototype`.
         */
        function stubAttachmentLocationPlugin(): void {
          // `bind` keeps the real call signature, so the native resolution still works for anything that
          // Invokes it — only the `extended` member beside it is new.
          const patched = originalGetAvailablePathForAttachments.bind(app.vault);
          Object.assign(patched, { extended: resolveExtendedAttachmentPath });
          app.vault.getAvailablePathForAttachments = patched;
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

    // The reported case. Before the fix this listed all three: the plugin's ownership of the attachment
    // Resolution was taken to mean nothing at all could be judged.
    expect(result.flatTitles).toStrictEqual([
      'Flatten folder...',
      'Flatten folder (child folders only)...'
    ]);
    // One nested folder brings it back, exactly as in a vault without such a plugin.
    expect(result.nestedTitles).toStrictEqual([
      'Flatten folder...',
      'Flatten folder (child folders only)...',
      'Flatten folder recursively (all folders at any depth)...'
    ]);
  });
});
