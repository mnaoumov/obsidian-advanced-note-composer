import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only: this is a folder-merge (file-move) flow, matching the plugin's established integration
// Convention. File-move suites can hit the documented headless rename wall when several run in one
// Aggregate; if this stalls in the aggregate, it is `it.skip`-ped and must still pass alone.
// Isolation: `npx vitest run --project integration-tests:desktop src/merge-folder-open-first-note.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';
// Same budget as `merge-folder-no-active-leaf-cycling`, for the same reason: the assertion is about WHICH
// Note is opened, never about how fast, so a loaded machine must not be able to fail it.
const MERGE_TIMEOUT_IN_MILLISECONDS = 90_000;
const TEST_TIMEOUT_IN_MILLISECONDS = 120_000;

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: MergeSettings;
}

interface MergeSettings {
  shouldAskBeforeMerging: boolean;
  shouldOpenFirstNoteAfterMergingFolder: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: MergeSettings) => void): Promise<void>;
  settings: MergeSettings;
}

describe('folder merge opens the first note of the destination folder (issue #215)', () => {
  it('opens the naturally-first note of the destination exactly once when the setting is on', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, mergeTimeoutInMilliseconds, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const SOURCE_FOLDER = 'first-note-src';
        const TARGET_FOLDER = 'first-note-tgt';
        // `5.` before `30.`: text order would put the appendix first, and neither of them is the note the
        // Merge itself moved — what is asked for is the first note IN the folder.
        const EXPECTED_FIRST_NOTE_PATH = `${TARGET_FOLDER}/5. Middle.md`;

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        const openedFirstNote: string[] = [];
        let eventRef: unknown = null;
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = false;
            settings.shouldOpenFirstNoteAfterMergingFolder = true;
          });

          await trashIfExists(SOURCE_FOLDER);
          await trashIfExists(TARGET_FOLDER);

          await app.vault.createFolder(SOURCE_FOLDER);
          await app.vault.createFolder(TARGET_FOLDER);
          // Already in the destination, so the winner is a note the merge never touched.
          await app.vault.create(`${TARGET_FOLDER}/30. Appendix.md`, 'appendix body');
          await app.vault.create(`${TARGET_FOLDER}/5. Middle.md`, 'middle body');
          const gamma = await app.vault.create(`${SOURCE_FOLDER}/gamma.md`, 'gamma body');

          // The folder command resolves its source folder from the ACTIVE file's parent.
          await openFile(gamma);

          eventRef = app.workspace.on('active-leaf-change', () => {
            const activePath = app.workspace.getActiveFile()?.path;
            if (activePath === EXPECTED_FIRST_NOTE_PATH) {
              openedFirstNote.push(activePath);
            }
          });

          app.commands.executeCommandById(`${pluginId}:merge-folder`);
          await waitUntil({
            message: 'folder picker',
            predicate: () => document.querySelector('.prompt') !== null,
            timeoutInMilliseconds: mergeTimeoutInMilliseconds
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          await chooseFolderInPicker(TARGET_FOLDER);

          // `Should ask before merging` is off, so the merge runs directly. The source folder vanishing is
          // The post-commit signal; the open runs after it.
          await waitUntil({
            message: 'merge complete',
            predicate: () => app.vault.getAbstractFileByPath(SOURCE_FOLDER) === null,
            timeoutInMilliseconds: mergeTimeoutInMilliseconds
          });
          await waitUntil({
            message: 'the first note of the destination was never opened',
            predicate: () => app.workspace.getActiveFile()?.path === EXPECTED_FIRST_NOTE_PATH,
            timeoutInMilliseconds: mergeTimeoutInMilliseconds
          });
          // Long enough for a second, unwanted open to show up in the recorder before it is read.
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          return {
            activePath: app.workspace.getActiveFile()?.path ?? null,
            mergedNoteLanded: app.vault.getAbstractFileByPath(`${TARGET_FOLDER}/gamma.md`) !== null,
            openedFirstNoteCount: openedFirstNote.length
          };
        } finally {
          if (eventRef) {
            app.workspace.offref(eventRef as Parameters<typeof app.workspace.offref>[0]);
          }
          await trashIfExists(SOURCE_FOLDER);
          await trashIfExists(TARGET_FOLDER);
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = original.shouldAskBeforeMerging;
            settings.shouldOpenFirstNoteAfterMergingFolder = original.shouldOpenFirstNoteAfterMergingFolder;
          });
        }

        async function chooseFolderInPicker(folderPath: string): Promise<void> {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No merge-folder picker input.');
          }
          input.value = folderPath;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: 'suggestion',
            predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(folderPath))
          });
          input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Enter', key: 'Enter' }));
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

        function isSettingsComponent(node: ComponentTreeNode): node is SettingsCarrier {
          return typeof node.editAndSave === 'function' && typeof node.settings?.shouldAskBeforeMerging === 'boolean';
        }

        async function openFile(file: TFile): Promise<void> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
          });
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }
      },
      input: { mergeTimeoutInMilliseconds: MERGE_TIMEOUT_IN_MILLISECONDS, pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The merge actually happened...
    expect(result.mergedNoteLanded).toBe(true);
    // ...and it ended in the destination folder's naturally-first note, which is one that was already there
    // Rather than the note the merge moved.
    expect(result.activePath).toBe('first-note-tgt/5. Middle.md');
    expect(result.openedFirstNoteCount).toBe(1);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
