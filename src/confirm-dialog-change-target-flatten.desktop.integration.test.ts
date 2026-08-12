import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import { findSettingItemInObsidian } from './settings-tab-navigation.ts';

// Issue #205's own example: "Change target" was rendered-but-disabled for flatten. Flatten has no picker of
// Its own, so this proves the INVERTED loop (derived default -> dialog -> picker on demand -> dialog again)
// Against a real Obsidian; the unit tests mock `selectFolder`, so only this exercises the real suggester.
// Desktop-only: folder flows, matching the plugin's established integration convention.
// Isolation: `npx vitest run --project integration-tests:desktop src/confirm-dialog-change-target-flatten.desktop.integration.test.ts`.

const PLUGIN_ID = 'advanced-note-composer';

describe('change target from the flatten confirmation dialog (issue #205)', () => {
  it('opens the folder picker and promotes the children into the newly chosen folder', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingItem, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const isOriginalShouldAsk = await didSetAskBeforeFlattening(true);
        try {
          await trashIfExists('ctf-flat');
          await trashIfExists('ctf-dest');
          await trashIfExists('ctf-child.md');

          const child = await resetFile('ctf-flat/ctf-child.md', 'child body');
          await resetFile('ctf-dest/keep.md', 'keep body');

          // The command acts on the folder of the active note.
          await app.workspace.getLeaf(false).openFile(child);
          await waitUntil({ predicate: () => app.workspace.getActiveFile()?.path === 'ctf-flat/ctf-child.md' });

          app.commands.executeCommandById(`${pluginId}:flatten-folder`);

          await waitUntil({ message: 'flatten dialog did not open', predicate: () => findButton('Flatten') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // The whole point of the issue: the button is live, not greyed out.
          const isChangeTargetEnabled = !(findButton('Change target')?.disabled ?? true);

          findButton('Change target')?.click();
          await waitUntil({ message: 'destination picker did not open', predicate: () => document.querySelector('.prompt') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          await chooseFolderInPicker('ctf-dest');

          // Back to the confirmation dialog, now describing the picked destination.
          await waitUntil({ message: 'flatten dialog did not reopen', predicate: () => findButton('Flatten') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const isDestinationLinked = [...document.querySelectorAll('.modal-content a')].some((el) => el.textContent === 'ctf-dest');

          findButton('Flatten')?.click();

          await waitUntil({
            message: 'the child was not promoted into the chosen folder',
            predicate: () => app.vault.getAbstractFileByPath('ctf-dest/ctf-child.md') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          return {
            changeTargetEnabled: isChangeTargetEnabled,
            destinationLinked: isDestinationLinked,
            // Where a plain flatten would have put it — the vault root, since `ctf-flat` is top-level.
            promotedToDefault: app.vault.getAbstractFileByPath('ctf-child.md') !== null,
            promotedToPicked: app.vault.getAbstractFileByPath('ctf-dest/ctf-child.md') !== null
          };
        } finally {
          await didSetAskBeforeFlattening(isOriginalShouldAsk);
        }

        function findButton(text: string): HTMLButtonElement | null {
          for (const el of document.querySelectorAll('.modal-button-container button')) {
            if (el.instanceOf(HTMLButtonElement) && el.textContent === text) {
              return el;
            }
          }
          return null;
        }

        async function chooseFolderInPicker(folderPath: string): Promise<void> {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No destination picker input.');
          }
          input.value = folderPath;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({ predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(folderPath)) });
          input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Enter', key: 'Enter' }));
        }

        async function didSetAskBeforeFlattening(shouldAsk: boolean): Promise<boolean> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const item = await findSettingItem({ app, name: 'Should ask before flattening a folder', settingTab: tab });
          const toggle = item?.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new TypeError('"Should ask before flattening a folder" toggle was not found.');
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

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }
      },
      input: { findSettingItem: findSettingItemInObsidian, pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The button the issue is about is clickable...
    expect(result.changeTargetEnabled).toBe(true);
    // ...the reopened dialog describes the folder that was picked...
    expect(result.destinationLinked).toBe(true);
    // ...and the flatten landed there instead of in the folder's own parent.
    expect(result.promotedToPicked).toBe(true);
    expect(result.promotedToDefault).toBe(false);
  });
});
