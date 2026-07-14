import type {
  Editor,
  TFile
} from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsTab } from './plugin-settings-tab.ts';

const PLUGIN_ID = 'advanced-note-composer';

describe('Smart cut & paste notice settings', () => {
  it('shows/hides the notice and its move buttons according to the settings', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 150;
        const EDIT_SAVE_DELAY_IN_MILLISECONDS = 300;

        const ALL_TOGGLES = [
          'Should show smart cut & paste notice',
          'Should show move to top of file button',
          'Should show move to bottom of file button',
          'Should show move at cursor button'
        ];

        const sourceFile = await ensureMarkdownFile('anc-smart-cut-settings.md', 'alpha bravo charlie');
        await openAndGetEditor(sourceFile);

        // Everything on (the defaults): all three move buttons plus Cancel move.
        await setAllToggles(true);
        const allOn = await markAndReadButtons();

        // Each move button hidden in turn.
        await setToggle('Should show move to top of file button', false);
        const topOff = await markAndReadButtons();
        await setToggle('Should show move to top of file button', true);

        await setToggle('Should show move to bottom of file button', false);
        const bottomOff = await markAndReadButtons();
        await setToggle('Should show move to bottom of file button', true);

        await setToggle('Should show move at cursor button', false);
        const atCursorOff = await markAndReadButtons();
        await setToggle('Should show move at cursor button', true);

        // Notice disabled entirely: no notice element appears at all.
        await setToggle('Should show smart cut & paste notice', false);
        const noticeOff = await markAndReadButtons();
        await setToggle('Should show smart cut & paste notice', true);

        // Restore the defaults so the shared Obsidian instance is left in a clean state.
        await setAllToggles(true);

        return { allOn, atCursorOff, bottomOff, noticeOff, topOff };

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
          await waitUntil({ predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor !== undefined });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          return view.editor;
        }

        function moveNoticeButtonLabels(): string[] {
          const container = document.querySelector('.advanced-note-composer-move-notice-buttons');
          if (!container) {
            return [];
          }
          return [...container.querySelectorAll('button')].map((buttonEl) => buttonEl.textContent);
        }

        // Selects the text again, marks it to move, waits for the mark to settle, captures the notice
        // Button labels, then cancels the move so the next scenario starts from a clean, unlocked state.
        async function markAndReadButtons(): Promise<string[]> {
          const editor = await openAndGetEditor(sourceFile);
          editor.setSelection(editor.offsetToPos(0), editor.offsetToPos(5));
          app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
          await sleep(EDIT_SAVE_DELAY_IN_MILLISECONDS);

          const labels = moveNoticeButtonLabels();

          app.commands.executeCommandById(`${pluginId}:cancel-move`);
          await waitUntil({ predicate: () => document.querySelector('.advanced-note-composer-move-notice-buttons') === null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return labels;
        }

        async function setAllToggles(shouldEnable: boolean): Promise<void> {
          for (const name of ALL_TOGGLES) {
            await setToggle(name, shouldEnable);
          }
        }

        async function setToggle(settingName: string, shouldEnable: boolean): Promise<void> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const settingTab = app.setting.pluginTabs.find((tab) => tab.id === pluginId);
          if (!settingTab) {
            throw new Error('Settings tab was not found.');
          }
          (settingTab as PluginSettingsTab).displayLegacy();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

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
      },
      vaultPath: getTempVault().path
    });

    expect(result.allOn).toEqual([
      'Move marked selection to top of file',
      'Move marked selection to bottom of file',
      'Move marked selection at cursor',
      'Cancel move'
    ]);
    expect(result.topOff).toEqual([
      'Move marked selection to bottom of file',
      'Move marked selection at cursor',
      'Cancel move'
    ]);
    expect(result.bottomOff).toEqual([
      'Move marked selection to top of file',
      'Move marked selection at cursor',
      'Cancel move'
    ]);
    expect(result.atCursorOff).toEqual([
      'Move marked selection to top of file',
      'Move marked selection to bottom of file',
      'Cancel move'
    ]);
    // Notice disabled: no notice, hence no buttons at all.
    expect(result.noticeOff).toEqual([]);
  });
});
