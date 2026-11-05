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

// Isolation: `npx vitest run --project integration-tests:desktop src/split/split-note-folder.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  readonly _children?: ComponentTreeNode[];
  readonly editAndSave?: unknown;
  readonly settings?: SplitNoteFolderSettings;
}

interface SettingsCarrier {
  readonly editAndSave: (editor: (settings: SplitNoteFolderSettings) => void) => Promise<void>;
  readonly settings: SplitNoteFolderSettings;
}

interface SplitNoteFolderSettings {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup and callbacks reassign this shared fixture state.
  shouldAllowOnlyCurrentFolderByDefault: boolean;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup and callbacks reassign this shared fixture state.
  shouldAskBeforeSplitting: boolean;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup and callbacks reassign this shared fixture state.
  shouldSplitIntoFolder: boolean;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup and callbacks reassign this shared fixture state.
  splitNoteFolderPath: string;
}

/*
 * Discussion #309: `Split note by headings - H1` should put every extracted note in one folder chosen once,
 * with no folder picked per split, no folder named after the note, and not the vault root - which is where
 * Obsidian's `Default location for new notes` set to `Vault folder` puts them.
 */
describe('folder for split notes (discussion #309)', () => {
  it('puts every note a split by headings creates in the configured folder', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        // Three waits share it, so the closure declares 3 x 7 000 = 21 000 ms, well under the ~30 s cap.
        const WAIT_TIMEOUT_IN_MILLISECONDS = 7000;
        const SPLIT_FOLDER = 'Issue 309 splits';
        const SOURCE_FOLDER = 'issue-309-source-folder';
        const SOURCE_PATH = `${SOURCE_FOLDER}/issue-309-source.md`;
        const HEADINGS = ['Issue 309 alpha', 'Issue 309 beta'];
        const SOURCE_CONTENT = HEADINGS.map((heading) => `# ${heading}\nbody of ${heading}\n`).join('\n');

        const settingsComponent = findSettingsComponent();
        const originalSettings = {
          shouldAllowOnlyCurrentFolderByDefault: settingsComponent.settings.shouldAllowOnlyCurrentFolderByDefault,
          shouldAskBeforeSplitting: settingsComponent.settings.shouldAskBeforeSplitting,
          shouldSplitIntoFolder: settingsComponent.settings.shouldSplitIntoFolder,
          splitNoteFolderPath: settingsComponent.settings.splitNoteFolderPath
        };
        const originalNewFileLocation = app.vault.getConfig('newFileLocation');
        try {
          app.vault.setConfig('newFileLocation', 'root');
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAllowOnlyCurrentFolderByDefault = false;
            settings.shouldAskBeforeSplitting = false;
            settings.shouldSplitIntoFolder = false;
            settings.splitNoteFolderPath = SPLIT_FOLDER;
          });

          if (!app.vault.getFolderByPath(SOURCE_FOLDER)) {
            await app.vault.createFolder(SOURCE_FOLDER);
          }
          const source = app.vault.getFileByPath(SOURCE_PATH) ?? await app.vault.create(SOURCE_PATH, SOURCE_CONTENT);
          const editor = await openAndGetEditor(source);
          editor.setValue(SOURCE_CONTENT);
          editor.setCursor({ ch: 0, line: 1 });

          await waitUntil({
            message: `metadata cache never indexed the headings of ${SOURCE_PATH}`,
            predicate: () => (app.metadataCache.getFileCache(source)?.headings ?? []).length === HEADINGS.length,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          app.commands.executeCommandById(`${pluginId}:split-note-by-headings-h1`);

          await waitUntil({
            message: `the split did not create its notes in ${SPLIT_FOLDER}`,
            predicate: () => HEADINGS.every((heading) => app.vault.getFileByPath(`${SPLIT_FOLDER}/${heading}.md`) !== null),
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          return {
            rootNotes: HEADINGS.filter((heading) => app.vault.getFileByPath(`${heading}.md`) !== null),
            splitFolderChildren: (app.vault.getFolderByPath(SPLIT_FOLDER)?.children ?? []).map((child) => child.name).sort()
          };
        } finally {
          app.vault.setConfig('newFileLocation', originalNewFileLocation);
          await settingsComponent.editAndSave((settings) => {
            Object.assign(settings, originalSettings);
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
          return typeof node.editAndSave === 'function' && typeof node.settings?.splitNoteFolderPath === 'string';
        }

        async function openAndGetEditor(file: TFile): Promise<Editor> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error(`No markdown view for ${file.path}.`);
          }
          return view.editor;
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    expect(result.splitFolderChildren).toEqual(['Issue 309 alpha.md', 'Issue 309 beta.md']);
    expect(result.rootNotes).toEqual([]);
  });
});
