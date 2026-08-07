import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

/*
 * Coverage for issue #186: when the merged note is created INSIDE the folder and the configured note name
 * matches a note that folder already holds, the configured name must still be used. The clashing note is
 * one of the notes being merged, so it is gone by the time the merge finishes - de-duplicating against it
 * (issue #178) leaves the user with `Overview 1.md` when they asked for `Overview.md`.
 *
 * Isolation: `npx vitest run --project integration-tests:desktop src/merge-folder-name-clash.desktop.integration.test.ts`.
 */

const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: MergeSettings;
}

interface MergeSettings {
  emptyFolderBehaviorAfterMergingFolder: string;
  mergeFolderIntoFileLocation: string;
  mergeFolderIntoFileNoteNameTemplate: string;
  shouldAskBeforeMerging: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: MergeSettings) => void): Promise<void>;
  settings: MergeSettings;
}

describe('merging a folder into a note whose name a merged note already uses (issue #186)', () => {
  it('should use the configured note name rather than a de-duplicated one', async () => {
    const result = await evalInObsidian({
      // eslint-disable-next-line unicorn/name-replacements -- `args` is an `obsidian-integration-testing` parameter name.
      args: { pluginId: PLUGIN_ID },
      // eslint-disable-next-line unicorn/name-replacements -- `fn` is an `obsidian-integration-testing` parameter name.
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const FOLDER_PATH = 'merge-name-clash';
        const EXPECTED_PATH = `${FOLDER_PATH}/Overview.md`;
        const DE_DUPLICATED_PATH = `${FOLDER_PATH}/Overview 1.md`;

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = false;
            settings.mergeFolderIntoFileNoteNameTemplate = 'Overview';
            settings.mergeFolderIntoFileLocation = 'InsideFolder';
            // Keep the folder so the assertions are about the note name alone.
            settings.emptyFolderBehaviorAfterMergingFolder = 'Keep';
          });

          await trashIfExists(FOLDER_PATH);

          await app.vault.createFolder(FOLDER_PATH);
          // The clashing note is itself one of the notes being merged.
          await app.vault.create(`${FOLDER_PATH}/Overview.md`, 'overview body');
          const alpha = await app.vault.create(`${FOLDER_PATH}/alpha.md`, 'alpha body');

          await openFile(alpha.path);

          app.commands.executeCommandById(`${pluginId}:merge-folder-into-file`);

          await waitUntil({
            message: 'the merged note was not created under either name',
            predicate: () =>
              app.vault.getAbstractFileByPath(EXPECTED_PATH) !== null
              || app.vault.getAbstractFileByPath(DE_DUPLICATED_PATH) !== null
          });
          // Let the source deletions settle so a merged note that is renamed at the end is observed settled.
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const mergedFile = app.vault.getAbstractFileByPath(EXPECTED_PATH);
          const mergedContent = mergedFile instanceof obsidianModule.TFile ? await app.vault.read(mergedFile) : '';

          return {
            hasAlphaBody: mergedContent.includes('alpha body'),
            hasOverviewBody: mergedContent.includes('overview body'),
            isDeDuplicatedPresent: app.vault.getAbstractFileByPath(DE_DUPLICATED_PATH) !== null,
            isExpectedPresent: mergedFile !== null,
            remainingPaths: app.vault.getFiles()
              .map((file) => file.path)
              .filter((path) => path.startsWith(`${FOLDER_PATH}/`))
              .sort((a, b) => a.localeCompare(b))
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.emptyFolderBehaviorAfterMergingFolder = original.emptyFolderBehaviorAfterMergingFolder;
            settings.mergeFolderIntoFileLocation = original.mergeFolderIntoFileLocation;
            settings.mergeFolderIntoFileNoteNameTemplate = original.mergeFolderIntoFileNoteNameTemplate;
            settings.shouldAskBeforeMerging = original.shouldAskBeforeMerging;
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
          return typeof node.editAndSave === 'function' && typeof node.settings?.mergeFolderIntoFileNoteNameTemplate === 'string';
        }

        async function openFile(path: string): Promise<void> {
          const file = app.vault.getAbstractFileByPath(path);
          if (!(file instanceof obsidianModule.TFile)) {
            throw new TypeError(`No file at ${path}.`);
          }
          await app.workspace.getLeaf(false).openFile(file);
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }
      },
      vaultPath: getTempVault().path
    });

    // The merge really happened: both source bodies are in the merged note.
    expect(result.isExpectedPresent).toBe(true);
    expect(result.hasOverviewBody).toBe(true);
    expect(result.hasAlphaBody).toBe(true);

    // And it kept the configured name instead of being bumped to `Overview 1`.
    expect(result.isDeDuplicatedPresent).toBe(false);
    expect(result.remainingPaths).toStrictEqual(['merge-name-clash/Overview.md']);
  });
});
