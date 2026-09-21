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

import { findSettingItemInObsidian } from './settings-tab-navigation.ts';

const PLUGIN_ID = 'advanced-note-composer';
const SOURCE_PATH = 'anc-smart-cut-settings.md';
const NOTICE_TOGGLE = 'Should show smart cut & paste notice';
const TO_TOP_TOGGLE = 'Should show move to top of file button';
const TO_BOTTOM_TOGGLE = 'Should show move to bottom of file button';
const AT_CURSOR_TOGGLE = 'Should show move at cursor button';
const ALL_TOGGLES = [NOTICE_TOGGLE, TO_TOP_TOGGLE, TO_BOTTOM_TOGGLE, AT_CURSOR_TOGGLE];

describe('Smart cut & paste notice settings', () => {
  it('shows/hides the notice and its move buttons according to the settings', async () => {
    // Five scenarios, each a settings flip and a mark-and-read, used to share ONE closure: it declared
    // 63 250 ms of waiting against the transport's ~30 s per-closure cap, so the eval could only ever die as
    // a bare `script timeout` naming the harness rather than the wait that overran. The scenarios run
    // strictly one after another and share nothing but the vault, so the sequencing belongs in NODE, where
    // no cap applies to it - and each eval below then declares a few seconds rather than a minute.
    await setToggles(ALL_TOGGLES, true);

    // Everything on (the defaults): all three move buttons plus Cancel move.
    const allOn = await markAndReadButtons();

    // Each move button hidden in turn.
    await setToggles([TO_TOP_TOGGLE], false);
    const topOff = await markAndReadButtons();
    await setToggles([TO_TOP_TOGGLE], true);

    await setToggles([TO_BOTTOM_TOGGLE], false);
    const bottomOff = await markAndReadButtons();
    await setToggles([TO_BOTTOM_TOGGLE], true);

    await setToggles([AT_CURSOR_TOGGLE], false);
    const atCursorOff = await markAndReadButtons();
    await setToggles([AT_CURSOR_TOGGLE], true);

    // Notice disabled entirely: no notice element appears at all.
    await setToggles([NOTICE_TOGGLE], false);
    const noticeOff = await markAndReadButtons();

    // Restore the defaults so the shared Obsidian instance is left in a clean state.
    await setToggles(ALL_TOGGLES, true);

    // "Switch to split/extract" is always shown (independent of the three move-button toggles), so it
    // Leads every non-empty list.
    expect(allOn).toEqual([
      'Switch to split/extract',
      'Move marked selection to top of file',
      'Move marked selection to bottom of file',
      'Move marked selection at cursor',
      'Swap with selection',
      'Cancel move'
    ]);
    expect(topOff).toEqual([
      'Switch to split/extract',
      'Move marked selection to bottom of file',
      'Move marked selection at cursor',
      'Swap with selection',
      'Cancel move'
    ]);
    expect(bottomOff).toEqual([
      'Switch to split/extract',
      'Move marked selection to top of file',
      'Move marked selection at cursor',
      'Swap with selection',
      'Cancel move'
    ]);
    expect(atCursorOff).toEqual([
      'Switch to split/extract',
      'Move marked selection to top of file',
      'Move marked selection to bottom of file',
      'Swap with selection',
      'Cancel move'
    ]);
    // Notice disabled: no notice, hence no buttons at all.
    expect(noticeOff).toEqual([]);
  });
});

/**
 * Selects the text again, marks it to move, captures the notice button labels, then cancels the move so the
 * next scenario starts from a clean, unlocked state.
 * @returns The labels of the buttons the move notice rendered, in order.
 */
async function markAndReadButtons(): Promise<string[]> {
  return evalInObsidian({
    async callback({ app, lib: { waitUntil }, obsidianModule, pluginId, sourcePath }): Promise<string[]> {
      /**
       * Sized so the SUM of every wait this closure declares stays under the transport's ~30 s per-closure
       * cap, not at it. Two ceilings share it - the editor becoming active and the notice going away - and
       * both are a DOM change a frame or two after the command that causes it.
       */
      const WAIT_TIMEOUT_IN_MILLISECONDS = 2500;
      const RENDER_DELAY_IN_MILLISECONDS = 150;
      const EDIT_SAVE_DELAY_IN_MILLISECONDS = 300;

      const sourceFile = await ensureMarkdownFile(sourcePath, 'alpha bravo charlie');
      const editor = await openAndGetEditor(sourceFile);
      editor.setSelection(editor.offsetToPos(0), editor.offsetToPos(5));
      app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
      await sleep(EDIT_SAVE_DELAY_IN_MILLISECONDS);

      const labels = moveNoticeButtonLabels();

      app.commands.executeCommandById(`${pluginId}:cancel-move`);
      await waitUntil({
        predicate: () => document.querySelector('.advanced-note-composer-move-notice-buttons') === null,
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
      });
      await sleep(RENDER_DELAY_IN_MILLISECONDS);
      return labels;

      function moveNoticeButtonLabels(): string[] {
        const container = document.querySelector('.advanced-note-composer-move-notice-buttons');
        if (!container) {
          return [];
        }
        return [...container.querySelectorAll('button')].map((buttonEl) => buttonEl.textContent);
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
        await waitUntil({
          predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor !== undefined,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
        if (!view) {
          throw new Error('No active markdown view.');
        }
        return view.editor;
      }
    },
    input: { pluginId: PLUGIN_ID, sourcePath: SOURCE_PATH },
    vaultPath: getTemporaryVault().path
  });
}

/**
 * Flips the named toggles through the REAL settings tab, the way a user does.
 *
 * Its own eval rather than a step inside `markAndReadButtons`: the settings are shared-instance state set
 * BETWEEN scenarios, and folding them in would charge their delays against the same per-closure cap.
 * @param toggleNames - The toggles to flip, by their displayed names.
 * @param isEnabledWanted - What to leave each of them set to.
 */
async function setToggles(toggleNames: string[], isEnabledWanted: boolean): Promise<void> {
  await evalInObsidian({
    async callback({ app, findSettingItem, pluginId, settingNames, shouldEnable }): Promise<void> {
      const RENDER_DELAY_IN_MILLISECONDS = 150;
      const EDIT_SAVE_DELAY_IN_MILLISECONDS = 300;

      for (const settingName of settingNames) {
        app.setting.open();
        app.setting.openTabById(pluginId);
        const settingTab = app.setting.pluginTabs.find((tab) => tab.id === pluginId);
        if (!settingTab) {
          throw new Error('Settings tab was not found.');
        }
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

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
    },
    input: { findSettingItem: findSettingItemInObsidian, pluginId: PLUGIN_ID, settingNames: toggleNames, shouldEnable: isEnabledWanted },
    vaultPath: getTemporaryVault().path
  });
}
