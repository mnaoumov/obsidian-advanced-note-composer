import type { TFolder } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Isolation:
// `npx vitest run --project integration-tests:desktop src/flatten-folder-menu-entries.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';
const PLUGIN_NAME = 'Advanced Note Composer';
const SUBMENU_SETTING_NAME = 'Should add commands to submenu';

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
  flattenTitlesWithoutSubmenu: string[];
  flattenTitlesWithSubmenu: string[];
}

/**
 * Issue #177 — each flatten variant is its own folder-menu entry, so the variant is chosen when the
 * command is invoked instead of being pre-committed in settings.
 *
 * This is also the answer to "how noisy does that make the menu?": the entries are counted in a real
 * Obsidian with `Should add commands to submenu` both ON and OFF, so the trade-off is measured rather
 * than imagined.
 */
describe('flatten folder menu entries (issue #177)', () => {
  it('offers one entry per flatten variant, with the submenu setting on and off', async () => {
    const result = await evalInObsidian({
      async callback({ app, obsidianModule, pluginId, pluginName, submenuSettingName }): Promise<MenuProbe> {
        const RENDER_DELAY_IN_MILLISECONDS = 300;

        await trashIfExists('flat-menu-src');
        await app.vault.createFolder('flat-menu-src');
        await app.vault.createFolder('flat-menu-src/sub');
        await app.vault.create('flat-menu-src/note.md', 'body');

        const folder = app.vault.getFolderByPath('flat-menu-src');
        if (!folder) {
          throw new Error('flat-menu-src was not created.');
        }

        try {
          await setSubmenu(true);
          const flattenTitlesWithSubmenu = collectFlattenTitles(folder);

          await setSubmenu(false);
          const flattenTitlesWithoutSubmenu = collectFlattenTitles(folder);

          return { flattenTitlesWithoutSubmenu, flattenTitlesWithSubmenu };
        } finally {
          await setSubmenu(true);
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

        async function setSubmenu(shouldEnable: boolean): Promise<void> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const settingTab = app.setting.pluginTabs.find((tab) => tab.id === pluginId);
          if (!settingTab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const settingItems = [...settingTab.containerEl.querySelectorAll('.setting-item')];
          const settingItem = settingItems.find((el) => el.querySelector('.setting-item-name')?.textContent === submenuSettingName);
          const toggleEl = settingItem?.querySelector('.checkbox-container');
          if (!(toggleEl instanceof HTMLElement)) {
            throw new TypeError(`"${submenuSettingName}" toggle was not found.`);
          }

          if (toggleEl.classList.contains('is-enabled') !== shouldEnable) {
            toggleEl.click();
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }
      },
      input: { pluginId: PLUGIN_ID, pluginName: PLUGIN_NAME, submenuSettingName: SUBMENU_SETTING_NAME },
      vaultPath: getTemporaryVault().path
    });

    // All three variants are reachable straight from the folder menu — the point of the issue. The
    // Original `Flatten folder...` wording is kept for the default variant, matching its unchanged
    // Command id so existing hotkeys survive.
    const expectedTitles = [
      'Flatten folder...',
      'Flatten folder (child folders only)...',
      'Flatten folder recursively (all folders at any depth)...'
    ];
    expect(result.flattenTitlesWithSubmenu).toStrictEqual(expectedTitles);
    expect(result.flattenTitlesWithoutSubmenu).toStrictEqual(expectedTitles);
  });
});
