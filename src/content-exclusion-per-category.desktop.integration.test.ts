import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsTab } from './plugin-settings-tab.ts';

import { findSettingItemInObsidian } from './settings-tab-navigation.ts';

// Desktop-only, for the same reason as `command-blocking-per-category.desktop.integration.test.ts`: it
// Drives the settings tab and a folder context menu, both desktop-only surfaces here. G99: settings-gated
// Filtering with no dependence on minified internals or version-sensitive DOM, so public-latest suffices.
// Isolation: `npx vitest run --project integration-tests:desktop src/content-exclusion-per-category.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface MenuItemLike {
  dom?: HTMLElement;
}

interface MenuLike {
  hide(): void;
  items: MenuItemLike[];
}

describe('per-category content exclusion (issue #270)', () => {
  it('drops a folder from the reorder modal without excluding it from the other commands', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingItem, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const EDIT_SAVE_DELAY_IN_MILLISECONDS = 300;
        const ROOT = 'Content exclusion per category';
        const EXCLUDED_FOLDER = `${ROOT}/2. Beta`;

        // Three numbered siblings, the same fixture shape `reorder-child-folders` uses — the modal lists
        // Them by name without their numbers.
        await removeFolder(ROOT);
        await app.vault.createFolder(ROOT);
        for (const [index, name] of ['Alpha', 'Beta', 'Gamma'].entries()) {
          await app.vault.createFolder(`${ROOT}/${(index + 1).toString()}. ${name}`);
        }

        const nothingConfigured = await readReorderRows();

        // The reporter's own case, in the vault: one category's content list drops the folder from that
        // Command and leaves the rest of the plugin using it.
        await setPaths('Reorder exclude paths', EXCLUDED_FOLDER);
        const reorderExcluded = await readReorderRows();

        // The isolation that #249's per-category pair could not give: the SAME path under a different
        // Category's content list changes nothing here. Without the per-category split this would have to
        // Be `Exclude paths`, which takes the folder away from every command at once.
        await setPaths('Reorder exclude paths', '');
        await setPaths('Merge exclude paths', EXCLUDED_FOLDER);
        const mergeExcludedOnly = await readReorderRows();

        // Restore the shared instance to a clean default state.
        await setPaths('Merge exclude paths', '');
        const restored = await readReorderRows();

        await removeFolder(ROOT);

        return { mergeExcludedOnly, nothingConfigured, reorderExcluded, restored };

        function clickMenuItem(menuToSearch: MenuLike, title: string): void {
          // Identified by rendered text, the way the other folder-menu tests do — `MenuItem` exposes no
          // Title of its own.
          const itemEl = menuToSearch.items.find((candidate) => candidate.dom?.textContent === title)?.dom;
          if (!itemEl) {
            const available = menuToSearch.items.map((candidate) => candidate.dom?.textContent ?? '').join(' | ');
            throw new TypeError(`No menu item "${title}". Available: ${available}`);
          }
          itemEl.click();
        }

        async function openSettingTab(): Promise<PluginSettingsTab> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const settingTab = app.setting.pluginTabs.find((tab) => tab.id === pluginId);
          if (!settingTab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return settingTab as PluginSettingsTab;
        }

        async function readReorderRows(): Promise<(string | undefined)[]> {
          const rootFolder = app.vault.getFolderByPath(ROOT);
          if (!(rootFolder instanceof obsidianModule.TFolder)) {
            throw new TypeError(`No folder at ${ROOT}.`);
          }

          // Through the folder MENU, which is how the command is actually reached: the palette path
          // Resolves the parent from Obsidian's own new-note location, not from this folder.
          const menu = new obsidianModule.Menu();
          app.workspace.trigger('file-menu', menu, rootFolder, 'file-explorer-context-menu');
          clickMenuItem(menu, 'Reorder child folders...');

          await waitUntil({
            message: 'reorder modal did not open',
            predicate: () => document.querySelector('.advanced-note-composer-reorder-list') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const rowLabels = [...document.querySelectorAll<HTMLElement>('.advanced-note-composer-reorder-item')]
            .map((itemEl) => itemEl.dataset['rowLabel']);

          // Discarded rather than confirmed: nothing here is about performing a reorder, and a confirmed
          // One would renumber the fixture out from under the next probe.
          pressKey({ key: 'Escape' });
          await waitUntil({
            message: 'Escape did not close the reorder modal',
            predicate: () => document.querySelector('.advanced-note-composer-reorder-list') === null
          });

          return rowLabels;
        }

        async function removeFolder(path: string): Promise<void> {
          const existing = app.vault.getFolderByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }

        async function setPaths(settingName: string, value: string): Promise<void> {
          const settingTab = await openSettingTab();
          const settingItem = await findSettingItem({ app, name: settingName, settingTab });
          const textAreaEl = settingItem?.querySelector('textarea');
          if (!(textAreaEl instanceof HTMLTextAreaElement)) {
            throw new TypeError(`"${settingName}" text area was not found.`);
          }
          textAreaEl.value = value;
          textAreaEl.dispatchEvent(new Event('input'));
          await sleep(EDIT_SAVE_DELAY_IN_MILLISECONDS);
          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        }
      },
      input: { findSettingItem: findSettingItemInObsidian, pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // All three siblings are reorderable while nothing is configured, so the assertions below are not
    // Vacuous.
    expect(result.nothingConfigured).toEqual(['Alpha', 'Beta', 'Gamma']);

    // `Reorder exclude paths` takes the one folder out of the reorder modal — the reporter's ask.
    expect(result.reorderExcluded).toEqual(['Alpha', 'Gamma']);

    // And a different category's list over the same path leaves the reorder untouched. This is the
    // Assertion that fails if the category is ever dropped on the way to `isPathIgnored`.
    expect(result.mergeExcludedOnly).toEqual(['Alpha', 'Beta', 'Gamma']);

    expect(result.restored).toEqual(['Alpha', 'Beta', 'Gamma']);
  });
});
