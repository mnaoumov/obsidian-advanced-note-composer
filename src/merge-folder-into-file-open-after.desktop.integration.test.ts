import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only: this is a folder-contents merge (file-delete) flow, matching the plugin's established
// Integration convention. File-move/delete suites can hit the documented headless rename wall when several
// Run in one aggregate; if this stalls in the aggregate, it is `it.skip`-ped and must still pass alone.
// Isolation: `npx vitest run --project integration-tests:desktop src/merge-folder-into-file-open-after.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';
// Same budget as `merge-folder-no-active-leaf-cycling`: the assertion is about WHETHER the merged note is
// Opened, never about how fast, so a loaded machine must not be able to fail it.
const MERGE_TIMEOUT_IN_MILLISECONDS = 90_000;
const TEST_TIMEOUT_IN_MILLISECONDS = 120_000;

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: MergeSettings;
}

interface MergeSettings {
  emptyFolderBehaviorAfterMergingFolder: string;
  shouldAskBeforeMerging: boolean;
  shouldOpenNoteAfterMergingFolderIntoFile: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: MergeSettings) => void): Promise<void>;
  settings: MergeSettings;
}

describe('merge folder contents into a single file opens the merged note (issue #212)', () => {
  it('opens the merged note exactly once when the setting is on', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, mergeTimeoutInMilliseconds, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const SOURCE_FOLDER = 'open-after-src';
        const MERGED_NOTE_PATH = 'open-after-src.md';

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        // Every note the merge activates, so a per-note open coming back (issue #106) shows up as MORE than
        // One entry: both sources merge into the SAME target, so cycling would activate it once per note.
        const openedMergedNote: string[] = [];
        let eventRef: unknown = null;
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = false;
            settings.shouldOpenNoteAfterMergingFolderIntoFile = true;
            // The emptied folder disappearing is the post-commit signal; the open runs after that.
            settings.emptyFolderBehaviorAfterMergingFolder = 'Delete';
          });

          await trashIfExists(SOURCE_FOLDER);
          await trashIfExists(MERGED_NOTE_PATH);

          await app.vault.createFolder(SOURCE_FOLDER);
          const alpha = await app.vault.create(`${SOURCE_FOLDER}/alpha.md`, 'alpha body');
          await app.vault.create(`${SOURCE_FOLDER}/beta.md`, 'beta body');

          // The folder command resolves its folder from the ACTIVE file's parent, and this is also what
          // Makes the starting point a note OTHER than the merged one.
          await openFile(alpha);

          eventRef = app.workspace.on('active-leaf-change', () => {
            const activePath = app.workspace.getActiveFile()?.path;
            if (activePath === MERGED_NOTE_PATH) {
              openedMergedNote.push(activePath);
            }
          });

          app.commands.executeCommandById(`${pluginId}:merge-folder-into-file`);

          await waitUntil({
            message: 'merged single file was not created',
            predicate: () => app.vault.getAbstractFileByPath(MERGED_NOTE_PATH) !== null,
            timeoutInMilliseconds: mergeTimeoutInMilliseconds
          });
          await waitUntil({
            message: 'the emptied folder was not deleted, so the merge had not committed',
            predicate: () => app.vault.getAbstractFileByPath(SOURCE_FOLDER) === null,
            timeoutInMilliseconds: mergeTimeoutInMilliseconds
          });
          await waitUntil({
            message: 'the merged note was never opened',
            predicate: () => app.workspace.getActiveFile()?.path === MERGED_NOTE_PATH,
            timeoutInMilliseconds: mergeTimeoutInMilliseconds
          });
          // Long enough for a second, unwanted open to show up in the recorder before it is read.
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          return {
            activePath: app.workspace.getActiveFile()?.path ?? null,
            openedMergedNoteCount: openedMergedNote.length
          };
        } finally {
          if (eventRef) {
            app.workspace.offref(eventRef as Parameters<typeof app.workspace.offref>[0]);
          }
          // The merged note lands at the vault root, which the whole aggregate shares.
          await trashIfExists(MERGED_NOTE_PATH);
          await trashIfExists(SOURCE_FOLDER);
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = original.shouldAskBeforeMerging;
            settings.shouldOpenNoteAfterMergingFolderIntoFile = original.shouldOpenNoteAfterMergingFolderIntoFile;
            settings.emptyFolderBehaviorAfterMergingFolder = original.emptyFolderBehaviorAfterMergingFolder;
          });
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

    // The user ends up in the note the merge produced...
    expect(result.activePath).toBe('open-after-src.md');
    // ...having been taken there exactly once. More than one activation would be issue #106 all over again:
    // Both sources merge into this same note, so a per-note open would activate it once per merged note.
    expect(result.openedMergedNoteCount).toBe(1);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
