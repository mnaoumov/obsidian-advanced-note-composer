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

/**
 * `SplitTargetMode.Create`, spelled as the literal the setting persists and the dropdown option carries.
 *
 * Deliberately NOT imported from `plugin-settings.ts`: this file's module scope is evaluated in plain
 * Node, where that import pulls in `obsidian-dev-utils` and then `obsidian`, which does not resolve there
 * (`Cannot find package 'obsidian'`). Only the `callback` below runs inside Obsidian.
 */
const SPLIT_TARGET_MODE_CREATE = 'Create';

describe('change target from the split confirmation dialog', () => {
  it('reopens the picker and splits into the newly chosen target', async () => {
    const result = await evalInObsidian({
      async callback({ app, createMode, findSettingItem, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const isOriginalShouldAsk = await didSetAskBeforeSplitting(true);
        try {
          const source = await resetFile('change-target-source.md', 'alpha bravo charlie');
          const targetA = await resetFile('change-target-a.md', 'target a body');
          const targetB = await resetFile('change-target-b.md', 'target b body');

          // Open the source, select "bravo", and start an extract.
          const editor = await openAndGetEditor(source);
          editor.setSelection(editor.offsetToPos(6), editor.offsetToPos(11));
          app.commands.executeCommandById(`${pluginId}:extract-current-selection`);
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

          // The confirmation dialog appears again (for target B); confirm the split.
          await waitUntil({ predicate: () => findButton('Split') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          findButton('Split')?.click();

          // The split completes: target B receives the extracted text, source loses it.
          await waitUntil({ predicate: () => !document.body.querySelector('.mod-confirmation') });
          await waitUntil({ predicate: () => !editor.getValue().includes('bravo') });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // Read the source from the live editor buffer (the removal is applied there before it is
          // Auto-saved to disk); the targets are transaction-written, so read those from the vault.
          const sourceContent = editor.getValue();
          const targetAContent = await app.vault.read(targetA);
          const targetBContent = await app.vault.read(targetB);

          return { changeTargetButtonPresent: isChangeTargetButtonPresent, sourceContent, targetAContent, targetBContent };
        } finally {
          await didSetAskBeforeSplitting(isOriginalShouldAsk);
          /*
           * `chooseInPicker` above flips the picker to Merge so it will offer an EXISTING note, and CHOOSING
           * a target in a flipped mode PERSISTS that mode (issue #245) — the switch is only per-run until
           * you pick something with it. Nothing put it back, so this suite left every later suite in this
           * shared vault with a picker that opens in Merge, where typing a new note name offers no
           * create-new entry; that is what made a block of ~25 later files fail while each passed alone.
           *
           * Restored to `Create` rather than to whatever was here on entry: the mode is sticky GLOBAL
           * state, so the incoming value is only ever "what the previous suite happened to leave", while
           * `Create` is the shipped default every downstream picker test assumes. One settings visit, not
           * two, which matters in a suite whose waits are 5s.
           */
          await setDefaultSplitTargetMode(createMode);
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

        async function chooseInPicker(basename: string): Promise<void> {
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

          input.value = basename;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({ predicate: () => [...document.querySelectorAll('.suggestion-title')].some((el) => el.textContent.includes(basename)) });
          input.focus();
          await pressKey({ key: 'Enter' });
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

        /**
         * Sets the picker's remembered Create/Merge mode through its settings row.
         *
         * The switch above the picker itself is not usable for this: it is per-run, and by the time this
         * runs the picker is closed. Mirrors {@link didSetAskBeforeSplitting}.
         *
         * @param mode - The mode to leave the setting on.
         */
        async function setDefaultSplitTargetMode(mode: string): Promise<void> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const item = await findSettingItem({ app, name: 'Default split target mode', settingTab: tab });
          const dropdown = item?.querySelector('select');
          if (!(dropdown instanceof HTMLSelectElement)) {
            throw new TypeError('"Default split target mode" dropdown was not found.');
          }
          if (dropdown.value !== mode) {
            dropdown.value = mode;
            dropdown.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(RENDER_DELAY_IN_MILLISECONDS);
          }
          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
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
      input: { createMode: SPLIT_TARGET_MODE_CREATE, findSettingItem: findSettingItemInObsidian, pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The confirmation dialog offered "Change target"...
    expect(result.changeTargetButtonPresent).toBe(true);
    // ...and after re-picking, the split landed in target B (not target A), removing the text from source.
    expect(result.targetBContent).toContain('bravo');
    expect(result.targetAContent).toBe('target a body');
    expect(result.sourceContent).not.toContain('bravo');
  });
});
