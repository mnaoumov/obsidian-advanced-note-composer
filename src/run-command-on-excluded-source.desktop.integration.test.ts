import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only: the picker is `v8 ignore`d UI code, so only the real app shows that one exclude list both
// Hides a note from the picker AND lets a command run from that very note.
// Isolation: `npx vitest run --project integration-tests:desktop src/run-command-on-excluded-source.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: ExcludedSourceSettings;
}

interface ExcludedSourceSettings {
  mergeExcludePaths: string[];
  shouldAllowOnlyCurrentFolderByDefault: boolean;
  shouldAskBeforeMerging: boolean;
}

interface SettingsCarrier {
  editAndSave: (editor: (settings: ExcludedSourceSettings) => void) => Promise<void>;
  settings: ExcludedSourceSettings;
}

describe('running a command on a note the content filter excludes (issue #288)', () => {
  it('keeps the excluded note out of the picker, yet merges it away when the merge starts from it', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, pluginId }) {
        /**
         * Sized so the SUM of every wait this closure declares stays well under the transport's ~30 s
         * per-closure cap: six call sites (two `openPicker` calls at two waits each, one `chooseInPicker`, the
         * final merge wait) at 3 s each is 18 s. Every one of them settles in well under a second on a healthy
         * machine.
         */
        const WAIT_TIMEOUT_IN_MILLISECONDS = 3000;
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const EXCLUDED_FOLDER = 't1799-excluded';
        const EXCLUDED_NOTE_PATH = `${EXCLUDED_FOLDER}/t1799-inbox-note.md`;
        const OUTSIDE_NOTE_PATH = 't1799-outside.md';
        const TARGET_PATH = 't1799-target.md';

        const settingsComponent = findSettingsComponent();
        const originalExcludePaths = [...settingsComponent.settings.mergeExcludePaths];
        const isOriginalShouldAsk = settingsComponent.settings.shouldAskBeforeMerging;
        const isOriginalOnlyCurrentFolder = settingsComponent.settings.shouldAllowOnlyCurrentFolderByDefault;

        try {
          await app.vault.createFolder(EXCLUDED_FOLDER);
          const excludedNote = await app.vault.create(EXCLUDED_NOTE_PATH, 'inbox body');
          const outsideNote = await app.vault.create(OUTSIDE_NOTE_PATH, 'outside body');
          const target = await app.vault.create(TARGET_PATH, 'target body');

          await settingsComponent.editAndSave((settings) => {
            settings.mergeExcludePaths = [EXCLUDED_FOLDER];
            settings.shouldAskBeforeMerging = false;
            // The notes sit in different folders, so leaving this on would filter the picker for a reason
            // That has nothing to do with what is under test.
            settings.shouldAllowOnlyCurrentFolderByDefault = false;
          });

          // The half that did not change: from anywhere else, the excluded note is not a merge target.
          await openPicker(outsideNote);
          const isExcludedNoteOffered = await isSuggestionShownFor('t1799-inbox-note');
          // A positive control on the same picker, so "not offered" cannot pass on a list that never rendered.
          const isTargetOffered = await isSuggestionShownFor('t1799-target');
          getPickerInput().focus();
          await pressKey({ key: 'Escape' });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // The half #288 changed: started FROM the excluded note, the merge runs instead of refusing.
          await openPicker(excludedNote);
          await chooseInPicker('t1799-target');
          await waitUntil({
            message: 'the merge started from the excluded note did not complete',
            predicate: () => app.vault.getAbstractFileByPath(EXCLUDED_NOTE_PATH) === null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          return {
            excludedNoteExists: app.vault.getAbstractFileByPath(EXCLUDED_NOTE_PATH) !== null,
            isExcludedNoteOffered,
            isTargetOffered,
            targetContent: await app.vault.read(target)
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.mergeExcludePaths = originalExcludePaths;
            settings.shouldAskBeforeMerging = isOriginalShouldAsk;
            settings.shouldAllowOnlyCurrentFolderByDefault = isOriginalOnlyCurrentFolder;
          });
        }

        async function chooseInPicker(query: string): Promise<void> {
          const input = getPickerInput();
          input.value = query;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: `"${query}" did not appear as a suggestion`,
            predicate: () => hasSuggestion(query),
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          input.focus();
          await pressKey({ key: 'Enter' });
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
            && typeof node.settings.shouldAskBeforeMerging === 'boolean';
        }

        /**
         * Types a query into the open picker and reports whether a suggestion carries it.
         *
         * Absence cannot be waited FOR, so the list is given the same render delay a present suggestion would
         * need and then read once.
         *
         * @param query - The text to type.
         * @returns Whether a suggestion shows it.
         */
        async function isSuggestionShownFor(query: string): Promise<boolean> {
          const input = getPickerInput();
          input.value = query;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return hasSuggestion(query);
        }

        async function openPicker(sourceFile: TFile): Promise<void> {
          await app.workspace.getLeaf(false).openFile(sourceFile);
          await waitUntil({
            message: `${sourceFile.path} did not become active`,
            predicate: () => app.workspace.getActiveFile()?.path === sourceFile.path,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          app.commands.executeCommandById(`${pluginId}:merge-file`);
          await waitUntil({
            message: `the merge picker did not open on ${sourceFile.path}`,
            predicate: () => document.querySelector('.prompt') !== null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    expect(result.isTargetOffered).toBe(true);
    expect(result.isExcludedNoteOffered).toBe(false);
    // Before #288 the merge refused with an "ignored in the plugin settings" notice and never opened the
    // Picker, so this wait timed out; now the note is merged away into the target it was run against.
    expect(result.excludedNoteExists).toBe(false);
    expect(result.targetContent).toContain('inbox body');
    expect(result.targetContent).toContain('target body');
  });
});
