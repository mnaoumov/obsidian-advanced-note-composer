import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsTab } from '../plugin-settings-tab.ts';

import { findSettingItemInObsidian } from '../settings-tab-navigation.ts';

/*
 * Issue #317: the reporter's editor menu was taller than the screen, half of it this plugin's commands.
 *
 * Two halves. With the default settings every command goes under ONE `Advanced Note Composer` entry, so
 * the menu itself gains a single row (that is what the reporter had turned off). And the `Hide all` button
 * on the `UI` page takes every command out of the menus in one click, while `Reset` brings them back.
 *
 * The menu is raised through the workspace event and then shown, because `Menu.sort()` - which is what
 * folds a section into its submenu - runs when a menu is shown.
 *
 * Desktop-only: the editor context menu is a desktop surface.
 * Isolation: `npx vitest run --project integration-tests:desktop src/settings/command-visibility/command-menus-hide-all.desktop.integration.test.ts`.
 */
const PLUGIN_ID = 'advanced-note-composer';

interface MenuItemLike {
  readonly dom?: HTMLElement;
  readonly submenu?: MenuLike | null;
}

interface MenuLike {
  readonly items: MenuItemLike[];
}

interface MenuProbe {
  readonly pluginSubmenuItemCount: number;
  readonly topLevelTitles: string[];
}

describe('command menus for all commands (issue #317)', () => {
  it('keeps the commands under one submenu entry, and hides and resets them all in one click', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingItem, lib: { waitUntil }, obsidianModule, pluginId }) {
        /**
         * The waits below are four menu probes plus two settings openings, all fast on a healthy machine; the
         * sum stays well under the transport's 30 s per-closure cap.
         */
        const WAIT_TIMEOUT_IN_MILLISECONDS = 4000;
        const RENDER_DELAY_IN_MILLISECONDS = 150;
        const SUBMENU_TITLE = 'Advanced Note Composer';
        const ALL_COMMANDS_ROW_NAME = 'Command menus for all commands';

        const file = await app.vault.create('anc-317-menus.md', ['# Chapter 1', '', 'Body of chapter 1.', '', '## Section A', '', 'Body of section A.'].join('\n'));
        await app.workspace.getLeaf(false).openFile(file);
        await waitUntil({
          message: 'headings were not indexed',
          predicate: () => (app.metadataCache.getFileCache(file)?.headings?.length ?? 0) >= 2,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        const byDefault = probeEditorMenu();
        await clickAllCommandsButton('Hide all');
        const afterHideAll = probeEditorMenu();
        await clickAllCommandsButton('Reset');
        const afterReset = probeEditorMenu();

        return { afterHideAll, afterReset, byDefault };

        function probeEditorMenu(): MenuProbe {
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          view.editor.setCursor({ ch: 3, line: 2 });
          const menu = new obsidianModule.Menu();
          app.workspace.trigger('editor-menu', menu, view.editor, view);
          menu.showAtPosition({ x: 10, y: 10 });
          const probe = describeItems(menu);
          menu.hide();
          return probe;
        }

        function describeItems(menu: MenuLike): MenuProbe {
          const topLevelTitles = menu.items.map((item) => item.dom?.textContent ?? '');
          const pluginSubmenu = menu.items.find((item) => item.dom?.textContent === SUBMENU_TITLE)?.submenu;
          return { pluginSubmenuItemCount: pluginSubmenu?.items.length ?? 0, topLevelTitles };
        }

        async function clickAllCommandsButton(buttonText: string): Promise<void> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const settingTab = await openSettingTab();
          const settingItem = await findSettingItem({ app, name: ALL_COMMANDS_ROW_NAME, settingTab });
          const button = [...(settingItem?.querySelectorAll('button') ?? [])].find((candidate) => candidate.textContent === buttonText);
          if (!button) {
            throw new Error(`"${ALL_COMMANDS_ROW_NAME}" has no "${buttonText}" button.`);
          }
          button.click();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
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
        pluginId: PLUGIN_ID
      },
      vaultPath: getTemporaryVault().path
    });

    // By default the plugin adds ONE row to the menu, holding its commands.
    expect(result.byDefault.topLevelTitles.filter((title) => title === 'Advanced Note Composer')).toHaveLength(1);
    expect(result.byDefault.pluginSubmenuItemCount).toBeGreaterThan(1);
    expect(result.byDefault.topLevelTitles).not.toContain('Split note by headings recursively...');

    // One click took every command out of the menu.
    expect(result.afterHideAll.topLevelTitles).not.toContain('Advanced Note Composer');

    // And one click brought them back, leaving the shared instance as the suites after this one expect.
    expect(result.afterReset.pluginSubmenuItemCount).toBe(result.byDefault.pluginSubmenuItemCount);
  });
});
