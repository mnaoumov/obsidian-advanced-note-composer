import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsTab } from './plugin-settings-tab.ts';

import { MENU_PLACEABLE_COMMANDS } from './menu-placeable-commands.ts';
import { findSettingItemInObsidian } from './settings-tab-navigation.ts';

/*
 * Desktop-only: this exercises two editor context menus, a desktop-only surface. G99: the placement logic
 * is pure plugin logic on top of `obsidian-dev-utils`' `shouldAddToViewportMenu`, so public-latest is
 * enough.
 *
 * The menus are raised by triggering the workspace events directly, exactly as
 * `split-note-by-headings-menu-detection.desktop.integration.test.ts` does — NOT by dispatching a
 * `contextmenu` event. Obsidian's own listener for the viewport menu gates on `e.isTrusted`, so a
 * synthetic event is ignored outright and would make this test pass for the wrong reason. What is under
 * test is which menu the plugin puts its item in, and the trigger is what the plugin actually listens to.
 *
 * Isolation: `npx vitest run --project integration-tests:desktop src/command-menu-placement.desktop.integration.test.ts`.
 */
const PLUGIN_ID = 'advanced-note-composer';

interface MenuItemLike {
  dom?: HTMLElement;
}

interface MenuLike {
  items: MenuItemLike[];
}

interface ProbeResult {
  readonly isInEditorMenu: boolean;
  readonly isInReadingModeViewportMenu: boolean;
  readonly isInViewportMenu: boolean;
  readonly isSiblingInEditorMenu: boolean;
  readonly isSiblingInViewportMenu: boolean;
}

