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

describe('switch to smart cut from the split confirmation dialog', () => {
  it('marks the selection and opens the target instead of splitting', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingItem, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const isOriginalShouldAsk = await didSetAskBeforeSplitting(true);
        try {
          const source = await resetFile('confirm-switch-source.md', 'alpha bravo charlie');
          const target = await resetFile('confirm-switch-target.md', 'target body');

          // Open the source, select "bravo", and start an extract.
          const editor = await openAndGetEditor(source);
          editor.setSelection(editor.offsetToPos(6), editor.offsetToPos(11));
          app.commands.executeCommandById(`${pluginId}:extract-current-selection`);
          await waitUntil({ predicate: () => document.querySelector('.prompt') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // Choose the (existing) target note in the picker.
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No split picker input.');
          }
          // Extracting into a note that ALREADY EXISTS is a merge, and the create/merge switch made that
          // Explicit (issue #227) - so the picker has to be told before it will offer existing notes.
          const modeToggle = document.querySelector('.advanced-note-composer-split-target-mode .checkbox-container');
          if (!(modeToggle instanceof HTMLElement)) {
            throw new TypeError('No create/merge switch in the split picker.');
          }
          if (!modeToggle.classList.contains('is-enabled')) {
            modeToggle.click();
          }

          input.value = target.basename;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({ predicate: () => [...document.querySelectorAll('.suggestion-title')].some((el) => el.textContent.includes(target.basename)) });
          input.focus();
          await pressKey({ key: 'Enter' });

          // The confirmation dialog appears (with the switch button); trigger the switch via Alt+S.
          await waitUntil({ predicate: () => findSwitchButton() !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const isSwitchButtonPresent = findSwitchButton() !== null;
          await pressKey({ key: 's', modifiers: ['Alt'] });

          // The mark is now active: the permanent notice shows and the target note is opened.
          await waitUntil({ predicate: () => app.workspace.getActiveFile()?.path === 'confirm-switch-target.md' });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const isMarkNoticeShown = findMarkNotice() !== null;
          const activePath = app.workspace.getActiveFile()?.path ?? '';
          const sourceContent = await app.vault.read(source);
          const targetContent = await app.vault.read(target);

          // Clean up: release the mark so the source note is unlocked.
          app.commands.executeCommandById(`${pluginId}:cancel-move`);
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          return { activePath, markNoticeShown: isMarkNoticeShown, sourceContent, switchButtonPresent: isSwitchButtonPresent, targetContent };
        } finally {
          await didSetAskBeforeSplitting(isOriginalShouldAsk);
        }

        function findSwitchButton(): HTMLButtonElement | null {
          // Two containers now: the confirm/cancel action row, and the `ModalCommandBuilder` strip that
          // Owns `Don't ask again` / `Change target` / `Switch to smart cut & paste`. A strip button's
          // `textContent` runs its purpose straight into its hotkey, so match the first span instead.
          for (const el of document.querySelectorAll('.modal-button-container button, .modal-commands button')) {
            if (el.instanceOf(HTMLButtonElement) && (el.textContent === 'Switch to smart cut & paste' || el.querySelector('span')?.textContent === 'Switch to smart cut & paste')) {
              return el;
            }
          }
          return null;
        }

        function findMarkNotice(): Element | null {
          for (const el of activeDocument.querySelectorAll('.notice')) {
            if (el.textContent.includes('Smart cut & paste')) {
              return el;
            }
          }
          return null;
        }

        async function didSetAskBeforeSplitting(shouldAsk: boolean): Promise<boolean> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const item = await findSettingItem({ app, name: 'Should ask before splitting', settingTab: tab });
          const toggle = item?.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new TypeError('"Should ask before splitting" toggle was not found.');
          }
          const wasEnabled = toggle.classList.contains('is-enabled');
          if (wasEnabled !== shouldAsk) {
            toggle.click();
            await sleep(RENDER_DELAY_IN_MILLISECONDS);
          }
          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return wasEnabled;
        }

        async function resetFile(path: string, content: string): Promise<TFile> {
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
      },
      input: { findSettingItem: findSettingItemInObsidian, pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The confirmation dialog showed the switch button, and Alt+S marked the selection (permanent
    // Notice) and opened the target...
    expect(result.switchButtonPresent).toBe(true);
    expect(result.markNoticeShown).toBe(true);
    expect(result.activePath).toBe('confirm-switch-target.md');
    // ...without splitting: the source still holds "bravo" and the target is untouched.
    expect(result.sourceContent).toContain('bravo');
    expect(result.targetContent).toBe('target body');
  });
});
