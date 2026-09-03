import type { TFolder } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only, matching the plugin's established integration convention. G99: it drives only public APIs
// (`Vault`, the `file-menu` workspace event) plus the plugin's own settings component, with no dependence on
// Minified Obsidian internals, so verifying on public-latest is sufficient.
// Isolation:
// `npx vitest run --project integration-tests:desktop src/flatten-folder-menu-excluded.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';
const PLUGIN_NAME = 'Advanced Note Composer';

// Minimal shape of the plugin's settings component reached at runtime, used to set and restore the exclude
// Paths (the same walker `exclude-paths-typing.desktop.integration.test.ts` uses).
interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: ExcludePathsSettings;
}

interface ExcludePathsSettings {
  moveAndFlattenExcludePaths: string[];
}

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
  configuredAttachmentFolderTitles: string[];
  controlTitles: string[];
  excludedTitles: string[];
}

interface SettingsCarrier {
  editAndSave(editor: (settings: ExcludePathsSettings) => void): Promise<void>;
  settings: ExcludePathsSettings;
}

/**
 * Issue #193: the reporter excluded their attachment folder and the folder-only flatten entries kept
 * appearing, because exclusion gated only the folder a command runs ON, never the folders a flatten MOVES.
 *
 * The vault here is the one that produced the report — an attachment-location plugin (Custom Attachment
 * Location) owns the resolution, so `getAttachmentFolderPathSyncOrNull` answers `null` and the exact
 * attachment check that fixed issue #185 cannot run at all. This is the real-Obsidian confirmation that the
 * user's own exclusion is enough to take the entries away with no resolution available.
 *
 * Issue #193 shipped a SECOND synchronous replacement beside it — reading Obsidian's own
 * `attachmentFolderPath` — and issue #213 withdrew it for exactly this kind of vault: the plugin owning the
 * resolution owns that setting too. The `t366-configured` shape below is kept as the pin on the withdrawal,
 * asserting the entries STAY.
 */
