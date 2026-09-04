import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import { findSettingItemInObsidian } from './settings-tab-navigation.ts';

/**
 * Holds the keydown the capture listener saw, so its `defaultPrevented` can be read once every handler
 * has had its turn with it.
 */
interface CapturedKeyboardEvent {
  value: KeyboardEvent | null;
}

const PLUGIN_ID = 'advanced-note-composer';

describe('Enter on the merge confirmation dialog is preventDefault-ed (issue #142)', () => {
  it('preventDefaults the Enter keydown so it does not leak into the locked editor (no system beep)', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingItem, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const isOriginalShouldAsk = await didSetAskBeforeMerging(true);
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

          /*
           * A REAL Enter key press, not a dispatched one. The whole subject of this test is what
           * Obsidian's `Scope` does to a genuine keystroke — a dispatched event is `isTrusted === false`
           * and is exactly the kind of input such handling is entitled to ignore, which would leave this
           * asserting `defaultPrevented` on an event no production code ever saw.
           *
           * A trusted press hands back no event object to read `defaultPrevented` from, so the flag is
           * observed from the event's LAST stop instead: `window` in the bubble phase runs after the
           * `document`-level handlers Obsidian registers, so what it sees is the verdict on the real key.
           */
          const capturedEnter: CapturedKeyboardEvent = { value: null };
          function captureEnter(keyboardEvent: KeyboardEvent): void {
            if (keyboardEvent.key === 'Enter') {
              capturedEnter.value = keyboardEvent;
            }
          }

          activeWindow.addEventListener('keydown', captureEnter, { capture: true });
          try {
            await pressKey({ key: 'Enter' });

            // Enter also confirms the merge: the source folder is deleted and its note lands in the target.
            await waitUntil({ predicate: () => app.vault.getAbstractFileByPath('mf142-src') === null });
            await sleep(RENDER_DELAY_IN_MILLISECONDS);
          } finally {
            activeWindow.removeEventListener('keydown', captureEnter, { capture: true });
          }

          // Read AFTER the dispatch has finished: the event object keeps the verdict, so this sees what
          // Every handler did to it, including a `Scope` handler that stops propagation on its way.
          const wasDefaultPrevented = capturedEnter.value?.defaultPrevented ?? false;

          const isMergeCompleted = app.vault.getAbstractFileByPath('mf142-src') === null
            && app.vault.getAbstractFileByPath('mf142-tgt/note.md') !== null;

          return { mergeCompleted: isMergeCompleted, wasDefaultPrevented };
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

        async function chooseFolderInPicker(folderPath: string): Promise<void> {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No merge-folder picker input.');
          }
          input.value = folderPath;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({ predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(folderPath)) });
          input.focus();
          await pressKey({ key: 'Enter' });
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

    // Enter was preventDefault-ed (so it cannot leak into the read-only editor and beep)...
    expect(result.wasDefaultPrevented).toBe(true);
    // ...and it still confirmed the merge.
    expect(result.mergeCompleted).toBe(true);
  });
});
