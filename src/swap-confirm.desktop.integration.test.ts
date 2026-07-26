import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsTab } from './plugin-settings-tab.ts';

// The swap confirmation dialog is v8-ignored modal UI (see swap-file-modal.ts / swap-folder-modal.ts);
// This suite drives the REAL dialog DOM against a real Obsidian to prove the wiring (issue #74).
// G99: this is public-API modal/settings logic (Modal + ButtonComponent + the stable
// `.modal-button-container` DOM), not Obsidian-internals/version-sensitive, so verifying against the
// Default (currently-installed public-latest) build suffices; no separate catalyst run is required.

const PLUGIN_ID = 'advanced-note-composer';

describe('swap confirmation dialog', () => {
  it('swaps two folders when the confirmation dialog is confirmed', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const originalShouldAsk = await setAskBeforeSwapping(true);
        try {
          // Two same-named "shared" folders under different parents; swapping exchanges their children.
          const sourceNote = await resetFile('swap-a/shared/x.md', 'X body');
          await resetFile('swap-b/shared/y.md', 'Y body');

          // Open the note so its parent folder ("swap-a/shared") becomes the swap source.
          await app.workspace.getLeaf(false).openFile(sourceNote);
          await waitUntil({ predicate: () => app.workspace.getActiveFile()?.path === 'swap-a/shared/x.md' });
          app.commands.executeCommandById(`${pluginId}:swap-folder`);
          await waitUntil({ predicate: () => document.querySelector('.prompt') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // Pick the target folder.
          await chooseInPicker('swap-b/shared');

          // The confirmation dialog appears with the "Swap" button.
          await waitUntil({ predicate: () => findButton('Swap') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const confirmButtonPresent = findButton('Swap') !== null;
          const changeTargetButtonPresent = findButton('Change target') !== null;

          // Confirm the swap.
          findButton('Swap')?.click();
          await waitUntil({ predicate: () => app.vault.getAbstractFileByPath('swap-a/shared/y.md') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const swapped = app.vault.getAbstractFileByPath('swap-a/shared/y.md') !== null
            && app.vault.getAbstractFileByPath('swap-b/shared/x.md') !== null
            && app.vault.getAbstractFileByPath('swap-a/shared/x.md') === null
            && app.vault.getAbstractFileByPath('swap-b/shared/y.md') === null;

          return { changeTargetButtonPresent, confirmButtonPresent, swapped };
        } finally {
          await setAskBeforeSwapping(originalShouldAsk);
        }

        function findButton(text: string): HTMLButtonElement | null {
          for (const el of Array.from(document.querySelectorAll('.modal-button-container button'))) {
            if (el.instanceOf(HTMLButtonElement) && el.textContent === text) {
              return el;
            }
          }
          return null;
        }

        async function chooseInPicker(itemPath: string): Promise<void> {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new Error('No swap picker input.');
          }
          input.value = itemPath;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({ predicate: () => Array.from(document.querySelectorAll('.suggestion-item')).some((el) => el.textContent.includes(itemPath)) });
          input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Enter', key: 'Enter' }));
        }

        async function setAskBeforeSwapping(shouldAsk: boolean): Promise<boolean> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          (tab as PluginSettingsTab).displayLegacy();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const item = Array.from(tab.containerEl.querySelectorAll('.setting-item'))
            .find((el) => el.querySelector('.setting-item-name')?.textContent === 'Should ask before swapping');
          const toggle = item?.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new Error('"Should ask before swapping" toggle was not found.');
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

    expect(result.confirmButtonPresent).toBe(true);
    expect(result.changeTargetButtonPresent).toBe(true);
    expect(result.swapped).toBe(true);
  });

  it('does not swap the folders when the confirmation dialog is cancelled', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const originalShouldAsk = await setAskBeforeSwapping(true);
        try {
          const sourceNote = await resetFile('swap-c/shared/p.md', 'P body');
          await resetFile('swap-d/shared/q.md', 'Q body');

          await app.workspace.getLeaf(false).openFile(sourceNote);
          await waitUntil({ predicate: () => app.workspace.getActiveFile()?.path === 'swap-c/shared/p.md' });
          app.commands.executeCommandById(`${pluginId}:swap-folder`);
          await waitUntil({ predicate: () => document.querySelector('.prompt') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          await chooseInPicker('swap-d/shared');

          // The confirmation dialog appears; cancel it.
          await waitUntil({ predicate: () => findButton('Cancel') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          findButton('Cancel')?.click();
          await waitUntil({ predicate: () => document.querySelector('.modal-button-container') === null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // Nothing moved: both folders keep their original children.
          const untouched = app.vault.getAbstractFileByPath('swap-c/shared/p.md') !== null
            && app.vault.getAbstractFileByPath('swap-d/shared/q.md') !== null
            && app.vault.getAbstractFileByPath('swap-c/shared/q.md') === null
            && app.vault.getAbstractFileByPath('swap-d/shared/p.md') === null;

          return { untouched };
        } finally {
          await setAskBeforeSwapping(originalShouldAsk);
        }

        function findButton(text: string): HTMLButtonElement | null {
          for (const el of Array.from(document.querySelectorAll('.modal-button-container button'))) {
            if (el.instanceOf(HTMLButtonElement) && el.textContent === text) {
              return el;
            }
          }
          return null;
        }

        async function chooseInPicker(itemPath: string): Promise<void> {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new Error('No swap picker input.');
          }
          input.value = itemPath;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({ predicate: () => Array.from(document.querySelectorAll('.suggestion-item')).some((el) => el.textContent.includes(itemPath)) });
          input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Enter', key: 'Enter' }));
        }

        async function setAskBeforeSwapping(shouldAsk: boolean): Promise<boolean> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          (tab as PluginSettingsTab).displayLegacy();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const item = Array.from(tab.containerEl.querySelectorAll('.setting-item'))
            .find((el) => el.querySelector('.setting-item-name')?.textContent === 'Should ask before swapping');
          const toggle = item?.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new Error('"Should ask before swapping" toggle was not found.');
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

    expect(result.untouched).toBe(true);
  });

  it('swaps two files when the confirmation dialog is confirmed', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const originalShouldAsk = await setAskBeforeSwapping(true);
        try {
          const sourceNote = await resetFile('swap-file-src.md', 'SRC body');
          await resetFile('swap-file-tgt.md', 'TGT body');

          await app.workspace.getLeaf(false).openFile(sourceNote);
          await waitUntil({ predicate: () => app.workspace.getActiveFile()?.path === 'swap-file-src.md' });
          app.commands.executeCommandById(`${pluginId}:swap-file`);
          await waitUntil({ predicate: () => document.querySelector('.prompt') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          await chooseInPicker('swap-file-tgt.md');

          await waitUntil({ predicate: () => findButton('Swap') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          findButton('Swap')?.click();

          // The files trade paths, so each path ends up holding the other file's content.
          await waitUntil({ predicate: () => app.vault.getAbstractFileByPath('swap-file-src.md') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const srcContent = await app.vault.adapter.read('swap-file-src.md');
          const tgtContent = await app.vault.adapter.read('swap-file-tgt.md');

          return { srcContent, tgtContent };
        } finally {
          await setAskBeforeSwapping(originalShouldAsk);
        }

        function findButton(text: string): HTMLButtonElement | null {
          for (const el of Array.from(document.querySelectorAll('.modal-button-container button'))) {
            if (el.instanceOf(HTMLButtonElement) && el.textContent === text) {
              return el;
            }
          }
          return null;
        }

        async function chooseInPicker(itemPath: string): Promise<void> {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new Error('No swap picker input.');
          }
          input.value = itemPath;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({ predicate: () => Array.from(document.querySelectorAll('.suggestion-item')).some((el) => el.textContent.includes(itemPath)) });
          input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Enter', key: 'Enter' }));
        }

        async function setAskBeforeSwapping(shouldAsk: boolean): Promise<boolean> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          (tab as PluginSettingsTab).displayLegacy();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const item = Array.from(tab.containerEl.querySelectorAll('.setting-item'))
            .find((el) => el.querySelector('.setting-item-name')?.textContent === 'Should ask before swapping');
          const toggle = item?.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new Error('"Should ask before swapping" toggle was not found.');
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

    expect(result.srcContent).toBe('TGT body');
    expect(result.tgtContent).toBe('SRC body');
  });
});
