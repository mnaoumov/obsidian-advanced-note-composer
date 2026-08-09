import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// The flatten/move confirmation dialogs are v8-ignored modal UI (see flatten-folder-command-handler.ts /
// Move-folder-command-handler.ts); this suite drives the REAL dialog DOM against a real Obsidian to prove
// The wiring (issue #154). The cancel cases are the load-bearing ones: they are what the report is about.
// The confirm cases additionally assert that both paths render as real anchors (issue #165) — the unit
// Tests mock `renderInternalLink`, so only a real Obsidian proves its folder branch produces an `<a>`.
// G99: this is public-API modal/settings logic (Modal + ButtonComponent + the stable
// `.modal-button-container` DOM), not Obsidian-internals/version-sensitive, so one end would suffice —
// But it was run on BOTH anyway: catalyst-latest 1.13.4 and public-latest 1.12.7, 4/4 on each. Pin the
// Other end with the desktop project's `environmentOptions.obsidianTransport.obsidianVersion`.
// Desktop-only: folder-move flows, matching the plugin's established integration convention.
// Isolation: `npx vitest run --project integration-tests:desktop src/folder-confirm.desktop.integration.test.ts`.

const PLUGIN_ID = 'advanced-note-composer';

describe('folder operation confirmation dialogs (issue #154)', () => {
  it('flattens the folder when the confirmation dialog is confirmed', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const isOriginalShouldAsk = await didSetToggle('Should ask before flattening a folder', true);
        try {
          await trashIfExists('fc-note.md');
          await trashIfExists('fc-flat');

          await app.vault.createFolder('fc-flat');
          const note = await app.vault.create('fc-flat/fc-note.md', 'flat body');
          await openFile(note);

          app.commands.executeCommandById(`${pluginId}:flatten-folder`);

          // The dialog appears, listing the items it will move.
          await waitUntil({ message: 'flatten dialog did not open', predicate: () => findButton('Flatten') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const isConfirmButtonPresent = findButton('Flatten') !== null;
          const isListsTheItem = [...document.querySelectorAll('.modal-content code')].some((el) => el.textContent === 'fc-note.md');
          // Issue #205: flatten's destination defaults to the folder's own parent but is not fixed to it,
          // So "Change target" is enabled here like on every other confirmation dialog.
          const isChangeTargetDisabled = findButton('Change target')?.disabled ?? false;
          // Issue #165: the folder AND its destination are both clickable links. `fc-flat` is top-level,
          // So its destination is the vault root, which is labelled `/` (its own path is blank).
          const linkTexts = [...document.querySelectorAll('.modal-content a')].map((el) => el.textContent);

          findButton('Flatten')?.click();

          await waitUntil({
            message: 'the child was not promoted',
            predicate: () => app.vault.getAbstractFileByPath('fc-note.md') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const isPromoted = app.vault.getAbstractFileByPath('fc-note.md') !== null
            && app.vault.getAbstractFileByPath('fc-flat/fc-note.md') === null;

          return { changeTargetDisabled: isChangeTargetDisabled, confirmButtonPresent: isConfirmButtonPresent, linkTexts, listsTheItem: isListsTheItem, promoted: isPromoted };
        } finally {
          await didSetToggle('Should ask before flattening a folder', isOriginalShouldAsk);
        }

        function findButton(text: string): HTMLButtonElement | null {
          for (const el of document.querySelectorAll('.modal-button-container button')) {
            if (el.instanceOf(HTMLButtonElement) && el.textContent === text) {
              return el;
            }
          }
          return null;
        }

        async function openFile(file: TFile): Promise<void> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
          });
        }

        async function didSetToggle(settingName: string, shouldBeEnabled: boolean): Promise<boolean> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const item = [...tab.containerEl.querySelectorAll('.setting-item')]
            .find((el) => el.querySelector('.setting-item-name')?.textContent === settingName);
          const toggle = item?.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new TypeError(`"${settingName}" toggle was not found.`);
          }
          const wasEnabled = toggle.classList.contains('is-enabled');
          if (wasEnabled !== shouldBeEnabled) {
            toggle.click();
            await sleep(RENDER_DELAY_IN_MILLISECONDS);
          }
          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return wasEnabled;
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    expect(result.confirmButtonPresent).toBe(true);
    // The dialog previews what will move — the whole point of asking before a flatten.
    expect(result.listsTheItem).toBe(true);
    expect(result.changeTargetDisabled).toBe(false);
    expect(result.promoted).toBe(true);
    // Issue #165: both paths render as real anchors, the vault-root destination labelled `/`.
    expect(result.linkTexts).toContain('fc-flat');
    expect(result.linkTexts).toContain('/');
  });

  it('does not flatten the folder when the confirmation dialog is cancelled', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const isOriginalShouldAsk = await didSetToggle('Should ask before flattening a folder', true);
        try {
          await trashIfExists('fc-keep.md');
          await trashIfExists('fc-flat-cancel');

          await app.vault.createFolder('fc-flat-cancel');
          const note = await app.vault.create('fc-flat-cancel/fc-keep.md', 'keep body');
          await openFile(note);

          app.commands.executeCommandById(`${pluginId}:flatten-folder`);

          await waitUntil({ message: 'flatten dialog did not open', predicate: () => findButton('Cancel') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          findButton('Cancel')?.click();
          await waitUntil({ message: 'dialog did not close', predicate: () => document.querySelector('.modal-button-container') === null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // Nothing moved: the child is still inside the folder and nothing landed at the root.
          const isUntouched = app.vault.getAbstractFileByPath('fc-flat-cancel/fc-keep.md') !== null
            && app.vault.getAbstractFileByPath('fc-keep.md') === null;

          return { untouched: isUntouched };
        } finally {
          await didSetToggle('Should ask before flattening a folder', isOriginalShouldAsk);
        }

        function findButton(text: string): HTMLButtonElement | null {
          for (const el of document.querySelectorAll('.modal-button-container button')) {
            if (el.instanceOf(HTMLButtonElement) && el.textContent === text) {
              return el;
            }
          }
          return null;
        }

        async function openFile(file: TFile): Promise<void> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
          });
        }

        async function didSetToggle(settingName: string, shouldBeEnabled: boolean): Promise<boolean> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const item = [...tab.containerEl.querySelectorAll('.setting-item')]
            .find((el) => el.querySelector('.setting-item-name')?.textContent === settingName);
          const toggle = item?.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new TypeError(`"${settingName}" toggle was not found.`);
          }
          const wasEnabled = toggle.classList.contains('is-enabled');
          if (wasEnabled !== shouldBeEnabled) {
            toggle.click();
            await sleep(RENDER_DELAY_IN_MILLISECONDS);
          }
          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return wasEnabled;
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    expect(result.untouched).toBe(true);
  });

  it('moves the folder when the confirmation dialog is confirmed', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const isOriginalShouldAsk = await didSetToggle('Should ask before moving a folder', true);
        try {
          await trashIfExists('fc-mv-dst');
          await trashIfExists('fc-mv-src');

          await app.vault.createFolder('fc-mv-src');
          const note = await app.vault.create('fc-mv-src/inner.md', 'inner body');
          await app.vault.createFolder('fc-mv-dst');
          await openFile(note);

          app.commands.executeCommandById(`${pluginId}:move-folder`);
          await waitUntil({ message: 'move picker did not open', predicate: () => document.querySelector('.prompt') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          await chooseInPicker('fc-mv-dst');

          // The confirmation dialog appears after a target is chosen.
          await waitUntil({ message: 'move dialog did not open', predicate: () => findButton('Move') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const isConfirmButtonPresent = findButton('Move') !== null;
          // The move HAS a picked target, so it can be changed from the dialog.
          const isChangeTargetEnabled = !(findButton('Change target')?.disabled ?? true);
          // Issue #165: the source AND the destination are both clickable links.
          const linkTexts = [...document.querySelectorAll('.modal-content a')].map((el) => el.textContent);

          findButton('Move')?.click();

          await waitUntil({
            message: 'folder was not moved',
            predicate: () => app.vault.getAbstractFileByPath('fc-mv-dst/fc-mv-src/inner.md') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const isMoved = app.vault.getAbstractFileByPath('fc-mv-dst/fc-mv-src/inner.md') !== null
            && app.vault.getAbstractFileByPath('fc-mv-src') === null;

          return { changeTargetEnabled: isChangeTargetEnabled, confirmButtonPresent: isConfirmButtonPresent, linkTexts, moved: isMoved };
        } finally {
          await didSetToggle('Should ask before moving a folder', isOriginalShouldAsk);
        }

        async function chooseInPicker(itemPath: string): Promise<void> {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No move picker input.');
          }
          input.value = itemPath;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({ predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent === itemPath) });
          input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Enter', key: 'Enter' }));
        }

        function findButton(text: string): HTMLButtonElement | null {
          for (const el of document.querySelectorAll('.modal-button-container button')) {
            if (el.instanceOf(HTMLButtonElement) && el.textContent === text) {
              return el;
            }
          }
          return null;
        }

        async function openFile(file: TFile): Promise<void> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
          });
        }

        async function didSetToggle(settingName: string, shouldBeEnabled: boolean): Promise<boolean> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const item = [...tab.containerEl.querySelectorAll('.setting-item')]
            .find((el) => el.querySelector('.setting-item-name')?.textContent === settingName);
          const toggle = item?.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new TypeError(`"${settingName}" toggle was not found.`);
          }
          const wasEnabled = toggle.classList.contains('is-enabled');
          if (wasEnabled !== shouldBeEnabled) {
            toggle.click();
            await sleep(RENDER_DELAY_IN_MILLISECONDS);
          }
          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return wasEnabled;
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    expect(result.confirmButtonPresent).toBe(true);
    expect(result.changeTargetEnabled).toBe(true);
    expect(result.moved).toBe(true);
    // Issue #165: the destination is an anchor, not a code block, just like the source.
    expect(result.linkTexts).toContain('fc-mv-src');
    expect(result.linkTexts).toContain('fc-mv-dst');
  });

  it('does not move the folder when the confirmation dialog is cancelled', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const isOriginalShouldAsk = await didSetToggle('Should ask before moving a folder', true);
        try {
          await trashIfExists('fc-mv-dst-cancel');
          await trashIfExists('fc-mv-src-cancel');

          await app.vault.createFolder('fc-mv-src-cancel');
          const note = await app.vault.create('fc-mv-src-cancel/inner.md', 'inner body');
          await app.vault.createFolder('fc-mv-dst-cancel');
          await openFile(note);

          app.commands.executeCommandById(`${pluginId}:move-folder`);
          await waitUntil({ message: 'move picker did not open', predicate: () => document.querySelector('.prompt') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          await chooseInPicker('fc-mv-dst-cancel');

          await waitUntil({ message: 'move dialog did not open', predicate: () => findButton('Cancel') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          findButton('Cancel')?.click();
          await waitUntil({ message: 'dialog did not close', predicate: () => document.querySelector('.modal-button-container') === null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // Nothing moved: the folder is still where it was and the destination stayed empty.
          const isUntouched = app.vault.getAbstractFileByPath('fc-mv-src-cancel/inner.md') !== null
            && app.vault.getAbstractFileByPath('fc-mv-dst-cancel/fc-mv-src-cancel') === null;

          return { untouched: isUntouched };
        } finally {
          await didSetToggle('Should ask before moving a folder', isOriginalShouldAsk);
        }

        async function chooseInPicker(itemPath: string): Promise<void> {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No move picker input.');
          }
          input.value = itemPath;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({ predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent === itemPath) });
          input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Enter', key: 'Enter' }));
        }

        function findButton(text: string): HTMLButtonElement | null {
          for (const el of document.querySelectorAll('.modal-button-container button')) {
            if (el.instanceOf(HTMLButtonElement) && el.textContent === text) {
              return el;
            }
          }
          return null;
        }

        async function openFile(file: TFile): Promise<void> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
          });
        }

        async function didSetToggle(settingName: string, shouldBeEnabled: boolean): Promise<boolean> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const item = [...tab.containerEl.querySelectorAll('.setting-item')]
            .find((el) => el.querySelector('.setting-item-name')?.textContent === settingName);
          const toggle = item?.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new TypeError(`"${settingName}" toggle was not found.`);
          }
          const wasEnabled = toggle.classList.contains('is-enabled');
          if (wasEnabled !== shouldBeEnabled) {
            toggle.click();
            await sleep(RENDER_DELAY_IN_MILLISECONDS);
          }
          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return wasEnabled;
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    expect(result.untouched).toBe(true);
  });
});
