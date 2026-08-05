import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only, matching the sibling merge-folder suite: this is a folder-contents merge (file-delete)
// Flow. Isolation:
// `npx vitest run --project integration-tests:desktop src/merge-folder-into-file-location.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: LocationSettings;
}

interface LocationProbe {
  besideFolderPath: null | string;
  defaultNewNoteLocationPath: null | string;
  insideFolderPath: null | string;
  mergedFolderSurvivesInsideMode: boolean;
}

interface LocationSettings {
  mergeFolderIntoFileLocation: string;
  shouldAskBeforeMerging: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: LocationSettings) => void): Promise<void>;
  settings: LocationSettings;
}

/**
 * Issue #178 — where a folder merge creates the merged note.
 *
 * `DefaultNewNoteLocation` is the reason this suite exists rather than living only in the unit tests:
 * Obsidian's `newFileLocation` / `newFileFolderPath` are modeled by neither `obsidian-typings` nor
 * `obsidian-test-mocks`, so the resolution through `fileManager.getNewFileParent` can only be exercised
 * against a real Obsidian.
 */
describe('merged note location (issue #178)', () => {
  it('creates the merged note beside, inside, or in the default new-note folder', async () => {
    const result = await evalInObsidian({
      // eslint-disable-next-line unicorn/name-replacements -- `args` is an `obsidian-integration-testing` parameter name.
      args: { pluginId: PLUGIN_ID },
      // eslint-disable-next-line unicorn/name-replacements -- `fn` is an `obsidian-integration-testing` parameter name.
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }): Promise<LocationProbe> {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const settingsComponent = findSettingsComponent();
        const isOriginalShouldAsk = settingsComponent.settings.shouldAskBeforeMerging;
        const originalLocation = settingsComponent.settings.mergeFolderIntoFileLocation;
        const originalNewFileLocation = app.vault.getConfig('newFileLocation');
        const originalNewFileFolderPath = app.vault.getConfig('newFileFolderPath');

        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = false;
          });

          const besideFolderPath = await mergeWith('BesideFolder', 'loc-beside', 'loc-beside.md');
          const insideFolderPath = await mergeWith('InsideFolder', 'loc-inside', 'loc-inside/loc-inside.md');

          // The folder is no longer empty after an inside-merge, so it survives the cleanup.
          const isMergedFolderSurvivesInsideMode = app.vault.getAbstractFileByPath('loc-inside') !== null;

          // Point Obsidian's own new-note setting at a specific folder, which is what this mode honours.
          await trashIfExists('loc-inbox');
          await app.vault.createFolder('loc-inbox');
          app.vault.setConfig('newFileLocation', 'folder');
          app.vault.setConfig('newFileFolderPath', 'loc-inbox');

          const defaultNewNoteLocationPath = await mergeWith('DefaultNewNoteLocation', 'loc-default', 'loc-inbox/loc-default.md');

          return {
            besideFolderPath,
            defaultNewNoteLocationPath,
            insideFolderPath,
            mergedFolderSurvivesInsideMode: isMergedFolderSurvivesInsideMode
          };
        } finally {
          app.vault.setConfig('newFileLocation', originalNewFileLocation);
          app.vault.setConfig('newFileFolderPath', originalNewFileFolderPath);
          await settingsComponent.editAndSave((settings) => {
            settings.mergeFolderIntoFileLocation = originalLocation;
            settings.shouldAskBeforeMerging = isOriginalShouldAsk;
          });
        }

        /**
         * Runs one merge under the given location setting and reports where the note actually landed.
         *
         * @param location - The `MergeFolderIntoFileLocation` value to apply.
         * @param folderName - The folder to create and merge.
         * @param expectedPath - Where the merged note is expected; waited for, then confirmed by reading.
         * @returns The merged note's path, or `null` when it did not appear there.
         */
        async function mergeWith(location: string, folderName: string, expectedPath: string): Promise<null | string> {
          await settingsComponent.editAndSave((settings) => {
            settings.mergeFolderIntoFileLocation = location;
          });

          await trashIfExists(folderName);
          await trashIfExists(`${folderName}.md`);
          await trashIfExists(expectedPath);

          await app.vault.createFolder(folderName);
          await app.vault.createFolder(`${folderName}/sub`);
          const alpha = await app.vault.create(`${folderName}/alpha.md`, `alpha body for ${location}`);
          await app.vault.create(`${folderName}/sub/bravo.md`, `bravo body for ${location}`);

          await openFile(alpha);
          app.commands.executeCommandById(`${pluginId}:merge-folder-into-file`);

          await waitUntil({
            message: `merged note did not appear at ${expectedPath} for ${location}`,
            predicate: () => app.vault.getAbstractFileByPath(expectedPath) !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const merged = app.vault.getAbstractFileByPath(expectedPath);
          if (!(merged instanceof obsidianModule.TFile)) {
            return null;
          }

          const content = await app.vault.read(merged);
          return content.includes(`alpha body for ${location}`) && content.includes(`bravo body for ${location}`)
            ? merged.path
            : null;
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
          return typeof node.editAndSave === 'function' && typeof node.settings?.mergeFolderIntoFileLocation === 'string';
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
      vaultPath: getTempVault().path
    });

    // Today's behavior, and the default: beside the folder, in the folder's own parent.
    expect(result.besideFolderPath).toBe('loc-beside.md');

    // Reading (a) of the report: inside the merged folder.
    expect(result.insideFolderPath).toBe('loc-inside/loc-inside.md');
    // And the documented consequence — the folder is not empty afterwards, so it is not cleaned up.
    expect(result.mergedFolderSurvivesInsideMode).toBe(true);

    // Reading (b): wherever Obsidian itself would put a new note. This is the assertion that cannot be
    // Made in a unit test, because the mocks do not model `newFileLocation` / `newFileFolderPath`.
    expect(result.defaultNewNoteLocationPath).toBe('loc-inbox/loc-default.md');
  });
});
