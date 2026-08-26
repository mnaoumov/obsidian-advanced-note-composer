import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import { findSettingItemInObsidian } from './settings-tab-navigation.ts';

const PLUGIN_ID = 'advanced-note-composer';

describe('change target from the merge-file confirmation dialog', () => {
  it('reopens the picker and merges into the newly chosen target', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingItem, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const isOriginalShouldAsk = await didSetAskBeforeMerging(true);
        try {
          const source = await resetFile('merge-change-source.md', 'source body');
          const targetA = await resetFile('merge-change-a.md', 'target a body');
          const targetB = await resetFile('merge-change-b.md', 'target b body');

          // Open the source and start a merge.
          await app.workspace.getLeaf(false).openFile(source);
          await waitUntil({ predicate: () => app.workspace.getActiveFile()?.path === 'merge-change-source.md' });
          app.commands.executeCommandById(`${pluginId}:merge-file`);
          await waitUntil({ predicate: () => document.querySelector('.prompt') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // Choose target A in the picker.
          await chooseInPicker(targetA.basename);

          // The confirmation dialog appears (for target A) with the "Change target" button.
          await waitUntil({ predicate: () => findButton('Change target') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const isChangeTargetButtonPresent = findButton('Change target') !== null;

          // Click "Change target": the picker reopens.
          findButton('Change target')?.click();
          await waitUntil({ predicate: () => document.querySelector('.prompt') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // Choose target B in the reopened picker.
          await chooseInPicker(targetB.basename);

          // The confirmation dialog appears again (for target B); confirm the merge.
          await waitUntil({ predicate: () => findButton('Merge') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          findButton('Merge')?.click();

          // The merge completes: the source is deleted and target B received its content.
          await waitUntil({ predicate: () => app.vault.getAbstractFileByPath('merge-change-source.md') === null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const isSourceExists = app.vault.getAbstractFileByPath('merge-change-source.md') !== null;
          const targetAContent = await app.vault.read(targetA);
          const targetBContent = await app.vault.read(targetB);

          return { changeTargetButtonPresent: isChangeTargetButtonPresent, sourceExists: isSourceExists, targetAContent, targetBContent };
        } finally {
          await didSetAskBeforeMerging(isOriginalShouldAsk);
        }

        function findButton(text: string): HTMLButtonElement | null {
          for (const el of document.querySelectorAll('.modal-button-container button')) {
            if (el.instanceOf(HTMLButtonElement) && el.textContent === text) {
              return el;
            }
          }
          return null;
        }

        async function chooseInPicker(basename: string): Promise<void> {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No merge picker input.');
          }
          input.value = basename;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({ predicate: () => [...document.querySelectorAll('.suggestion-title')].some((el) => el.textContent.includes(basename)) });
          input.focus();
          pressKey({ key: 'Enter' });
        }

        async function didSetAskBeforeMerging(shouldAsk: boolean): Promise<boolean> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const item = await findSettingItem({ app, name: 'Should ask before merging', settingTab: tab });
          const toggle = item?.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new TypeError('"Should ask before merging" toggle was not found.');
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
      },
      input: { findSettingItem: findSettingItemInObsidian, pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The confirmation dialog offered "Change target"...
    expect(result.changeTargetButtonPresent).toBe(true);
    // ...and after re-picking, the merge landed in target B (not target A), deleting the source.
    expect(result.targetBContent).toContain('source body');
    expect(result.targetAContent).toBe('target a body');
    expect(result.sourceExists).toBe(false);
  });
});
