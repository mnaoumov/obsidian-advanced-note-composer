import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import { findSettingItemInObsidian } from './settings-tab-navigation.ts';

// The swap confirmation dialog is v8-ignored modal UI (see swap-file-modal.ts / swap-folder-modal.ts);
// This suite drives the REAL dialog DOM against a real Obsidian to prove the wiring (issue #74).
// G99: this is public-API modal/settings logic (Modal + ButtonComponent + the stable
// `.modal-button-container` DOM), not Obsidian-internals/version-sensitive, so verifying against the
// Default (currently-installed public-latest) build suffices; no separate catalyst run is required.

const PLUGIN_ID = 'advanced-note-composer';

describe('swap confirmation dialog', () => {
  it('swaps two folders when the confirmation dialog is confirmed', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingItem, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const isOriginalShouldAsk = await didSetAskBeforeSwapping(true);
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
          const isConfirmButtonPresent = findButton('Swap') !== null;
          const isChangeTargetButtonPresent = findButton('Change target') !== null;

          // Confirm the swap.
          findButton('Swap')?.click();
          await waitUntil({ predicate: () => app.vault.getAbstractFileByPath('swap-a/shared/y.md') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const isSwapped = app.vault.getAbstractFileByPath('swap-a/shared/y.md') !== null
            && app.vault.getAbstractFileByPath('swap-b/shared/x.md') !== null
            && app.vault.getAbstractFileByPath('swap-a/shared/x.md') === null
            && app.vault.getAbstractFileByPath('swap-b/shared/y.md') === null;

          return { changeTargetButtonPresent: isChangeTargetButtonPresent, confirmButtonPresent: isConfirmButtonPresent, swapped: isSwapped };
        } finally {
          await didSetAskBeforeSwapping(isOriginalShouldAsk);
        }

        function findButton(text: string): HTMLButtonElement | null {
          for (const el of document.querySelectorAll('.modal-button-container button')) {
            if (el.instanceOf(HTMLButtonElement) && el.textContent === text) {
              return el;
            }
          }
          return null;
        }

        async function chooseInPicker(itemPath: string): Promise<void> {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No swap picker input.');
          }
          input.value = itemPath;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({ predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(itemPath)) });
          input.focus();
          pressKey({ key: 'Enter' });
        }

        async function didSetAskBeforeSwapping(shouldAsk: boolean): Promise<boolean> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const item = await findSettingItem({ app, name: 'Should ask before swapping', settingTab: tab });
          const toggle = item?.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new TypeError('"Should ask before swapping" toggle was not found.');
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

    expect(result.confirmButtonPresent).toBe(true);
    expect(result.changeTargetButtonPresent).toBe(true);
    expect(result.swapped).toBe(true);
  });

  it('does not swap the folders when the confirmation dialog is cancelled', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingItem, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const isOriginalShouldAsk = await didSetAskBeforeSwapping(true);
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
          const isUntouched = app.vault.getAbstractFileByPath('swap-c/shared/p.md') !== null
            && app.vault.getAbstractFileByPath('swap-d/shared/q.md') !== null
            && app.vault.getAbstractFileByPath('swap-c/shared/q.md') === null
            && app.vault.getAbstractFileByPath('swap-d/shared/p.md') === null;

          return { untouched: isUntouched };
        } finally {
          await didSetAskBeforeSwapping(isOriginalShouldAsk);
        }

        function findButton(text: string): HTMLButtonElement | null {
          for (const el of document.querySelectorAll('.modal-button-container button')) {
            if (el.instanceOf(HTMLButtonElement) && el.textContent === text) {
              return el;
            }
          }
          return null;
        }

        async function chooseInPicker(itemPath: string): Promise<void> {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No swap picker input.');
          }
          input.value = itemPath;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({ predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(itemPath)) });
          input.focus();
          pressKey({ key: 'Enter' });
        }

        async function didSetAskBeforeSwapping(shouldAsk: boolean): Promise<boolean> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const item = await findSettingItem({ app, name: 'Should ask before swapping', settingTab: tab });
          const toggle = item?.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new TypeError('"Should ask before swapping" toggle was not found.');
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

    expect(result.untouched).toBe(true);
  });

  it('swaps two files when the confirmation dialog is confirmed', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingItem, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const isOriginalShouldAsk = await didSetAskBeforeSwapping(true);
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
          await didSetAskBeforeSwapping(isOriginalShouldAsk);
        }

        function findButton(text: string): HTMLButtonElement | null {
          for (const el of document.querySelectorAll('.modal-button-container button')) {
            if (el.instanceOf(HTMLButtonElement) && el.textContent === text) {
              return el;
            }
          }
          return null;
        }

        async function chooseInPicker(itemPath: string): Promise<void> {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No swap picker input.');
          }
          input.value = itemPath;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({ predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(itemPath)) });
          input.focus();
          pressKey({ key: 'Enter' });
        }

        async function didSetAskBeforeSwapping(shouldAsk: boolean): Promise<boolean> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const item = await findSettingItem({ app, name: 'Should ask before swapping', settingTab: tab });
          const toggle = item?.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new TypeError('"Should ask before swapping" toggle was not found.');
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

    expect(result.srcContent).toBe('TGT body');
    expect(result.tgtContent).toBe('SRC body');
  });
});
