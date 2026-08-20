import type { Editor } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

/*
 * End-to-end coverage for issue #246 (G97): with
 * `shouldCollectAttachmentsWithCustomAttachmentLocationAfterSplit` on, an extract hands its destination
 * note to the Custom Attachment Location plugin so that plugin collects the note's attachments.
 *
 * That plugin is not installed in this vault, and installing it to test this would be testing IT rather
 * than the hand-off. So a stand-in is registered under its id and the test asserts what this plugin is
 * responsible for: that it looks the plugin up, calls the documented entry point, passes the note the
 * extract actually created, and does none of it when the setting is off.
 *
 * Desktop-only, matching the sibling attachment suites.
 * Isolation: `npx vitest run --project integration-tests:desktop src/split-collect-attachments.desktop.integration.test.ts`.
 */

const PLUGIN_ID = 'advanced-note-composer';
const CUSTOM_ATTACHMENT_LOCATION_PLUGIN_ID = 'obsidian-custom-attachment-location';

interface CollectAttachmentsSettings {
  shouldAskBeforeSplitting: boolean;
  shouldCollectAttachmentsWithCustomAttachmentLocationAfterSplit: boolean;
}

interface CollectedAbstractFile {
  path: string;
}

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: CollectAttachmentsSettings;
}

interface LeafWithEditor {
  editor: Editor;
}

interface ProbeResult {
  readonly collectedPathsWhenOff: readonly string[];
  readonly collectedPathsWhenOn: readonly string[];
  readonly createdNoteExists: boolean;
  readonly settingsFound: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: CollectAttachmentsSettings) => void): Promise<void>;
  settings: CollectAttachmentsSettings;
}

describe('an extract hands its destination note to Custom Attachment Location (issue #246)', () => {
  it('calls the entry point with the created note when the setting is on, and not at all when it is off', async () => {
    const result = await evalInObsidian({
      async callback({
        app,
        customAttachmentLocationPluginId,
        lib: { waitUntil },
        obsidianModule,
        pluginId
      }): Promise<ProbeResult> {
        const SOURCE_PATH = 'split-collect-source.md';
        const ROOT_FOLDER = 'SplitCollectA';
        const SOURCE_CONTENT = [
          'Intro text',
          '',
          '## SplitCollectA',
          '',
          'Body of the extracted heading.',
          ''
        ].join('\n');
        const CURSOR_LINE = 4;
        const EXPECTED_HEADING_COUNT = 1;

        function findSettingsComponent(): null | SettingsCarrier {
          const pluginNode: unknown = app.plugins.getPlugin(pluginId);
          const queue: ComponentTreeNode[] = pluginNode ? [pluginNode] : [];
          while (queue.length > 0) {
            const node = queue.shift();
            if (!node) {
              continue;
            }
            if (
              typeof node.editAndSave === 'function' && node.settings
              && typeof node.settings.shouldCollectAttachmentsWithCustomAttachmentLocationAfterSplit === 'boolean'
            ) {
              const carrier: unknown = node;
              return carrier as SettingsCarrier;
            }
            if (node._children) {
              queue.push(...node._children);
            }
          }
          return null;
        }

        async function removeIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }

        const foundSettingsComponent = findSettingsComponent();
        if (!foundSettingsComponent) {
          return { collectedPathsWhenOff: [], collectedPathsWhenOn: [], createdNoteExists: false, settingsFound: false };
        }
        // A narrowed `const` does not stay narrowed inside a function declaration below it.
        const settingsComponent = foundSettingsComponent;

        const original = { ...settingsComponent.settings };
        const pluginRegistry = app.plugins.plugins as Record<string, unknown>;
        const priorStandIn = pluginRegistry[customAttachmentLocationPluginId];

        const collectedPaths: string[] = [];
        // The stand-in exposes exactly the documented entry point and nothing else, so a call proves this
        // Plugin found it the documented way rather than by reaching into internals.
        pluginRegistry[customAttachmentLocationPluginId] = {
          collectAttachmentsInAbstractFiles(abstractFiles: CollectedAbstractFile[]): void {
            collectedPaths.push(...abstractFiles.map((abstractFile) => abstractFile.path));
          }
        };

        async function runPhase(shouldCollect: boolean): Promise<string[]> {
          collectedPaths.length = 0;

          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeSplitting = false;
            settings.shouldCollectAttachmentsWithCustomAttachmentLocationAfterSplit = shouldCollect;
          });

          await removeIfExists(ROOT_FOLDER);
          await removeIfExists(SOURCE_PATH);

          const sourceFile = await app.vault.create(SOURCE_PATH, SOURCE_CONTENT);
          const leaf = app.workspace.getLeaf(false);
          await leaf.openFile(sourceFile);
          const view: unknown = leaf.view;
          const editor = (view as LeafWithEditor).editor;
          editor.setValue(SOURCE_CONTENT);

          await waitUntil({
            message: 'metadata cache did not index the source heading',
            predicate: () => (app.metadataCache.getFileCache(sourceFile)?.headings ?? []).length === EXPECTED_HEADING_COUNT
          });
          editor.setCursor({ ch: 0, line: CURSOR_LINE });

          app.commands.executeCommandById(`${pluginId}:split-heading-recursively`);

          await waitUntil({
            message: 'the heading was not extracted into a note of its own',
            predicate: () => app.vault.getAbstractFileByPath(`${ROOT_FOLDER}/${ROOT_FOLDER}.md`) instanceof obsidianModule.TFile
          });

          // The hand-off runs right after the transaction commits, so give that turn a chance to land
          // Before reading. A miss here would show as an empty list, which is what the OFF phase expects,
          // So the ON phase asserting a non-empty list is what makes the wait meaningful.
          await waitUntil({
            message: 'the collect hand-off did not happen',
            predicate: () => !shouldCollect || collectedPaths.length > 0
          }).catch(() => undefined);

          return [...collectedPaths];
        }

        try {
          const collectedPathsWhenOn = await runPhase(true);
          const collectedPathsWhenOff = await runPhase(false);
          return {
            collectedPathsWhenOff,
            collectedPathsWhenOn,
            createdNoteExists: app.vault.getAbstractFileByPath(`${ROOT_FOLDER}/${ROOT_FOLDER}.md`) !== null,
            settingsFound: true
          };
        } finally {
          if (priorStandIn === undefined) {
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- Restoring the registry to exactly what it was.
            delete pluginRegistry[customAttachmentLocationPluginId];
          } else {
            pluginRegistry[customAttachmentLocationPluginId] = priorStandIn;
          }
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeSplitting = original.shouldAskBeforeSplitting;
            settings.shouldCollectAttachmentsWithCustomAttachmentLocationAfterSplit = original.shouldCollectAttachmentsWithCustomAttachmentLocationAfterSplit;
          });
          await removeIfExists(ROOT_FOLDER);
          await removeIfExists(SOURCE_PATH);
        }
      },
      input: {
        customAttachmentLocationPluginId: CUSTOM_ATTACHMENT_LOCATION_PLUGIN_ID,
        pluginId: PLUGIN_ID
      },
      vaultPath: getTemporaryVault().path
    });

    expect(result.settingsFound).toBe(true);
    expect(result.createdNoteExists).toBe(true);

    // On: the entry point was called with the note the extract created, not the source.
    expect(result.collectedPathsWhenOn).toStrictEqual(['SplitCollectA/SplitCollectA.md']);

    // Off: nothing was handed over at all.
    expect(result.collectedPathsWhenOff).toStrictEqual([]);
  }, 180_000);
});
