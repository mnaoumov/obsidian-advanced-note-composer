import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only: this is a folder-contents merge (file-delete) flow, matching the plugin's established
// Integration convention. File-move/delete suites can hit the documented headless rename wall when several
// Run in one aggregate; if this stalls in the aggregate, it is `it.skip`-ped and must still pass alone.
// Isolation: `npx vitest run --project integration-tests:desktop src/merge-folder-into-file.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: MergeSettings;
}

interface MergeSettings {
  shouldAskBeforeMerging: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: MergeSettings) => void): Promise<void>;
  settings: MergeSettings;
}

describe('merge folder contents into a single file (issue #92)', () => {
  it('concatenates every descendant note into one new file named after the folder and deletes the sources', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const settingsComponent = findSettingsComponent();
        const originalShouldAsk = settingsComponent.settings.shouldAskBeforeMerging;
        try {
          // Skip the confirmation dialog so the merge runs straight from the command.
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = false;
          });

          await trashIfExists('combine-src');
          await trashIfExists('combine-src.md');

          await app.vault.createFolder('combine-src');
          await app.vault.createFolder('combine-src/sub');
          const alpha = await app.vault.create('combine-src/alpha.md', 'alpha body');
          await app.vault.create('combine-src/sub/bravo.md', 'bravo body');

          // Open a note inside the folder so the folder command resolves the active file's parent folder.
          await openFile(alpha);

          app.commands.executeCommandById(`${pluginId}:merge-folder-into-file`);

          // A single new note named after the folder appears, holding every descendant note's body.
          await waitUntil({
            message: 'merged single file was not created',
            predicate: () => app.vault.getAbstractFileByPath('combine-src.md') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const mergedFile = app.vault.getAbstractFileByPath('combine-src.md');
          const mergedContent = mergedFile && mergedFile instanceof obsidianModule.TFile
            ? await app.vault.read(mergedFile)
            : '';

          const hasAlpha = mergedContent.includes('alpha body');
          const hasBravo = mergedContent.includes('bravo body');
          const alphaSourceGone = app.vault.getAbstractFileByPath('combine-src/alpha.md') === null;
          const bravoSourceGone = app.vault.getAbstractFileByPath('combine-src/sub/bravo.md') === null;

          return { alphaSourceGone, bravoSourceGone, hasAlpha, hasBravo };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = originalShouldAsk;
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
      vaultPath: getTempVault().path
    });

    // Both descendant notes were concatenated into the single new file.
    expect(result.hasAlpha).toBe(true);
    expect(result.hasBravo).toBe(true);
    // The source notes were deleted.
    expect(result.alphaSourceGone).toBe(true);
    expect(result.bravoSourceGone).toBe(true);
  });
});
