import type {
  Editor,
  TFile
} from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
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

describe('block commands on excluded paths (issue #93)', () => {
  it('hides Advanced Note Composer commands on an excluded path only when the setting is on', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 150;
        const EDIT_SAVE_DELAY_IN_MILLISECONDS = 300;
        // Use a command that ONLY Advanced Note Composer provides (Obsidian's core Note Composer plugin
        // Also adds an "Extract current selection..." editor-menu item, which would confuse a title match).
        const ANC_COMMAND_TITLE = 'Mark selection to move';
        const ANC_COMMAND_ID = `${pluginId}:mark-selection-to-move`;
        const EXCLUDED_FOLDER = 'anc-block-demo';
        const EXCLUDED_NOTE = `${EXCLUDED_FOLDER}/blocked.md`;
        const INCLUDED_NOTE = 'anc-block-included.md';

        await app.vault.createFolder(EXCLUDED_FOLDER).catch(() => undefined);
        const excludedFile = await ensureMarkdownFile(EXCLUDED_NOTE, 'alpha bravo charlie');
        const includedFile = await ensureMarkdownFile(INCLUDED_NOTE, 'delta echo foxtrot');

        // Flat menu items (no submenu) so the added command is directly in `menu.items`.
        await setToggle('Should add commands to submenu', false);
        await setExcludePaths(EXCLUDED_FOLDER);

        // --- Blocking OFF: the command is available and appears in the editor menu on the excluded note.
        await setToggle('Should block commands on excluded paths', false);
        const blockingOffOnExcluded = await probeExtractCommand(excludedFile);

        // --- Blocking ON: the command disappears from the palette and the editor menu on the excluded note.
        await setToggle('Should block commands on excluded paths', true);
        const blockingOnOnExcluded = await probeExtractCommand(excludedFile);

        // --- Blocking ON but the note is NOT excluded: the command is still available there.
        const blockingOnOnIncluded = await probeExtractCommand(includedFile);

        // Restore the shared instance to a clean default state.
        await setExcludePaths('');
        await setToggle('Should block commands on excluded paths', false);
        await setToggle('Should add commands to submenu', true);

        return { blockingOffOnExcluded, blockingOnOnExcluded, blockingOnOnIncluded };

        async function probeExtractCommand(file: TFile): Promise<ProbeResult> {
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
          const inMenu = menuItemTitles(menu).some((title) => title.includes(ANC_COMMAND_TITLE));
          menu.hide();

          return { inMenu, isAvailable };
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

        async function setExcludePaths(value: string): Promise<void> {
          const settingTab = await openSettingTab();
          const settingItems = Array.from(settingTab.containerEl.querySelectorAll('.setting-item'));
          const settingItem = settingItems.find((el) => el.querySelector('.setting-item-name')?.textContent === 'Exclude paths');
          const textAreaEl = settingItem?.querySelector('textarea');
          if (!(textAreaEl instanceof HTMLTextAreaElement)) {
            throw new Error('"Exclude paths" text area was not found.');
          }
          textAreaEl.value = value;
          textAreaEl.dispatchEvent(new Event('input'));
          await sleep(EDIT_SAVE_DELAY_IN_MILLISECONDS);
          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        }

        async function setToggle(settingName: string, shouldEnable: boolean): Promise<void> {
          const settingTab = await openSettingTab();
          const settingItems = Array.from(settingTab.containerEl.querySelectorAll('.setting-item'));
          const settingItem = settingItems.find((el) => el.querySelector('.setting-item-name')?.textContent === settingName);
          const toggleEl = settingItem?.querySelector('.checkbox-container');
          if (!(toggleEl instanceof HTMLElement)) {
            throw new Error(`"${settingName}" toggle was not found.`);
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
      vaultPath: getTempVault().path
    });

    // Off: the command is available (palette) and present in the editor menu on the excluded note.
    expect(result.blockingOffOnExcluded.isAvailable).toBe(true);
    expect(result.blockingOffOnExcluded.inMenu).toBe(true);

    // On: the command is blocked (palette) and absent from the editor menu on the excluded note.
    expect(result.blockingOnOnExcluded.isAvailable).toBe(false);
    expect(result.blockingOnOnExcluded.inMenu).toBe(false);

    // On, but the note is not excluded: the command stays available and present.
    expect(result.blockingOnOnIncluded.isAvailable).toBe(true);
    expect(result.blockingOnOnIncluded.inMenu).toBe(true);
  });
});
