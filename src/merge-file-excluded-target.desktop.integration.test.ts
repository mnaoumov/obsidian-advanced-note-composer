import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only: the whole point is what the REAL picker offers, which no unit test can see — the picker
// Classes are `v8 ignore`d UI code, and the composer guard behind them defaults to refusing, so a merge
// Into an excluded note failed silently at whichever layer was reached first.
// Isolation: `npx vitest run --project integration-tests:desktop src/merge-file-excluded-target.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: ExcludedMergeSettings;
}

interface ExcludedMergeSettings {
  mergeExcludePaths: string[];
  shouldAllowOnlyCurrentFolderByDefault: boolean;
  shouldAlwaysMergeExcludedItems: boolean;
  shouldAskBeforeMerging: boolean;
  shouldOfferExcludedPathsAsMergeDestinations: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: ExcludedMergeSettings) => void): Promise<void>;
  settings: ExcludedMergeSettings;
}

describe('merging into an excluded target file (issue #240)', () => {
  it('offers and merges into an excluded note only while excluded destinations are offered', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const SOURCE_PATH = 't492-source.md';
        const TARGET_PATH = 't492-excluded/t492-target.md';

        const settingsComponent = findSettingsComponent();
        const originalExcludePaths = [...settingsComponent.settings.mergeExcludePaths];
        const isOriginalAlwaysMerge = settingsComponent.settings.shouldAlwaysMergeExcludedItems;
        const isOriginalOfferExcludedDestinations = settingsComponent.settings.shouldOfferExcludedPathsAsMergeDestinations;
        const isOriginalShouldAsk = settingsComponent.settings.shouldAskBeforeMerging;
        const isOriginalOnlyCurrentFolder = settingsComponent.settings.shouldAllowOnlyCurrentFolderByDefault;

        try {
          await trashIfExists(SOURCE_PATH);
          await trashIfExists('t492-excluded');
          await app.vault.createFolder('t492-excluded');
          const target = await app.vault.create(TARGET_PATH, 'target body');
          const source = await resetFile(SOURCE_PATH, 'source body');

          await settingsComponent.editAndSave((settings) => {
            settings.mergeExcludePaths = ['t492-excluded'];
            settings.shouldAskBeforeMerging = false;
            // The target sits in a sub-folder, so leaving this on would hide it for a reason that has
            // Nothing to do with what is under test.
            settings.shouldAllowOnlyCurrentFolderByDefault = false;
            settings.shouldAlwaysMergeExcludedItems = false;
            settings.shouldOfferExcludedPathsAsMergeDestinations = false;
          });

          const isOfferedWhenOff = await didPickerOfferTarget(source);

          // Issue #253's regression guard, mirrored from the folder side: merging excluded ITEMS must not
          // Also offer an excluded DESTINATION.
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAlwaysMergeExcludedItems = true;
          });

          const isOfferedWhenSwallowingOnly = await didPickerOfferTarget(source);

          await settingsComponent.editAndSave((settings) => {
            settings.shouldOfferExcludedPathsAsMergeDestinations = true;
          });

          const isOfferedWhenOn = await didPickerOfferTarget(source);

          // Offered with the setting on — now go through with it.
          await openPicker(source);
          await chooseInPicker('t492-target');
          await waitUntil({
            message: 'the merge into the excluded target did not complete',
            predicate: () => app.vault.getAbstractFileByPath(SOURCE_PATH) === null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          return {
            offeredWhenOff: isOfferedWhenOff,
            offeredWhenOn: isOfferedWhenOn,
            offeredWhenSwallowingOnly: isOfferedWhenSwallowingOnly,
            sourceExists: app.vault.getAbstractFileByPath(SOURCE_PATH) !== null,
            targetContent: await app.vault.read(target)
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.mergeExcludePaths = originalExcludePaths;
            settings.shouldAlwaysMergeExcludedItems = isOriginalAlwaysMerge;
            settings.shouldAskBeforeMerging = isOriginalShouldAsk;
            settings.shouldAllowOnlyCurrentFolderByDefault = isOriginalOnlyCurrentFolder;
            settings.shouldOfferExcludedPathsAsMergeDestinations = isOriginalOfferExcludedDestinations;
          });
        }

        async function chooseInPicker(query: string): Promise<void> {
          const input = getPickerInput();
          input.value = query;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: 'the excluded target did not appear as a suggestion',
            predicate: () => hasSuggestion(query)
          });
          input.focus();
          pressKey({ key: 'Enter' });
        }

        /**
         * Opens the picker, types the excluded target's name, and reports whether it is offered.
         *
         * Absence cannot be waited FOR, so the suggestions are given the same render delay a present one
         * would need and then read once — otherwise "not there yet" would read as "correctly hidden".
         *
         * @param sourceFile - The note the merge starts from.
         * @returns Whether the excluded target was offered.
         */
        async function didPickerOfferTarget(sourceFile: TFile): Promise<boolean> {
          await openPicker(sourceFile);
          const input = getPickerInput();
          input.value = 't492-target';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const isOffered = hasSuggestion('t492-target');
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
          return [...document.querySelectorAll('.suggestion-title')].some((el) => el.textContent.includes(text));
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
            predicate: () => app.workspace.getActiveFile()?.path === SOURCE_PATH
          });
          app.commands.executeCommandById(`${pluginId}:merge-file`);
          await waitUntil({
            message: 'the merge picker did not open',
            predicate: () => document.querySelector('.prompt') !== null
          });
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

    // With both settings off the excluded note is not offered at all.
    expect(result.offeredWhenOff).toBe(false);
    // Nor is it offered merely because excluded ITEMS are always merged (issue #253).
    expect(result.offeredWhenSwallowingOnly).toBe(false);
    // Only the setting that asks the destination question offers it...
    expect(result.offeredWhenOn).toBe(true);
    // ...and the merge actually lands in it, instead of being refused by the composer (issue #240).
    expect(result.targetContent).toContain('source body');
    expect(result.targetContent).toContain('target body');
    expect(result.sourceExists).toBe(false);
  });
});
