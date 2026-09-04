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

interface InstructionCounts {
  checkboxCount: number;
  instructionCount: number;
}

interface ReorderDialogReading {
  hasCheckbox: boolean;
  rowLabels: (string | undefined)[];
}

interface SplitSwitchReading {
  hasSwitchAfter: boolean;
  hasSwitchBefore: boolean;
  isCreateModeAfter: boolean;
  isCreateModeBefore: boolean;
}

const OVERRIDES_SETTING_NAME = 'Should show per-operation option overrides';
const PLUGIN_ID = 'advanced-note-composer';

describe('shouldShowModalInstructions', () => {
  it('should show the modal instruction bar only when the setting is enabled', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingItem, lib: { waitUntil }, obsidianModule, overridesSettingName, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 150;
        const EDIT_SAVE_DELAY_IN_MILLISECONDS = 300;

        const sourceFile = await ensureMarkdownFile('anc-instructions-source.md', '# Source\n\ncontent');
        await ensureMarkdownFile('anc-instructions-other.md', '# Other\n\ncontent');
        await app.workspace.getLeaf(false).openFile(sourceFile);
        await waitUntil({ predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor !== undefined });

        await setShowInstructions(true);
        const withInstructions = await openMergeModalAndCount();

        await setShowInstructions(false);
        const withoutInstructions = await openMergeModalAndCount();

        // Restore the default so the shared Obsidian instance is left in a clean state.
        await setShowInstructions(true);

        return { withInstructions, withoutInstructions };

        async function ensureMarkdownFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            return existing;
          }
          return app.vault.create(path, content);
        }

        async function setShowInstructions(shouldShow: boolean): Promise<void> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const settingTab = app.setting.pluginTabs.find((tab) => tab.id === pluginId);
          if (!settingTab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const settingItem = await findSettingItem({ app, name: overridesSettingName, settingTab });
          const toggleEl = settingItem?.querySelector('.checkbox-container');
          if (!(toggleEl instanceof HTMLElement)) {
            throw new TypeError(`"${overridesSettingName}" toggle was not found.`);
          }

          const isEnabled = toggleEl.classList.contains('is-enabled');
          if (isEnabled !== shouldShow) {
            toggleEl.click();
            await sleep(EDIT_SAVE_DELAY_IN_MILLISECONDS);
          }

          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        }

        async function openMergeModalAndCount(): Promise<InstructionCounts> {
          app.commands.executeCommandById(`${pluginId}:merge-file`);
          await waitUntil({ predicate: () => document.querySelector('.prompt') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const prompt = document.querySelector('.prompt');
          const checkboxCount = prompt ? prompt.querySelectorAll(':scope .prompt-instructions input[type="checkbox"]').length : 0;
          const instructionCount = prompt ? prompt.querySelectorAll(':scope .prompt-instructions .prompt-instruction').length : 0;

          // Cancel the merge via the plugin's own unlock command. Aborting the setup flow closes the
          // Locked modal and releases the source-file lock, leaving no lingering modal or lock behind.
          app.commands.executeCommandById(`${pluginId}:unlock-active-note`);
          await waitUntil({ predicate: () => document.querySelector('.prompt') === null });

          return { checkboxCount, instructionCount };
        }
      },
      input: { findSettingItem: findSettingItemInObsidian, overridesSettingName: OVERRIDES_SETTING_NAME, pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    expect(result.withInstructions.instructionCount).toBeGreaterThan(0);
    expect(result.withInstructions.checkboxCount).toBeGreaterThan(0);
    expect(result.withoutInstructions.instructionCount).toBe(0);
    expect(result.withoutInstructions.checkboxCount).toBe(0);
  });

  // The reorder dialog's checkbox is the one issue #242 was filed about: it lives above the list rather than
  // In the instruction bar, so the setting used to leave it on screen. Turning the seed setting ON first is
  // What makes the second half of this meaningful — the files still have to be listed once the control that
  // Would have ticked the box is gone, or hiding it would have silently changed what the reorder does.
  it('should hide the reorder dialog\'s Include files checkbox while still applying the configured default', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingItem, includeFilesSettingName, lib: { waitUntil }, obsidianModule, overridesSettingName, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const EDIT_SAVE_DELAY_IN_MILLISECONDS = 300;
        const ROOT = 'anc-overrides-reorder';

        const stale = app.vault.getFolderByPath(ROOT);
        if (stale) {
          await app.fileManager.trashFile(stale);
        }
        await app.vault.createFolder(ROOT);
        for (const folderName of ['Alpha', 'Beta']) {
          await app.vault.createFolder(`${ROOT}/${folderName}`);
          await app.vault.create(`${ROOT}/${folderName}/inner.md`, 'inner\n');
        }
        await app.vault.create(`${ROOT}/Draft.md`, 'draft\n');

        await setToggle(includeFilesSettingName, true);

        await setToggle(overridesSettingName, false);
        const withoutOverrides = await openReorderAndRead();

        await setToggle(overridesSettingName, true);
        const withOverrides = await openReorderAndRead();

        // Leave the shared instance on the defaults the next suite expects.
        await setToggle(includeFilesSettingName, false);
        const root = app.vault.getFolderByPath(ROOT);
        if (root) {
          await app.fileManager.trashFile(root);
        }

        return { withoutOverrides, withOverrides };

        function clickCancel(): void {
          const button = [...document.querySelectorAll('.modal-button-container button')]
            .find((candidate) => candidate.textContent === 'Cancel');
          if (!(button instanceof HTMLButtonElement)) {
            throw new TypeError('No Cancel button.');
          }
          button.click();
        }

        async function openReorderAndRead(): Promise<ReorderDialogReading> {
          const rootFolder = app.vault.getFolderByPath(ROOT);
          if (!(rootFolder instanceof obsidianModule.TFolder)) {
            throw new TypeError(`No folder at ${ROOT}.`);
          }

          const menu = new obsidianModule.Menu();
          app.workspace.trigger('file-menu', menu, rootFolder, 'file-explorer-context-menu');
          const itemEl = menu.items.find((candidate) => candidate.dom.textContent === 'Reorder child folders...')?.dom;
          if (!itemEl) {
            throw new TypeError('No "Reorder child folders..." menu item.');
          }
          itemEl.click();

          await waitUntil({
            message: 'the reorder dialog did not open',
            predicate: () => document.querySelector('.advanced-note-composer-reorder-list') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const hasCheckbox = document.querySelector('.advanced-note-composer-reorder-toggle input[type="checkbox"]') !== null;
          const rowLabels = [...document.querySelectorAll<HTMLElement>('.advanced-note-composer-reorder-item')]
            .map((rowEl) => rowEl.dataset['rowLabel']);

          // Cancelled, never confirmed: a confirmed reorder would renumber the fixture and leave the next
          // Pass reading different rows.
          clickCancel();
          await waitUntil({
            message: 'the reorder dialog did not close',
            predicate: () => document.querySelector('.advanced-note-composer-reorder-list') === null
          });

          return { hasCheckbox, rowLabels };
        }

        async function setToggle(name: string, shouldEnable: boolean): Promise<void> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const settingTab = app.setting.pluginTabs.find((tab) => tab.id === pluginId);
          if (!settingTab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const settingItem = await findSettingItem({ app, name, settingTab });
          const toggleEl = settingItem?.querySelector('.checkbox-container');
          if (!(toggleEl instanceof HTMLElement)) {
            throw new TypeError(`"${name}" toggle was not found.`);
          }

          if (toggleEl.classList.contains('is-enabled') !== shouldEnable) {
            toggleEl.click();
            await sleep(EDIT_SAVE_DELAY_IN_MILLISECONDS);
          }

          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        }
      },
      input: {
        findSettingItem: findSettingItemInObsidian,
        includeFilesSettingName: 'Should include files when reordering by default',
        overridesSettingName: OVERRIDES_SETTING_NAME,
        pluginId: PLUGIN_ID
      },
      vaultPath: getTemporaryVault().path
    });

    // With the overrides hidden there is no checkbox at all — the reporter's ask...
    expect(result.withoutOverrides.hasCheckbox).toBe(false);
    // ...and the reorder still does what the settings page says: the notes are listed alongside the folders.
    expect(result.withoutOverrides.rowLabels).toEqual(['Alpha', 'Beta', 'Draft']);

    // Sensitivity: the same dialog DOES carry the checkbox once the overrides are shown again.
    expect(result.withOverrides.hasCheckbox).toBe(true);
    expect(result.withOverrides.rowLabels).toEqual(['Alpha', 'Beta', 'Draft']);
  });

  // The split picker's `Create` / `Merge` switch overrides `defaultSplitTargetMode`, and `Alt+M` is its
  // Keyboard twin. A keyboard command's scope registration is NOT gated by the instruction bar, so the
  // Shortcut had to be dropped explicitly — this is what would catch it coming back.
  it('should hide the split picker\'s Create/Merge switch and leave Alt+M inert', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingItem, lib: { pressKey, waitUntil }, obsidianModule, overridesSettingName, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const EDIT_SAVE_DELAY_IN_MILLISECONDS = 300;
        const SELECTION_END_OFFSET = 7;
        const SELECTION_START_OFFSET = 4;

        const source = await resetFile('anc-overrides-split.md', 'AAA BBB CCC');

        await setToggle(overridesSettingName, false);
        const withoutOverrides = await openPickerAndPressAltM();

        await setToggle(overridesSettingName, true);
        const withOverrides = await openPickerAndPressAltM();

        return { withoutOverrides, withOverrides };

        // `Enter to create` is rendered only while the picker will CREATE, i.e. only in `Create` mode
        // (`allowCreateNewFile`), so the row IS the mode read off the DOM. The name-required hint is not
        // Usable here: with the shortcut unregistered the `m` reaches the box, and a non-empty box hides
        // That hint whatever the mode is.
        function isCreateMode(): boolean {
          return [...document.querySelectorAll('.suggestion-action')]
            .some((actionEl) => actionEl.textContent === 'Enter to create');
        }

        async function openPickerAndPressAltM(): Promise<SplitSwitchReading> {
          const editor = await openAndGetEditor();
          editor.setSelection(editor.offsetToPos(SELECTION_START_OFFSET), editor.offsetToPos(SELECTION_END_OFFSET));
          app.commands.executeCommandById(`${pluginId}:extract-current-selection`);
          await waitUntil({
            message: 'the split picker did not open',
            predicate: () => document.querySelector('.prompt') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // A name no note carries, so the only row that can match it is the create row.
          typeQuery('anc-overrides-unheard-of');
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const hasSwitchBefore = document.querySelector('.advanced-note-composer-split-target-mode') !== null;
          const isCreateModeBefore = isCreateMode();

          await pressKey({ key: 'm', modifiers: ['Alt'] });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const hasSwitchAfter = document.querySelector('.advanced-note-composer-split-target-mode') !== null;
          const isCreateModeAfter = isCreateMode();

          // Abort through the plugin's own unlock command: it closes the picker AND releases the lock
          // `prepareForSplitFile` took on the source note, so nothing is left behind for the next pass.
          app.commands.executeCommandById(`${pluginId}:unlock-active-note`);
          await waitUntil({
            message: 'the split picker did not close',
            predicate: () => document.querySelector('.prompt') === null
          });

          return { hasSwitchAfter, hasSwitchBefore, isCreateModeAfter, isCreateModeBefore };
        }

        async function openAndGetEditor(): Promise<Editor> {
          await app.workspace.getLeaf(false).openFile(source);
          await waitUntil({ predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor !== undefined });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          return view.editor;
        }

        async function resetFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          return app.vault.create(path, content);
        }

        async function setToggle(name: string, shouldEnable: boolean): Promise<void> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const settingTab = app.setting.pluginTabs.find((tab) => tab.id === pluginId);
          if (!settingTab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const settingItem = await findSettingItem({ app, name, settingTab });
          const toggleEl = settingItem?.querySelector('.checkbox-container');
          if (!(toggleEl instanceof HTMLElement)) {
            throw new TypeError(`"${name}" toggle was not found.`);
          }

          if (toggleEl.classList.contains('is-enabled') !== shouldEnable) {
            toggleEl.click();
            await sleep(EDIT_SAVE_DELAY_IN_MILLISECONDS);
          }

          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        }

        function typeQuery(query: string): void {
          const inputEl = document.querySelector('.prompt-input');
          if (!(inputEl instanceof HTMLInputElement)) {
            throw new TypeError('No prompt input.');
          }
          inputEl.value = query;
          inputEl.dispatchEvent(new Event('input'));
        }
      },
      input: { findSettingItem: findSettingItemInObsidian, overridesSettingName: OVERRIDES_SETTING_NAME, pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    /*
     * Issue #258 took the create/merge switch OUT of what this setting suppresses: it is not an override
     * of a configured default but the picker stating what it is about to do, and hiding it left the mode
     * neither visible nor reachable — which is how issue #257's "clicking a path does nothing" happened.
     * So the switch, and the `Alt+M` that mirrors it, are present either way.
     */
    expect(result.withoutOverrides.hasSwitchBefore).toBe(true);
    expect(result.withoutOverrides.hasSwitchAfter).toBe(true);
    expect(result.withoutOverrides.isCreateModeBefore).toBe(true);
    expect(result.withoutOverrides.isCreateModeAfter).toBe(false);

    expect(result.withOverrides.hasSwitchBefore).toBe(true);
    expect(result.withOverrides.isCreateModeBefore).toBe(true);
    expect(result.withOverrides.isCreateModeAfter).toBe(false);
  });
});
