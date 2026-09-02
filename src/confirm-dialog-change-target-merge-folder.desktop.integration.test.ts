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

describe('change target from the merge-folder confirmation dialog', () => {
  it('reopens the folder picker and merges into the newly chosen folder', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingItem, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const isOriginalShouldAsk = await didSetAskBeforeMerging(true);
        try {
          // Source folder holds the active file; two sibling target folders.
          const sourceNote = await resetFile('mf-src/note.md', 'source note body');
          await resetFile('mf-tgt-a/a.md', 'target a body');
          await resetFile('mf-tgt-b/b.md', 'target b body');

          // Open the note so its parent folder ("mf-src") becomes the merge source.
          await app.workspace.getLeaf(false).openFile(sourceNote);
          await waitUntil({ predicate: () => app.workspace.getActiveFile()?.path === 'mf-src/note.md' });
          app.commands.executeCommandById(`${pluginId}:merge-folder`);
          await waitUntil({ predicate: () => document.querySelector('.prompt') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // Choose target folder A.
          await chooseFolderInPicker('mf-tgt-a');

          // The confirmation dialog appears (for folder A) with the "Change target" button.
          await waitUntil({ predicate: () => findButton('Change target') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const isChangeTargetButtonPresent = findButton('Change target') !== null;

          // Click "Change target": the folder picker reopens.
          findButton('Change target')?.click();
          await waitUntil({ predicate: () => document.querySelector('.prompt') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // Choose target folder B in the reopened picker.
          await chooseFolderInPicker('mf-tgt-b');

          // The confirmation dialog appears again (for folder B); confirm the merge.
          await waitUntil({ predicate: () => findButton('Merge') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          findButton('Merge')?.click();

          // The merge completes: the source folder is deleted and its note lands in target B.
          await waitUntil({ predicate: () => app.vault.getAbstractFileByPath('mf-src') === null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const isSourceFolderExists = app.vault.getAbstractFileByPath('mf-src') !== null;
          const isMergedIntoB = app.vault.getAbstractFileByPath('mf-tgt-b/note.md') !== null;
          const isTargetAIntact = app.vault.getAbstractFileByPath('mf-tgt-a/a.md') !== null
            && app.vault.getAbstractFileByPath('mf-tgt-a/note.md') === null;

          return { changeTargetButtonPresent: isChangeTargetButtonPresent, mergedIntoB: isMergedIntoB, sourceFolderExists: isSourceFolderExists, targetAIntact: isTargetAIntact };
        } finally {
          await didSetAskBeforeMerging(isOriginalShouldAsk);
        }

        function findButton(text: string): HTMLButtonElement | null {
          // Two containers now: the confirm/cancel action row, and the `ModalCommandBuilder` strip that
          // Owns `Don't ask again` / `Change target` / `Switch to smart cut & paste`. A strip button's
          // `textContent` runs its purpose straight into its hotkey, so match the first span instead.
          for (const el of document.querySelectorAll('.modal-button-container button, .modal-commands button')) {
            if (el.instanceOf(HTMLButtonElement) && (el.textContent === text || el.querySelector('span')?.textContent === text)) {
              return el;
            }
          }
          return null;
        }

        async function chooseFolderInPicker(folderPath: string): Promise<void> {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No merge-folder picker input.');
          }
          input.value = folderPath;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({ predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(folderPath)) });
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
          const parentPath = path.slice(0, path.lastIndexOf('/'));
          if (parentPath && app.vault.getAbstractFileByPath(parentPath) === null) {
            await app.vault.createFolder(parentPath);
          }
          return app.vault.create(path, content);
        }
      },
      input: { findSettingItem: findSettingItemInObsidian, pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The confirmation dialog offered "Change target"...
    expect(result.changeTargetButtonPresent).toBe(true);
    // ...and after re-picking, the merge landed in folder B (not folder A), deleting the source folder.
    expect(result.mergedIntoB).toBe(true);
    expect(result.sourceFolderExists).toBe(false);
    expect(result.targetAIntact).toBe(true);
  });
});
