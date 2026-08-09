import type {
  Editor,
  TFile
} from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsTab } from './plugin-settings-tab.ts';

// Desktop-only: this exercises the command palette + editor context menu, which are desktop-only
// Surfaces here (matching the plugin's established integration convention; no Android emulator is
// Wired for it). G99: this feature is pure plugin logic (a settings-gated `canExecute*` guard) with
// No dependence on minified Obsidian internals, version-sensitive DOM, or serialization formats, so
// Verifying on public-latest is sufficient; there is nothing internals-specific to differ on catalyst.
// Isolation: `npx vitest run --project integration-tests:desktop src/command-blocking.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface MenuItemLike {
  dom?: HTMLElement;
}

interface MenuLike {
  items: MenuItemLike[];
}

interface ProbeResult {
  readonly inMenu: boolean;
  readonly isAvailable: boolean;
}

describe('block commands on excluded paths (issues #93, #198)', () => {
  it('hides Advanced Note Composer commands from the command path lists alone', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 150;
        const EDIT_SAVE_DELAY_IN_MILLISECONDS = 300;
        // Use a command that ONLY Advanced Note Composer provides (Obsidian's core Note Composer plugin
        // Also adds an "Extract current selection..." editor-menu item, which would confuse a title match).
        const ANC_COMMAND_TITLE = 'Mark selection to move';
        const ANC_COMMAND_ID = `${pluginId}:mark-selection-to-move`;
        const BLOCKED_FOLDER = 'anc-block-demo';
        const BLOCKED_NOTE = `${BLOCKED_FOLDER}/blocked.md`;
        const OTHER_NOTE = 'anc-block-included.md';

        await app.vault.createFolder(BLOCKED_FOLDER).catch(() => undefined);
        const blockedFile = await ensureMarkdownFile(BLOCKED_NOTE, 'alpha bravo charlie');
        const otherFile = await ensureMarkdownFile(OTHER_NOTE, 'delta echo foxtrot');

        // Flat menu items (no submenu) so the added command is directly in `menu.items`.
        await setToggle('Should add commands to submenu', false);

        // --- Nothing configured: the command is available and in the editor menu everywhere.
        const noPathsConfigured = await probeCommand(blockedFile);

        // --- Issue #198: excluding the path from merges/splits must NOT hide its commands. They stay
        // --- Visible and refuse with an "ignored in the plugin settings" notice when triggered.
        await setPaths('Exclude paths', BLOCKED_FOLDER);
        const contentExcludedOnly = await probeCommand(blockedFile);

        // --- Listing it in the command filter is what hides it, independently of the list above.
        await setPaths('Command exclude paths', BLOCKED_FOLDER);
        const commandExcluded = await probeCommand(blockedFile);
        const commandExcludedElsewhere = await probeCommand(otherFile);

        // --- The include half: restrict the commands to one folder and they vanish outside it.
        await setPaths('Exclude paths', '');
        await setPaths('Command exclude paths', '');
        await setPaths('Command include paths', BLOCKED_FOLDER);
        const commandIncludedInside = await probeCommand(blockedFile);
        const commandIncludedOutside = await probeCommand(otherFile);

        // Restore the shared instance to a clean default state.
        await setPaths('Command include paths', '');
        await setToggle('Should add commands to submenu', true);

        return {
          commandExcluded,
          commandExcludedElsewhere,
          commandIncludedInside,
          commandIncludedOutside,
          contentExcludedOnly,
          noPathsConfigured
        };

        async function probeCommand(file: TFile): Promise<ProbeResult> {
          const editor = await openAndGetEditor(file);
          editor.setSelection(editor.offsetToPos(0), editor.offsetToPos(5));
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }

          const command = app.commands.commands[ANC_COMMAND_ID];
          const isAvailable = command?.editorCheckCallback?.(true, editor, view) === true;

          const menu = new obsidianModule.Menu();
          app.workspace.trigger('editor-menu', menu, editor, view);
          const isInMenu = menuItemTitles(menu).some((title) => title.includes(ANC_COMMAND_TITLE));
          menu.hide();

          return { inMenu: isInMenu, isAvailable };
        }

        function menuItemTitles(menu: MenuLike): string[] {
          return menu.items.map((item) => item.dom?.textContent ?? '');
        }

        async function ensureMarkdownFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          return app.vault.create(path, content);
        }

        async function openAndGetEditor(file: TFile): Promise<Editor> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({ predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          return view.editor;
        }

        async function setPaths(settingName: string, value: string): Promise<void> {
          const settingTab = await openSettingTab();
          const settingItems = [...settingTab.containerEl.querySelectorAll('.setting-item')];
          const settingItem = settingItems.find((el) => el.querySelector('.setting-item-name')?.textContent === settingName);
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

        async function setToggle(settingName: string, shouldEnable: boolean): Promise<void> {
          const settingTab = await openSettingTab();
          const settingItems = [...settingTab.containerEl.querySelectorAll('.setting-item')];
          const settingItem = settingItems.find((el) => el.querySelector('.setting-item-name')?.textContent === settingName);
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
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // Nothing configured: the command is available (palette) and present in the editor menu.
    expect(result.noPathsConfigured.isAvailable).toBe(true);
    expect(result.noPathsConfigured.inMenu).toBe(true);

    // Issue #198: `Exclude paths` alone no longer hides commands — that is the whole point of the split.
    expect(result.contentExcludedOnly.isAvailable).toBe(true);
    expect(result.contentExcludedOnly.inMenu).toBe(true);

    // `Command exclude paths` hides it from the palette and the editor menu, and only there.
    expect(result.commandExcluded.isAvailable).toBe(false);
    expect(result.commandExcluded.inMenu).toBe(false);
    expect(result.commandExcludedElsewhere.isAvailable).toBe(true);
    expect(result.commandExcludedElsewhere.inMenu).toBe(true);

    // `Command include paths` restricts the commands to the listed folder.
    expect(result.commandIncludedInside.isAvailable).toBe(true);
    expect(result.commandIncludedInside.inMenu).toBe(true);
    expect(result.commandIncludedOutside.isAvailable).toBe(false);
    expect(result.commandIncludedOutside.inMenu).toBe(false);
  });
});