describe('command menu placement (issues #252, #254)', () => {
  it('moves ONE command from the editor menu onto the readable-line-length margin, leaving its siblings', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingItem, lib: { waitUntil }, menuPlaceableCommandIds, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 150;
        const EDIT_SAVE_DELAY_IN_MILLISECONDS = 300;
        const ITEM_TITLE = 'Split note by headings recursively...';
        const NOTE_PATH = 'anc-menu-placement.md';
        const NOTE_CONTENT = [
          '# Chapter 1',
          '',
          'Body of chapter 1.',
          '',
          '## Section A',
          '',
          'Body of section A.'
        ].join('\n');
        // Since issue #254 the placement row IS the command, and carries a toggle per menu.
        // A sibling in the SAME category that this note offers with no selection made — issue #188 hides
        // The selection-driven extracts, which would fail here for a reason that is not placement.
        const SIBLING_ITEM_TITLE = 'Split note by headings - H1';
        const SOURCE_MODE = 'source';
        const PREVIEW_MODE = 'preview';
        const MENU_SOURCE = 'gutter';

        const file = await ensureMarkdownFile(NOTE_PATH, NOTE_CONTENT);

        // Flat menu items (no submenu) so the split item sits directly in `menu.items`.
        await setToggle('Should add commands to submenu', false);

        const whileInEditorMenu = await probe(file);
        await setMenuToggles(ITEM_TITLE, false, true);
        const whileOnMargin = await probe(file);

        // Restore the shared instance: this vault is reused by every other suite.
        await setMenuToggles(ITEM_TITLE, true, false);
        await setToggle('Should add commands to submenu', true);
        const afterRestore = await probe(file);

        return {
          afterRestore,
          // Issue #254's own guarantee: the table the settings page renders from names commands Obsidian
          // Has actually registered, which is the drift a spelled-out list is exposed to.
          missingCommandIds: menuPlaceableCommandIds.filter((commandId) => !app.commands.findCommand(`${pluginId}:${commandId}`)),
          whileInEditorMenu,
          whileOnMargin
        };

        async function probe(targetFile: TFile): Promise<ProbeResult> {
          await openNote(targetFile);
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }

          const editorMenu = new obsidianModule.Menu();
          app.workspace.trigger('editor-menu', editorMenu, view.editor, view);
          const isInEditorMenu = hasItem(editorMenu, ITEM_TITLE);
          const isSiblingInEditorMenu = hasItem(editorMenu, SIBLING_ITEM_TITLE);
          editorMenu.hide();

          const viewportMenu = new obsidianModule.Menu();
          app.workspace.trigger('markdown-viewport-menu', viewportMenu, view, SOURCE_MODE, MENU_SOURCE);
          const isInViewportMenu = hasItem(viewportMenu, ITEM_TITLE);
          const isSiblingInViewportMenu = hasItem(viewportMenu, SIBLING_ITEM_TITLE);
          viewportMenu.hide();

          const readingModeMenu = new obsidianModule.Menu();
          app.workspace.trigger('markdown-viewport-menu', readingModeMenu, view, PREVIEW_MODE, MENU_SOURCE);
          const isInReadingModeViewportMenu = hasItem(readingModeMenu, ITEM_TITLE);
          readingModeMenu.hide();

          return { isInEditorMenu, isInReadingModeViewportMenu, isInViewportMenu, isSiblingInEditorMenu, isSiblingInViewportMenu };
        }

        function hasItem(menu: MenuLike, itemTitle: string): boolean {
          return menu.items.some((item) => (item.dom?.textContent ?? '').includes(itemTitle));
        }

        async function ensureMarkdownFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          return app.vault.create(path, content);
        }

        async function openNote(targetFile: TFile): Promise<void> {
          await app.workspace.getLeaf(false).openFile(targetFile);
          await waitUntil({
            message: `markdown view for ${targetFile.path} did not become active`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === targetFile.path
          });
          // The menu gate reads the note's headings from `metadataCache`; wait for them to be indexed.
          await waitUntil({
            message: `headings for ${targetFile.path} were not indexed`,
            predicate: () => (app.metadataCache.getFileCache(targetFile)?.headings?.length ?? 0) >= 2
          });
        }

        /**
         * Sets one command's two placement toggles (issue #254). The row is named after the command, and
         * its control area holds the editor-menu toggle first and the margin toggle second — the order
         * `plugin-settings-tab.ts` renders them in.
         *
         * @param commandName - The command's display name, which is the row name.
         * @param shouldBeInEditorMenu - Whether the editor menu should offer it.
         * @param shouldBeOnMargin - Whether the margin menu should offer it.
         */
        async function setMenuToggles(commandName: string, shouldBeInEditorMenu: boolean, shouldBeOnMargin: boolean): Promise<void> {
          for (const [index, shouldEnable] of [shouldBeInEditorMenu, shouldBeOnMargin].entries()) {
            await setMenuToggle(commandName, index, shouldEnable);
          }
        }

        /**
         * Sets ONE of a command's two placement toggles (issue #254). The row is named after the command,
         * and its control area holds the editor-menu toggle first and the margin toggle second — the order
         * `plugin-settings-tab.ts` renders them in.
         *
         * The row is looked up again for each toggle rather than both being captured up front: writing a
         * placement re-renders the settings tab, which detaches the element the second click would land on
         * — and a click on a detached toggle is a silent no-op that reads as "the setting did not work".
         *
         * @param commandName - The command's display name, which is the row name.
         * @param toggleIndex - 0 for the editor menu, 1 for the margin.
         * @param shouldEnable - Whether that menu should offer the command.
         */
        async function setMenuToggle(commandName: string, toggleIndex: number, shouldEnable: boolean): Promise<void> {
          const settingTab = await openSettingTab();
          const settingItem = await findSettingItem({ app, name: commandName, settingTab });
          const toggleEls = [...settingItem?.querySelectorAll('.checkbox-container') ?? []];
          if (toggleEls.length !== 2) {
            throw new TypeError(`"${commandName}" did not render two placement toggles.`);
          }
          const toggleEl = toggleEls[toggleIndex];
          if (!(toggleEl instanceof HTMLElement)) {
            throw new TypeError(`"${commandName}" placement toggle ${String(toggleIndex)} was not an element.`);
          }
          if (toggleEl.classList.contains('is-enabled') !== shouldEnable) {
            toggleEl.click();
            await sleep(EDIT_SAVE_DELAY_IN_MILLISECONDS);
          }
          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        }

        async function setToggle(settingName: string, shouldEnable: boolean): Promise<void> {
          const settingTab = await openSettingTab();
          const settingItem = await findSettingItem({ app, name: settingName, settingTab });
          const toggleEl = settingItem?.querySelector('.checkbox-container');
          if (!(toggleEl instanceof HTMLElement)) {
            throw new TypeError(`"${settingName}" toggle was not found.`);
          }
          const isEnabled = toggleEl.classList.contains('is-enabled');
          if (isEnabled !== shouldEnable) {
            toggleEl.click();
            await sleep(EDIT_SAVE_DELAY_IN_MILLISECONDS);
          }
          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
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
      },
      input: {
        findSettingItem: findSettingItemInObsidian,
        menuPlaceableCommandIds: MENU_PLACEABLE_COMMANDS.map((command) => command.id),
        pluginId: PLUGIN_ID
      },
      vaultPath: getTemporaryVault().path
    });

    // Default placement: the editor menu carries it, the margin menu does not.
    expect(result.whileInEditorMenu.isInEditorMenu).toBe(true);
    expect(result.whileInEditorMenu.isInViewportMenu).toBe(false);

    // Placed on the margin: exactly the swap the reporter asked for.
    expect(result.whileOnMargin.isInEditorMenu).toBe(false);
    expect(result.whileOnMargin.isInViewportMenu).toBe(true);

    // Issue #254: its category sibling did NOT move with it, which the per-category setting could not do.
    expect(result.whileInEditorMenu.isSiblingInEditorMenu).toBe(true);
    expect(result.whileOnMargin.isSiblingInEditorMenu).toBe(true);
    expect(result.whileOnMargin.isSiblingInViewportMenu).toBe(false);

    // Every settings row governs a command Obsidian really registered.
    expect(result.missingCommandIds).toEqual([]);

    // Reading mode raises the same Obsidian event, and is deliberately never offered the command.
    expect(result.whileOnMargin.isInReadingModeViewportMenu).toBe(false);

    // The shared instance is back to the default, so the suites that follow see what they expect.
    expect(result.afterRestore.isInEditorMenu).toBe(true);
    expect(result.afterRestore.isInViewportMenu).toBe(false);
  });
});
