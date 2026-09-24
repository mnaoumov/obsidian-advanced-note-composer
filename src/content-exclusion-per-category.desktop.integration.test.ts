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
// drives the settings tab and a folder context menu, both desktop-only surfaces here. Version coverage: settings-gated
// filtering with no dependence on minified internals or version-sensitive DOM, so public-latest suffices.
// Isolation: `npx vitest run --project integration-tests:desktop src/content-exclusion-per-category.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface MenuItemLike {
  dom?: HTMLElement;
}

interface MenuLike {
  hide: () => void;
  items: MenuItemLike[];
}

describe('per-category content exclusion (issue #270)', () => {
  it('drops a folder from the reorder modal without excluding it from the other commands', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingItem, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        /**
         * Sized so the SUM of every wait this closure declares stays under the transport's ~30 s per-closure
         * cap, not at it. Before this shared budget it declared 46 000 ms, so the eval could only ever die
         * as a bare transport timeout - which names the harness rather than the wait that overran. Every step
         * waited for here settles in well under a second on a healthy machine. A helper that waits is charged
         * once per CALL SITE, so adding a call to one adds a whole ceiling: re-divide this budget by the new
         * count, not by the `waitUntil` calls the body shows.
         */
        const WAIT_TIMEOUT_IN_MILLISECONDS = 2500;
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const EDIT_SAVE_DELAY_IN_MILLISECONDS = 300;
        const ROOT = 'Content exclusion per category';
        const EXCLUDED_FOLDER = `${ROOT}/2. Beta`;

        // Three numbered siblings, the same fixture shape `reorder-child-folders` uses — the modal lists
        // them by name without their numbers.
        await removeFolder(ROOT);
        await app.vault.createFolder(ROOT);
        for (const [index, name] of ['Alpha', 'Beta', 'Gamma'].entries()) {
          await app.vault.createFolder(`${ROOT}/${(index + 1).toString()}. ${name}`);
        }

        const nothingConfigured = await readReorderRows();

        // The reporter's own case, in the vault: one category's content list drops the folder from that
        // command and leaves the rest of the plugin using it.
        await setPaths('Reorder exclude paths', EXCLUDED_FOLDER);
        const reorderExcluded = await readReorderRows();

        // The isolation that #249's per-category pair could not give: the SAME path under a different
        // category's content list changes nothing here. Before the per-category split this would have had
        // to be the all-commands `Exclude paths` list, which took the folder away from every command at
        // once — and which issue #271 has since retired outright.
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
          // title of its own.
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
          // resolves the parent from Obsidian's own new-note location, not from this folder.
          const menu = new obsidianModule.Menu();
          app.workspace.trigger('file-menu', menu, rootFolder, 'file-explorer-context-menu');
          clickMenuItem(menu, 'Reorder child folders...');

          await waitUntil({
            message: 'reorder modal did not open',
            predicate: () => document.querySelector('.advanced-note-composer-reorder-list') !== null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const rowLabels = [...document.querySelectorAll<HTMLElement>('.advanced-note-composer-reorder-item')]
            .map((itemEl) => itemEl.dataset['rowLabel']);

          // Discarded rather than confirmed: nothing here is about performing a reorder, and a confirmed
          // one would renumber the fixture out from under the next probe.
          await pressKey({ key: 'Escape' });
          await waitUntil({
            message: 'Escape did not close the reorder modal',
            predicate: () => document.querySelector('.advanced-note-composer-reorder-list') === null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
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
    // vacuous.
    expect(result.nothingConfigured).toEqual(['Alpha', 'Beta', 'Gamma']);

    // `Reorder exclude paths` takes the one folder out of the reorder modal — the reporter's ask.
    expect(result.reorderExcluded).toEqual(['Alpha', 'Gamma']);

    // And a different category's list over the same path leaves the reorder untouched. This is the
    // assertion that fails if the category is ever dropped on the way to `isPathIgnored`.
    expect(result.mergeExcludedOnly).toEqual(['Alpha', 'Beta', 'Gamma']);

    expect(result.restored).toEqual(['Alpha', 'Beta', 'Gamma']);
  });
});

describe('excluding a folder by itself alone (issue #279)', () => {
  it('keeps the folders inside it reorderable, while a plain-path exclude still takes the command away', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingItem, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        /**
         * One reorder modal is opened and closed, so the closure declares exactly two ceilings: 5 000 ms in
         * total, far under the transport's ~30 s per-closure cap.
         */
        const WAIT_TIMEOUT_IN_MILLISECONDS = 2500;
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const EDIT_SAVE_DELAY_IN_MILLISECONDS = 300;
        const ROOT = 'Excluded by itself alone';
        const INBOX = `${ROOT}/Inbox`;
        const INBOX_CHILD = `${INBOX}/Alpha`;
        const REORDER_SIBLINGS = 'Reorder sibling folders...';

        await removeFolder(ROOT);
        await app.vault.createFolder(ROOT);
        await app.vault.createFolder(INBOX);
        await app.vault.createFolder(INBOX_CHILD);
        await app.vault.createFolder(`${INBOX}/Beta`);

        // The reporter's exact value: anchored with `$`, so it matches `Inbox` and nothing inside it.
        await setPaths('Reorder exclude paths', String.raw`/(^|.*\/)Inbox$/`);
        const noticeCountBefore = readNoticeTexts().length;
        const regexRows = await readSiblingRows();
        const regexNotices = readNoticeTexts().slice(noticeCountBefore);

        // The control: a plain path covers the folder AND its subtree, so every sibling is excluded and the
        // command has nothing left to reorder there.
        await setPaths('Reorder exclude paths', INBOX);
        const isOfferedUnderPlainPath = buildMenuTitles().includes(REORDER_SIBLINGS);

        await setPaths('Reorder exclude paths', '');
        const isOfferedWithNothingConfigured = buildMenuTitles().includes(REORDER_SIBLINGS);

        await removeFolder(ROOT);

        return { isOfferedUnderPlainPath, isOfferedWithNothingConfigured, regexNotices, regexRows };

        function buildMenu(): MenuLike {
          const folder = app.vault.getFolderByPath(INBOX_CHILD);
          if (!(folder instanceof obsidianModule.TFolder)) {
            throw new TypeError(`No folder at ${INBOX_CHILD}.`);
          }
          const menu = new obsidianModule.Menu();
          app.workspace.trigger('file-menu', menu, folder, 'file-explorer-context-menu');
          return menu;
        }

        function buildMenuTitles(): string[] {
          const menu = buildMenu();
          const titles = menu.items.map((candidate) => candidate.dom?.textContent ?? '');
          menu.hide();
          return titles;
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

        function readNoticeTexts(): string[] {
          // Notices render into `activeDocument`, not the `document` a closure sees by default.
          return [...activeDocument.querySelectorAll<HTMLElement>('.notice')].map((noticeEl) => noticeEl.textContent);
        }

        async function readSiblingRows(): Promise<(string | undefined)[]> {
          const menu = buildMenu();
          const itemEl = menu.items.find((candidate) => candidate.dom?.textContent === REORDER_SIBLINGS)?.dom;
          if (!itemEl) {
            menu.hide();
            throw new TypeError(`No menu item "${REORDER_SIBLINGS}".`);
          }
          itemEl.click();

          await waitUntil({
            message: 'reorder modal did not open',
            predicate: () => document.querySelector('.advanced-note-composer-reorder-list') !== null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const rowLabels = [...document.querySelectorAll<HTMLElement>('.advanced-note-composer-reorder-item')]
            .map((rowEl) => rowEl.dataset['rowLabel']);

          // Discarded rather than confirmed: renaming the fixture is not what this asks about.
          await pressKey({ key: 'Escape' });
          await waitUntil({
            message: 'Escape did not close the reorder modal',
            predicate: () => document.querySelector('.advanced-note-composer-reorder-list') === null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
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

    // The reporter's ask: the siblings inside the excluded folder open in the modal, with no refusal notice.
    expect(result.regexRows).toEqual(['Alpha', 'Beta']);
    expect(result.regexNotices.filter((text) => text.includes('ignored in the plugin settings'))).toEqual([]);

    // The plain path keeps excluding the subtree, and it is that exclusion which removes the entry: the
    // command is offered again once the list is empty.
    expect(result.isOfferedUnderPlainPath).toBe(false);
    expect(result.isOfferedWithNothingConfigured).toBe(true);
  });
});
