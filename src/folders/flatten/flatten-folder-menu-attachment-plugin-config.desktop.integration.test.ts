import type { TFolder } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only, matching the plugin's established integration convention. Version coverage: it drives only public APIs
// (`Vault`, the `file-menu` workspace event), with no dependence on minified Obsidian internals, so
// verifying on public-latest is sufficient.
// Isolation:
// `npx vitest run --project integration-tests:desktop src/folders/flatten/flatten-folder-menu-attachment-plugin-config.desktop.integration.test.ts`.
const PLUGIN_NAME = 'Advanced Note Composer';

interface ExtendedAttachmentParams {
  readonly attachmentFileBaseName: string;
  readonly attachmentFileExtension: string;
  readonly notePathOrFile: NotePathLike | null | string;
}

interface MenuItemLike {
  readonly dom?: HTMLElement;

  /**
   * The menu section, which every command handler sets to the plugin's name. Obsidian core contributes
   * folder-menu items of its own, so a title alone does not identify ours.
   */
  readonly section?: string;
}

interface MenuLike {
  readonly hide: () => void;
  readonly items: MenuItemLike[];
}

interface MenuProbe {
  readonly parkedAncestorTitles: string[];
  readonly parkedElsewhereTitles: string[];
}

/**
 * The subset of the attachment-path resolution parameters the stub below reads.
 */
interface NotePathLike {
  readonly path: string;
}

interface ObsidianLibStateLike {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup and callbacks reassign this shared fixture state.
  pluginApiRegistry?: PluginApiRegistryWrapperLike;
}

/**
 * The slice of the shared plugin API registry the stand-in is published into.
 */
interface PluginApiRegistryHostLike {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup and callbacks reassign this shared fixture state.
  __obsidianLib?: ObsidianLibStateLike;
}

interface PluginApiRegistryLike {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup and callbacks reassign this shared fixture state.
  records?: Record<string, PublishedPluginApiRecordLike[]>;
  readonly subscribers?: (() => void)[];
}

interface PluginApiRegistryWrapperLike {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup and callbacks reassign this shared fixture state.
  value?: PluginApiRegistryLike;
}

interface PublishedPluginApiRecordLike {
  readonly api: object;
  readonly apiVersion: string;
  readonly contract: Record<string, object>;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup and callbacks reassign this shared fixture state.
  isRevoked: boolean;
  readonly pluginId: string;
}

/**
 * Issue #213: the reporter ran `Create folder with notes...` on a folder and the two folder-only flatten
 * entries were missing from its context menu afterwards. They blamed `Custom Attachment Location`, and they
 * were right — though not for the reason anyone assumed.
 *
 * CAL keeps Obsidian's own `attachmentFolderPath` pointed at the folder it last resolved for the ACTIVE
 * note, as an ABSOLUTE path, so that Obsidian's native paste/drop lands in the right place. The note that
 * command creates is opened at the end, so the setting ended up naming a folder INSIDE the folder that had
 * just been created. `isConfiguredAttachmentFolder` matches ancestor-or-self, so it claimed that brand-new
 * folder — and every ancestor of it — as an attachment folder, leaving nothing a folder-only flatten could
 * promote. Open a different note and the entries came back, which is what made it look inexplicable.
 *
 * The two shapes below are the rule: with a plugin owning the resolution, that setting must not be read,
 * wherever it happens to point. Real Obsidian rather than a unit test, because what is under test is which
 * entries the folder context menu ends up with.
 */
