import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsTab } from './plugin-settings-tab.ts';

const PLUGIN_ID = 'advanced-note-composer';

describe('Enter on the merge confirmation dialog is preventDefault-ed (issue #142)', () => {
  it('preventDefaults the Enter keydown so it does not leak into the locked editor (no system beep)', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const originalShouldAsk = await setAskBeforeMerging(true);
        try {
          // Source folder holds the active file; one sibling target folder.
          const sourceNote = await resetFile('mf142-src/note.md', 'source note body');
          await resetFile('mf142-tgt/a.md', 'target a body');

          // Open the note so its parent folder ("mf142-src") becomes the merge source.
          await app.workspace.getLeaf(false).openFile(sourceNote);
          await waitUntil({ predicate: () => app.workspace.getActiveFile()?.path === 'mf142-src/note.md' });
          app.commands.executeCommandById(`${pluginId}:merge-folder`);
          await waitUntil({ predicate: () => document.querySelector('.prompt') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // Choose the target folder.
          await chooseFolderInPicker('mf142-tgt');

          // The confirmation dialog appears; wait for its "Merge" button.
          await waitUntil({ predicate: () => findButton('Merge') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // Dispatch a cancelable Enter keydown at the confirmation modal.
          // Obsidian's Scope calls preventDefault synchronously during dispatch when the handler returns false.
          const modalEl = document.querySelector('.mod-confirmation') ?? document.body;
          const enterEvent = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            code: 'Enter',
            key: 'Enter'
          });
          modalEl.dispatchEvent(enterEvent);
          const wasDefaultPrevented = enterEvent.defaultPrevented;

          // Enter also confirms the merge: the source folder is deleted and its note lands in the target.
          await waitUntil({ predicate: () => app.vault.getAbstractFileByPath('mf142-src') === null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const mergeCompleted = app.vault.getAbstractFileByPath('mf142-src') === null
            && app.vault.getAbstractFileByPath('mf142-tgt/note.md') !== null;

          return { mergeCompleted, wasDefaultPrevented };
        } finally {
          await setAskBeforeMerging(originalShouldAsk);
        }

        function findButton(text: string): HTMLButtonElement | null {
          for (const el of Array.from(document.querySelectorAll('.modal-button-container button'))) {
            if (el.instanceOf(HTMLButtonElement) && el.textContent === text) {
              return el;
            }
          }
          return null;
        }

        async function chooseFolderInPicker(folderPath: string): Promise<void> {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new Error('No merge-folder picker input.');
          }
          input.value = folderPath;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({ predicate: () => Array.from(document.querySelectorAll('.suggestion-item')).some((el) => el.textContent.includes(folderPath)) });
          input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Enter', key: 'Enter' }));
        }

        async function setAskBeforeMerging(shouldAsk: boolean): Promise<boolean> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          (tab as PluginSettingsTab).displayLegacy();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const item = Array.from(tab.containerEl.querySelectorAll('.setting-item'))
            .find((el) => el.querySelector('.setting-item-name')?.textContent === 'Should ask before merging');
          const toggle = item?.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new Error('"Should ask before merging" toggle was not found.');
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
      vaultPath: getTempVault().path
    });

    // Enter was preventDefault-ed (so it cannot leak into the read-only editor and beep)...
    expect(result.wasDefaultPrevented).toBe(true);
    // ...and it still confirmed the merge.
    expect(result.mergeCompleted).toBe(true);
  });
});
