import type { Editor } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

/*
 * End-to-end coverage for issue #246: with
 * `shouldCollectAttachmentsWithCustomAttachmentLocationAfterSplit` on, an extract hands its destination
 * note to the Custom Attachment Location plugin so that plugin collects the note's attachments.
 *
 * That plugin is not installed in this vault, and installing it to test this would be testing IT rather
 * than the hand-off. So a stand-in API is published under its id in the `obsidian-dev-utils` plugin registry
 * - the wire-level path that library's Plugin API protocol guide freezes - and the test asserts what this
 * plugin is responsible for: that it finds the API the way a consumer does, calls `collectAttachments`, passes
 * the note the extract actually created, and does none of it when the setting is off.
 *
 * Desktop-only, matching the sibling attachment suites.
 * Isolation: `npx vitest run --project integration-tests:desktop src/split-collect-attachments.desktop.integration.test.ts`.
 */

const PLUGIN_ID = 'advanced-note-composer';
const CUSTOM_ATTACHMENT_LOCATION_PLUGIN_ID = 'obsidian-custom-attachment-location';

interface CollectAttachmentsParamsLike {
  readonly pathsOrFiles: readonly (CollectedAbstractFile | string)[];
}

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

interface ObsidianDevUtilsStateLike {
  pluginApiRegistry?: PluginApiRegistryWrapperLike;
}

/**
 * The slice of the `obsidian-dev-utils` cross-plugin registry the stand-in is published into.
 */
interface PluginApiRegistryHostLike {
  __obsidianDevUtils?: ObsidianDevUtilsStateLike;
}

interface PluginApiRegistryLike {
  records?: Record<string, PublishedPluginApiRecordLike[]>;
  subscribers?: (() => void)[];
}

interface PluginApiRegistryWrapperLike {
  value?: PluginApiRegistryLike;
}

interface ProbeResult {
  readonly collectedPathsWhenOff: readonly string[];
  readonly collectedPathsWhenOn: readonly string[];
  readonly createdNoteExists: boolean;
  readonly settingsFound: boolean;
}

interface PublishedPluginApiRecordLike {
  api: object;
  apiVersion: string;
  contract: Record<string, object>;
  isRevoked: boolean;
  pluginId: string;
}

interface SettingsCarrier {
  editAndSave: (editor: (settings: CollectAttachmentsSettings) => void) => Promise<void>;
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
        /**
         * Sized so the SUM of every wait this closure declares stays under the transport's ~30 s per-closure
         * cap, not at it. Before this shared budget it declared 30 000 ms, so the eval could only ever die
         * as a bare transport timeout - which names the harness rather than the wait that overran. Every step
         * waited for here settles in well under a second on a healthy machine. A helper that waits is charged
         * once per CALL SITE, so adding a call to one adds a whole ceiling: re-divide this budget by the new
         * count, not by the `waitUntil` calls the body shows.
         */
        const WAIT_TIMEOUT_IN_MILLISECONDS = 2500;
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
        const host = window as PluginApiRegistryHostLike;
        host.__obsidianDevUtils ??= {};
        host.__obsidianDevUtils.pluginApiRegistry ??= {};
        const registryWrapper = host.__obsidianDevUtils.pluginApiRegistry;
        registryWrapper.value ??= {};
        const registry = registryWrapper.value;
        registry.records ??= {};
        const records = registry.records;

        const collectedPaths: string[] = [];
        // The stand-in publishes exactly the documented member under the contract version that introduced it,
        // so a call proves this plugin found it through the registry rather than by reaching into internals.
        const standInRecord: PublishedPluginApiRecordLike = {
          api: {
            // Synchronous on purpose: the closure cannot import `noopAsync`, and `await` on a plain value is what
            // the real promise would amount to here, since the stand-in has nothing to wait for.
            collectAttachments(params: CollectAttachmentsParamsLike): void {
              collectedPaths.push(...params.pathsOrFiles.map((pathOrFile) => typeof pathOrFile === 'string' ? pathOrFile : pathOrFile.path));
            }
          },
          apiVersion: '1.2.0',
          contract: { collectAttachments: {} },
          isRevoked: false,
          pluginId: customAttachmentLocationPluginId
        };
        records[customAttachmentLocationPluginId] = [...(records[customAttachmentLocationPluginId] ?? []), standInRecord];

        function notifyRegistrySubscribers(): void {
          for (const subscriber of registry.subscribers ?? []) {
            subscriber();
          }
        }
        notifyRegistrySubscribers();

        // A function rather than inline in the `finally`, whose earlier `await`s would otherwise make the
        // revocation look like a stale write.
        function revokeStandIn(): void {
          standInRecord.isRevoked = true;
          records[customAttachmentLocationPluginId] = (records[customAttachmentLocationPluginId] ?? []).filter((record) => record !== standInRecord);
          notifyRegistrySubscribers();
        }

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
            predicate: () => (app.metadataCache.getFileCache(sourceFile)?.headings ?? []).length === EXPECTED_HEADING_COUNT,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          editor.setCursor({ ch: 0, line: CURSOR_LINE });

          app.commands.executeCommandById(`${pluginId}:split-heading-recursively`);

          await waitUntil({
            message: 'the heading was not extracted into a note of its own',
            predicate: () => app.vault.getAbstractFileByPath(`${ROOT_FOLDER}/${ROOT_FOLDER}.md`) instanceof obsidianModule.TFile,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          // The hand-off runs right after the transaction commits, so give that turn a chance to land
          // before reading. A miss here would show as an empty list, which is what the OFF phase expects,
          // so the ON phase asserting a non-empty list is what makes the wait meaningful.
          await waitUntil({
            message: 'the collect hand-off did not happen',
            predicate: () => !shouldCollect || collectedPaths.length > 0,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
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
          // Revoked and dropped, as `publishPluginApi` does when its provider unloads.
          revokeStandIn();
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

    // On: `collectAttachments` was called with the note the extract created, not the source.
    expect(result.collectedPathsWhenOn).toStrictEqual(['SplitCollectA/SplitCollectA.md']);

    // Off: nothing was handed over at all.
    expect(result.collectedPathsWhenOff).toStrictEqual([]);
  }, 180_000);
});