describe('flatten folder menu when an attachment-location plugin parks a path in the setting (issue #213)', () => {
  it('keeps the folder-only flatten entries whatever the attachment-location plugin left in the setting', async () => {
    const result = await evalInObsidian({
      async callback({ app, obsidianModule, pluginName }): Promise<MenuProbe> {
        const originalAttachmentFolderPath = app.vault.getConfig('attachmentFolderPath');
        const standInRecords: PublishedPluginApiRecordLike[] = [];

        try {
          stubAttachmentLocationPlugin();

          await trashIfExists('t423-parked');
          await trashIfExists('t423-parked-elsewhere');

          // 1. The reported shape: an ordinary folder with an ordinary child folder holding its own note —
          // nothing about it is an attachment folder. The child folder nests one deeper so that the parked
          // path is the only thing that could take the recursive entry away (issue #230 answers the nesting
          // question from the tree, plugin or not).
          await app.vault.createFolder('t423-parked');
          await app.vault.create('t423-parked/t423-stays.md', 'the note that stays behind');
          await app.vault.createFolder('t423-parked/t423-created');
          await app.vault.create('t423-parked/t423-created/t423-new.md', 'the note the command created');
          await app.vault.createFolder('t423-parked/t423-created/t423-deeper');
          await app.vault.create('t423-parked/t423-created/t423-deeper/t423-deepest.md', 'the nested note');

          // 2. The same, to be probed while the parked path names something unrelated — so a passing test
          // cannot be explained by the setting simply being ignored for this folder in particular.
          await app.vault.createFolder('t423-parked-elsewhere');
          await app.vault.create('t423-parked-elsewhere/t423-stays2.md', 'the note that stays behind');
          await app.vault.createFolder('t423-parked-elsewhere/t423-created2');
          await app.vault.create('t423-parked-elsewhere/t423-created2/t423-new2.md', 'the note the command created');
          await app.vault.createFolder('t423-parked-elsewhere/t423-created2/t423-deeper2');
          await app.vault.create('t423-parked-elsewhere/t423-created2/t423-deeper2/t423-deepest2.md', 'the nested note');

          // What CAL leaves behind once the just-created note is the active one: an absolute path INSIDE
          // the folder the command created.
          app.vault.setConfig('attachmentFolderPath', 't423-parked/t423-created/@');
          const parkedAncestorTitles = collectFlattenTitles(getFolder('t423-parked'));

          app.vault.setConfig('attachmentFolderPath', 't423-parked/t423-created/@');
          const parkedElsewhereTitles = collectFlattenTitles(getFolder('t423-parked-elsewhere'));

          return { parkedAncestorTitles, parkedElsewhereTitles };
        } finally {
          app.vault.setConfig('attachmentFolderPath', originalAttachmentFolderPath);
          revokeAttachmentLocationPlugin();
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
         * Derives the folder from the note's own folder, the shape `Custom Attachment Location` produces for
         * its default `./@` setting.
         *
         * @param parameters - The extended-resolution parameters.
         * @returns The resolved attachment file path.
         */
        function resolveExtendedAttachmentPath(parameters: ExtendedAttachmentParams): Promise<string> {
          const notePath = typeof parameters.notePathOrFile === 'string' ? parameters.notePathOrFile : parameters.notePathOrFile?.path ?? '';
          const noteFolderPath = notePath.replace(/\/[^/]+$/, '');
          return Promise.resolve(`${noteFolderPath}/@/${parameters.attachmentFileBaseName}.${parameters.attachmentFileExtension}`);
        }

        function getPluginApiRegistry(): PluginApiRegistryLike {
          const host = window as PluginApiRegistryHostLike;
          host.__obsidianLib ??= {};
          host.__obsidianLib.pluginApiRegistry ??= {};
          const wrapper = host.__obsidianLib.pluginApiRegistry;
          wrapper.value ??= {};
          return wrapper.value;
        }

        function notifyPluginApiSubscribers(registry: PluginApiRegistryLike): void {
          for (const subscriber of registry.subscribers ?? []) {
            subscriber();
          }
        }

        /**
         * Revokes the stand-in and drops it, as the registry does when its provider unloads.
         */
        function revokeAttachmentLocationPlugin(): void {
          const registry = getPluginApiRegistry();
          for (const record of standInRecords.splice(0)) {
            record.isRevoked = true;
            if (registry.records) {
              registry.records[record.pluginId] = (registry.records[record.pluginId] ?? []).filter((candidate) => candidate !== record);
            }
          }
          notifyPluginApiSubscribers(registry);
        }

        /**
         * Models `Custom Attachment Location`: the attachment-path API it publishes in the plugin registry is
         * what `@mnaoumov/obsidian-lib` dispatches to instead of the native resolution, and its mere PRESENCE
         * is what makes the resolution asynchronous.
         */
        function stubAttachmentLocationPlugin(): void {
          const customAttachmentLocationPluginId = 'obsidian-custom-attachment-location';
          const registry = getPluginApiRegistry();
          registry.records ??= {};
          const record: PublishedPluginApiRecordLike = {
            api: {
              getAvailablePathForAttachments: resolveExtendedAttachmentPath,
              isAttachmentUnitFolder: (): boolean => false
            },
            apiVersion: '1.3.0',
            contract: {},
            isRevoked: false,
            pluginId: customAttachmentLocationPluginId
          };
          registry.records[customAttachmentLocationPluginId] = [...(registry.records[customAttachmentLocationPluginId] ?? []), record];
          standInRecords.push(record);
          notifyPluginApiSubscribers(registry);
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

    /*
     * The reported case. Before the fix this was `['Flatten folder...']` — the parked path claimed
     * `t423-created`, and with it the only thing either folder-only variant could have promoted.
     *
     * All three entries, not two: with a plugin owning the resolution the collector answers `null`, so
     * issue #210's duplicate rule judges nothing it would need the collection for — and the child folder
     * here nests, which is the one half that IS judged without it (issue #230).
     */
    expect(result.parkedAncestorTitles).toStrictEqual([
      'Flatten folder...',
      'Flatten folder (child folders only)...',
      'Flatten folder recursively (all folders at any depth)...'
    ]);
    // The control: a folder the parked path says nothing about was always fine, and still is.
    expect(result.parkedElsewhereTitles).toStrictEqual([
      'Flatten folder...',
      'Flatten folder (child folders only)...',
      'Flatten folder recursively (all folders at any depth)...'
    ]);
  });
});
