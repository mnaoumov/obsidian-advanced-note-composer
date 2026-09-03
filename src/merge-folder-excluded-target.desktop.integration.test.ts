import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only: the whole point is what the REAL folder picker offers, which no unit test can see —
// `MergeFolderModal` is `v8 ignore`d UI code.
// This is the folder-side counterpart of `merge-file-excluded-target.desktop.integration.test.ts`. Since
// Issue #253 the destination question has its own setting, `Should offer excluded paths as merge
// Destinations`: turning on `Should always merge excluded items` decides only what a merge SWALLOWS and
// Must leave every merge picker filtering excluded paths, which is what the reporter of #253 saw fail.
// Isolation: `npx vitest run --project integration-tests:desktop src/merge-folder-excluded-target.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: ExcludedMergeSettings;
}

interface ExcludedMergeSettings {
  mergeExcludePaths: string[];
  shouldAlwaysMergeExcludedItems: boolean;
  shouldAskBeforeMerging: boolean;
  shouldIncludeChildFoldersWhenMergingByDefault: boolean;
  shouldIncludeParentFoldersWhenMergingByDefault: boolean;
  shouldOfferExcludedPathsAsMergeDestinations: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: ExcludedMergeSettings) => void): Promise<void>;
  settings: ExcludedMergeSettings;
}