describe('flatten folder menu with an excluded or configured attachment folder (issue #193)', () => {
  it('hides the folder-only flatten entries when nothing but an excluded folder could move', async () => {
    const result = await evalInObsidian({
      async callback({ app, obsidianModule, pluginId, pluginName }): Promise<MenuProbe> {
        const settingsComponent = findSettingsComponent();
        const originalExcludePaths = [...settingsComponent.settings.moveAndFlattenExcludePaths];
        const originalAttachmentFolderPath = app.vault.getConfig('attachmentFolderPath');
        const hasOwnGetAvailablePathForAttachments = Object.hasOwn(app.vault, 'getAvailablePathForAttachments');
        const originalGetAvailablePathForAttachments = app.vault.getAvailablePathForAttachments;

        try {
          stubAttachmentLocationPlugin();
          app.vault.setConfig('attachmentFolderPath', './t366-cfg-assets');

          await trashIfExists('t366-excluded');
          await trashIfExists('t366-configured');
          await trashIfExists('t366-control');

          // 1. Excluded: the only child folder is one the user excluded.
          await app.vault.createFolder('t366-excluded');
          await app.vault.createFolder('t366-excluded/t366-excluded-assets');
          await app.vault.createBinary('t366-excluded/t366-excluded-assets/t366-pic.png', new ArrayBuffer(4));
          await app.vault.create('t366-excluded/t366-note.md', 'See ![[t366-pic.png]].');

          // 2. Configured: the only child folder is named after Obsidian's own `attachmentFolderPath`, with
          // No exclusion configured for it at all. Since issue #213 that setting is not consulted here at
          // All, so this shape keeps its entries — it is the pin on that withdrawal. It nests one deeper so
          // That the setting stays the only thing that could take the recursive entry away (issue #230).
          await app.vault.createFolder('t366-configured');
          await app.vault.createFolder('t366-configured/t366-cfg-assets');
          await app.vault.createBinary('t366-configured/t366-cfg-assets/t366-pic2.png', new ArrayBuffer(4));
          await app.vault.createFolder('t366-configured/t366-cfg-assets/t366-deeper2');
          await app.vault.create('t366-configured/t366-cfg-assets/t366-deeper2/t366-deep2.md', 'deep body');
          await app.vault.create('t366-configured/t366-note2.md', 'See ![[t366-pic2.png]].');

          // 3. The control: the same shape plus an ordinary child folder, which the commands CAN promote —
          // Nesting for the same reason as above.
          await app.vault.createFolder('t366-control');
          await app.vault.createFolder('t366-control/t366-cfg-assets');
          await app.vault.createBinary('t366-control/t366-cfg-assets/t366-pic3.png', new ArrayBuffer(4));
          await app.vault.create('t366-control/t366-note3.md', 'See ![[t366-pic3.png]].');
          await app.vault.createFolder('t366-control/t366-sub');
          await app.vault.create('t366-control/t366-sub/t366-deep.md', 'deep body');
          await app.vault.createFolder('t366-control/t366-sub/t366-deeper3');
          await app.vault.create('t366-control/t366-sub/t366-deeper3/t366-deep3.md', 'deep body');

          await settingsComponent.editAndSave((settings) => {
            settings.moveAndFlattenExcludePaths = ['t366-excluded/t366-excluded-assets'];
          });

          return {
            configuredAttachmentFolderTitles: collectFlattenTitles(getFolder('t366-configured')),
            controlTitles: collectFlattenTitles(getFolder('t366-control')),
            excludedTitles: collectFlattenTitles(getFolder('t366-excluded'))
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.moveAndFlattenExcludePaths = originalExcludePaths;
          });
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

        function findSettingsComponent(): SettingsCarrier {
          const plugin = app.plugins.getPlugin(pluginId) as ComponentTreeNode | null;
          const queue: ComponentTreeNode[] = plugin ? [plugin] : [];
          while (queue.length > 0) {
            const node = queue.shift();
            if (!node) {
              continue;
            }
            if (isSettingsComponent(node)) {
              return node;
            }
            if (node._children) {
              queue.push(...node._children);
            }
          }
          throw new Error('Settings component was not found.');
        }

        function getFolder(path: string): TFolder {
          const folder = app.vault.getFolderByPath(path);
          if (!folder) {
            throw new Error(`${path} was not created.`);
          }
          return folder;
        }

        function isSettingsComponent(node: ComponentTreeNode): node is SettingsCarrier {
          return typeof node.editAndSave === 'function' && Array.isArray(node.settings?.moveAndFlattenExcludePaths);
        }

        /**
         * Models Custom Attachment Location: the `extended` member it hangs on Obsidian's
         * `getAvailablePathForAttachments` is what `obsidian-dev-utils` dispatches to instead of the native
         * resolution, and its mere PRESENCE is what makes the resolution asynchronous. Installed on the
         * INSTANCE — the real member lives on `Vault.prototype`.
         */
        function stubAttachmentLocationPlugin(): void {
          // `bind` keeps the real call signature, so the native resolution still works for anything that
          // Invokes it — only the `extended` member beside it is new.
          const patched = originalGetAvailablePathForAttachments.bind(app.vault);
          Object.assign(patched, { extended: resolveExtendedAttachmentPath });
          app.vault.getAvailablePathForAttachments = patched;
        }

        /**
         * Derives the folder from the note's NAME, the one shape no native mode can produce.
         *
         * @param parameters - The extended-resolution parameters.
         * @returns The resolved attachment file path.
         */
        function resolveExtendedAttachmentPath(parameters: ExtendedAttachmentParams): Promise<string> {
          const notePath = typeof parameters.notePathOrFile === 'string' ? parameters.notePathOrFile : '';
          const folderPath = notePath.replace(/\.md$/, '');
          return Promise.resolve(`${folderPath}/${parameters.attachmentFileBaseName}.${parameters.attachmentFileExtension}`);
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }
      },
      input: { pluginId: PLUGIN_ID, pluginName: PLUGIN_NAME },
      vaultPath: getTemporaryVault().path
    });

    // The user's own exclusion is enough, with no attachment resolution possible at all. `Flatten folder...`
    // Stays: it still promotes the note, and an excluded child is simply left out of what it moves.
    expect(result.excludedTitles).toStrictEqual(['Flatten folder...']);
    /*
     * Issue #213: Obsidian's own `attachmentFolderPath` is NOT consulted once a plugin owns the resolution,
     * so naming the child folder after it changes nothing and all three entries stay. This assertion was the
     * exact opposite before #213 — see `flatten-folder-menu-attachment-plugin-config…` for the vault where
     * reading that setting actively hid commands.
     */
    expect(result.configuredAttachmentFolderTitles).toStrictEqual([
      'Flatten folder...',
      'Flatten folder (child folders only)...',
      'Flatten folder recursively (all folders at any depth)...'
    ]);
    // One ordinary child folder is enough to bring both folder-only entries back, and `t366-sub` nests, so
    // The recursive entry survives issue #210's duplicate rule as well.
    expect(result.controlTitles).toStrictEqual([
      'Flatten folder...',
      'Flatten folder (child folders only)...',
      'Flatten folder recursively (all folders at any depth)...'
    ]);
  });
});
