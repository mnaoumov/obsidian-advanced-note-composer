import type {
  TFile,
  TFolder
} from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsTab } from './plugin-settings-tab.ts';

// Desktop-only: this drives the file-explorer folder context menu and the real folder-picker suggester
// DOM, matching the plugin's established integration convention (no Android emulator is wired for it).
// G99: the behavior under test depends on an Obsidian INTERNAL — `RecentFileTracker` collects the file
// You just LEFT, not the one you just opened — so it must be verified on both ends; a change there would
// Silently reorder every picker. Run on BOTH: catalyst-latest 1.13.4 and public-latest 1.12.7, green on
// Each. Pin the other end with the desktop project's `environmentOptions.obsidianTransport.obsidianVersion`.
// Isolation: `npx vitest run --project integration-tests:desktop src/recent-folder-order.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface MenuItemLike {
  callback?(): void;
  dom?: HTMLElement;

  /**
   * The menu section, which every command handler sets to the plugin's name. Obsidian core contributes
   * a folder-menu item titled `Move folder to...` too, so the title alone does not identify ours.
   */
  section?: string;
}

interface MenuLike {
  hide(): void;
  items: MenuItemLike[];
}

describe('recent folder ordering (issue #158)', () => {
  it('offers the folder of the note you are on first when the command runs on another folder', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const EDIT_SAVE_DELAY_IN_MILLISECONDS = 300;
        const MERGE_ITEM_TITLE = 'Merge entire folder with...';
        const MOVE_ITEM_TITLE = 'Move folder to...';
        const SUBMENU_SETTING_NAME = 'Should add commands to submenu';
        const pluginName = app.plugins.manifests[pluginId]?.name ?? '';

        // Flat menu items (no submenu) so the folder commands are directly in `menu.items`.
        await setToggle(SUBMENU_SETTING_NAME, false);
        try {
          for (const name of ['rc-a', 'rc-b', 'rc-c']) {
            await trashIfExists(name);
            await app.vault.createFolder(name);
            await app.vault.create(`${name}/${name}.md`, `${name} body`);
          }

          // The reporter's exact steps: visit the three notes in order, ending on `rc-c`.
          await openFile(getFile('rc-a/rc-a.md'));
          await openFile(getFile('rc-b/rc-b.md'));
          await openFile(getFile('rc-c/rc-c.md'));

          // Obsidian's own recent list, for the record: its head is the note we LEFT (`rc-b`), never the
          // Note we are on (`rc-c`).
          const recentPaths = app.workspace.getRecentFiles({ showMarkdown: true }).slice(0, 2);

          // The commands are triggered on `rc-b`, so `rc-b` is the source and is never offered.
          const sourceFolder = getFolder('rc-b');
          const mergeFirstSuggestion = await firstPickerSuggestion(sourceFolder, MERGE_ITEM_TITLE);
          const moveFirstSuggestion = await firstPickerSuggestion(sourceFolder, MOVE_ITEM_TITLE);

          return { mergeFirstSuggestion, moveFirstSuggestion, recentPaths };
        } finally {
          await setToggle(SUBMENU_SETTING_NAME, true);
        }

        async function firstPickerSuggestion(folder: TFolder, itemTitle: string): Promise<string> {
          const menu = new obsidianModule.Menu();
          app.workspace.trigger('file-menu', menu, folder, 'file-explorer-context-menu');
          const menuItem = (menu as MenuLike).items.find((item) => item.section === pluginName && (item.dom?.textContent ?? '').includes(itemTitle));
          (menu as MenuLike).hide();
          if (!menuItem) {
            throw new Error(`"${itemTitle}" was not in the plugin's section of the folder menu.`);
          }

          menuItem.callback?.();
          await waitUntil({
            message: `the picker for "${itemTitle}" did not open`,
            predicate: () => document.querySelector('.suggestion-item') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const firstSuggestion = document.querySelector('.suggestion-item')?.textContent ?? '';

          // Close the picker without running anything: this test only checks ordering.
          const input = document.querySelector('.prompt-input');
          if (input instanceof HTMLInputElement) {
            input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Escape', key: 'Escape' }));
          }
          await waitUntil({
            message: `the picker for "${itemTitle}" did not close`,
            predicate: () => document.querySelector('.prompt') === null
          });
          return firstSuggestion;
        }

        function getFile(path: string): TFile {
          const file = app.vault.getFileByPath(path);
          if (!file) {
            throw new Error(`${path} was not found.`);
          }
          return file;
        }

        function getFolder(path: string): TFolder {
          const folder = app.vault.getFolderByPath(path);
          if (!folder) {
            throw new Error(`${path} was not found.`);
          }
          return folder;
        }

        async function openFile(file: TFile): Promise<void> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
          });
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

        async function setToggle(settingName: string, shouldEnable: boolean): Promise<void> {
          const settingTab = await openSettingTab();
          const settingItems = Array.from(settingTab.containerEl.querySelectorAll('.setting-item'));
          const settingItem = settingItems.find((el) => el.querySelector('.setting-item-name')?.textContent === settingName);
          const toggleEl = settingItem?.querySelector('.checkbox-container');
          if (!(toggleEl instanceof HTMLElement)) {
            throw new Error(`"${settingName}" toggle was not found.`);
          }
          if (toggleEl.classList.contains('is-enabled') !== shouldEnable) {
            toggleEl.click();
            await sleep(EDIT_SAVE_DELAY_IN_MILLISECONDS);
          }
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
      vaultPath: getTempVault().path
    });

    // The premise this fix rests on: Obsidian's recent list is headed by the note we LEFT, never by the
    // Note we are on. If this ever changes, the fix below needs revisiting.
    expect(result.recentPaths[0]).toBe('rc-b/rc-b.md');

    // Both folder pickers put the folder of the note we are on (`rc-c`) first — the reported bug was
    // That the FIRST suggestion was `rc-a`, the least recently visited of the three.
    expect(result.mergeFirstSuggestion).toBe('rc-c');
    expect(result.moveFirstSuggestion).toBe('rc-c');
  });
});