describe('merging into an excluded target folder', () => {
  it('offers and merges into an excluded folder only while excluded destinations are offered', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const SOURCE_FOLDER_PATH = 't504-source';
        const SOURCE_NOTE_PATH = 't504-source/t504-note.md';
        const TARGET_FOLDER_PATH = 't504-excluded';
        const MERGED_NOTE_PATH = 't504-excluded/t504-note.md';

        const settingsComponent = findSettingsComponent();
        const originalExcludePaths = [...settingsComponent.settings.mergeExcludePaths];
        const isOriginalAlwaysMerge = settingsComponent.settings.shouldAlwaysMergeExcludedItems;
        const isOriginalOfferExcludedDestinations = settingsComponent.settings.shouldOfferExcludedPathsAsMergeDestinations;
        const isOriginalShouldAsk = settingsComponent.settings.shouldAskBeforeMerging;
        const isOriginalIncludeChildFolders = settingsComponent.settings.shouldIncludeChildFoldersWhenMergingByDefault;
        const isOriginalIncludeParentFolders = settingsComponent.settings.shouldIncludeParentFoldersWhenMergingByDefault;

        try {
          await trashIfExists(SOURCE_FOLDER_PATH);
          await trashIfExists(TARGET_FOLDER_PATH);
          await app.vault.createFolder(SOURCE_FOLDER_PATH);
          await app.vault.createFolder(TARGET_FOLDER_PATH);
          const sourceNote = await app.vault.create(SOURCE_NOTE_PATH, 'source body');

          await settingsComponent.editAndSave((settings) => {
            settings.mergeExcludePaths = [TARGET_FOLDER_PATH];
            settings.shouldAskBeforeMerging = false;
            // Both folders sit at the vault root, so neither of these filters can hide the target for a
            // Reason that has nothing to do with what is under test.
            settings.shouldIncludeChildFoldersWhenMergingByDefault = true;
            settings.shouldIncludeParentFoldersWhenMergingByDefault = true;
            settings.shouldAlwaysMergeExcludedItems = false;
            settings.shouldOfferExcludedPathsAsMergeDestinations = false;
          });

          const isOfferedWhenOff = await didPickerOfferTarget(sourceNote);

          // Issue #253's regression guard: opting into merging excluded ITEMS must not also offer an
          // Excluded DESTINATION. This is the reporter's exact configuration.
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAlwaysMergeExcludedItems = true;
          });

          const isOfferedWhenSwallowingOnly = await didPickerOfferTarget(sourceNote);

          await settingsComponent.editAndSave((settings) => {
            settings.shouldOfferExcludedPathsAsMergeDestinations = true;
          });

          const isOfferedWhenOn = await didPickerOfferTarget(sourceNote);

          // Offered with the setting on — now go through with it.
          await openPicker(sourceNote);
          await chooseInPicker(TARGET_FOLDER_PATH);
          await waitUntil({
            message: 'the merge into the excluded target folder did not complete',
            predicate: () => app.vault.getAbstractFileByPath(SOURCE_FOLDER_PATH) === null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const mergedNote = app.vault.getAbstractFileByPath(MERGED_NOTE_PATH);
          return {
            mergedContent: mergedNote instanceof obsidianModule.TFile ? await app.vault.read(mergedNote) : null,
            offeredWhenOff: isOfferedWhenOff,
            offeredWhenOn: isOfferedWhenOn,
            offeredWhenSwallowingOnly: isOfferedWhenSwallowingOnly,
            sourceFolderExists: app.vault.getAbstractFileByPath(SOURCE_FOLDER_PATH) !== null
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.mergeExcludePaths = originalExcludePaths;
            settings.shouldAlwaysMergeExcludedItems = isOriginalAlwaysMerge;
            settings.shouldAskBeforeMerging = isOriginalShouldAsk;
            settings.shouldIncludeChildFoldersWhenMergingByDefault = isOriginalIncludeChildFolders;
            settings.shouldIncludeParentFoldersWhenMergingByDefault = isOriginalIncludeParentFolders;
            settings.shouldOfferExcludedPathsAsMergeDestinations = isOriginalOfferExcludedDestinations;
          });
        }

        async function chooseInPicker(query: string): Promise<void> {
          const input = getPickerInput();
          input.value = query;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: 'the excluded target folder did not appear as a suggestion',
            predicate: () => hasSuggestion(query)
          });
          input.focus();
          pressKey({ key: 'Enter' });
        }

        /**
         * Opens the folder picker, types the excluded folder's path, and reports whether it is offered.
         *
         * Absence cannot be waited FOR, so the suggestions are given the same render delay a present one
         * would need and then read once — otherwise "not there yet" would read as "correctly hidden".
         *
         * @param sourceFile - The note whose folder the merge starts from.
         * @returns Whether the excluded target folder was offered.
         */
        async function didPickerOfferTarget(sourceFile: TFile): Promise<boolean> {
          await openPicker(sourceFile);
          const input = getPickerInput();
          input.value = TARGET_FOLDER_PATH;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const isOffered = hasSuggestion(TARGET_FOLDER_PATH);
          input.focus();
          pressKey({ key: 'Escape' });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return isOffered;
        }

        function findSettingsComponent(): SettingsCarrier {
          const plugin = app.plugins.getPlugin(pluginId) as ComponentTreeNode | null;
          const queue: ComponentTreeNode[] = plugin ? [plugin] : [];
          while (queue.length > 0) {
            const node = queue.shift();
            if (!node) {
              continue;
            }
            if (isSettingsComponent(node)) {
              return node;
            }
            if (node._children) {
              queue.push(...node._children);
            }
          }
          throw new Error('Settings component was not found.');
        }

        function getPickerInput(): HTMLInputElement {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No merge picker input.');
          }
          return input;
        }

        function hasSuggestion(text: string): boolean {
          // The folder picker is a plain `FuzzySuggestModal`, so it renders `.suggestion-item` with no
          // `.suggestion-title` inside — unlike the file picker, whose rows the file-side test reads.
          return [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(text));
        }

        function isSettingsComponent(node: ComponentTreeNode): node is SettingsCarrier {
          return typeof node.editAndSave === 'function'
            && Array.isArray(node.settings?.mergeExcludePaths)
            && typeof node.settings.shouldAlwaysMergeExcludedItems === 'boolean';
        }

        async function openPicker(sourceFile: TFile): Promise<void> {
          await app.workspace.getLeaf(false).openFile(sourceFile);
          await waitUntil({
            message: 'the source note did not become active',
            predicate: () => app.workspace.getActiveFile()?.path === SOURCE_NOTE_PATH
          });
          app.commands.executeCommandById(`${pluginId}:merge-folder`);
          await waitUntil({
            message: 'the merge folder picker did not open',
            predicate: () => document.querySelector('.prompt') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
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

    // With both settings off the excluded folder is not offered at all.
    expect(result.offeredWhenOff).toBe(false);
    // Nor is it offered merely because excluded ITEMS are always merged — issue #253, the reporter's own
    // Configuration, and the whole reason the one setting became two.
    expect(result.offeredWhenSwallowingOnly).toBe(false);
    // Only the setting that actually asks the destination question offers it...
    expect(result.offeredWhenOn).toBe(true);
    // ...and the merge actually lands in it.
    expect(result.mergedContent).toContain('source body');
    expect(result.sourceFolderExists).toBe(false);
  });
});
