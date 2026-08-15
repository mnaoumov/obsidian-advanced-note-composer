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

// Desktop-only: the flow moves files, matching the plugin's established integration convention and the
// Merge-side counterpart (`merge-attachments.desktop.integration.test.ts`). File-move suites can hit the
// Documented headless rename wall when several run in one aggregate; if this stalls in the aggregate it is
// `it.skip`-ped and must still pass alone.
// Isolation: `npx vitest run --project integration-tests:desktop src/split-attachments.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: SplitAttachmentSettings;
}

interface SplitAttachmentSettings {
  shouldAskBeforeSplitting: boolean;
  shouldMoveAttachmentsWhenSplitting: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: SplitAttachmentSettings) => void): Promise<void>;
  settings: SplitAttachmentSettings;
}

describe('attachments in a split (issue #239)', () => {
  it('carries a heading\'s own attachment into the note it creates, leaving a shared one behind', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const SOURCE_PATH = 'split-attach-source.md';
        const ROOT_FOLDER = 'SplitAttachA';
        /*
         * `SplitAttachA` is the heading being extracted and `split-attach-pic.png` is referenced only by it,
         * so it is the one that has to travel. `split-attach-shared.png` is referenced from `SplitAttachB`,
         * which stays in the source note — the sole-referencer rule is what must leave it where it is.
         */
        const SOURCE_CONTENT = [
          'Intro text',
          '',
          '## SplitAttachA',
          '',
          '![[split-attach-pic.png]]',
          '',
          '## SplitAttachB',
          '',
          '![[split-attach-shared.png]]',
          ''
        ].join('\n');
        // Inside `SplitAttachA`'s body, not on its `#` line — the enclosing heading is what the command
        // Resolves (issue #143).
        const CURSOR_LINE = 4;
        const EXPECTED_HEADING_COUNT = 2;
        const EXPECTED_EMBED_COUNT = 2;

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        const originalAttachmentFolderPath = app.vault.getConfig('attachmentFolderPath');
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeSplitting = false;
            settings.shouldMoveAttachmentsWhenSplitting = true;
          });
          // Attachments live beside their note, so a heading extracted into a folder of its own has an
          // Attachment folder of its own — without this the destination resolves to where they already are.
          app.vault.setConfig('attachmentFolderPath', './');

          // Clean up any leftover from a previous run, so no folder or file name is de-duplicated.
          await removeIfExists(ROOT_FOLDER);
          await removeIfExists('split-attach-pic.png');
          await removeIfExists('split-attach-shared.png');

          await app.vault.createBinary('split-attach-pic.png', new ArrayBuffer(4));
          await app.vault.createBinary('split-attach-shared.png', new ArrayBuffer(4));

          const sourceFile = await resetFile(SOURCE_PATH);
          const editor = await openAndGetEditor(sourceFile);
          // Through the editor, not `vault.modify`: an already-open buffer left over from a previous run
          // Would otherwise keep the stale text and the cursor line would land in the wrong section.
          editor.setValue(SOURCE_CONTENT);
          await waitUntil({
            message: 'metadata cache did not index the source headings and embeds',
            predicate: () => {
              const cache = app.metadataCache.getFileCache(sourceFile);
              return (cache?.headings ?? []).length === EXPECTED_HEADING_COUNT
                && (cache?.embeds ?? []).length === EXPECTED_EMBED_COUNT;
            }
          });
          editor.setCursor({ ch: 0, line: CURSOR_LINE });

          app.commands.executeCommandById(`${pluginId}:split-heading-recursively`);

          await waitUntil({
            message: 'the heading was not extracted into a note of its own',
            predicate: () => app.vault.getAbstractFileByPath(`${ROOT_FOLDER}/${ROOT_FOLDER}.md`) instanceof obsidianModule.TFile
          });
          await waitUntil({
            message: 'the heading\'s attachment did not follow it',
            predicate: () => app.vault.getAbstractFileByPath(`${ROOT_FOLDER}/split-attach-pic.png`) !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const createdFile = app.vault.getAbstractFileByPath(`${ROOT_FOLDER}/${ROOT_FOLDER}.md`);
          const createdContent = createdFile instanceof obsidianModule.TFile ? await app.vault.read(createdFile) : '';

          return {
            createdContent,
            // The attachment only the extracted heading referenced is gone from where it was.
            picSourceGone: app.vault.getAbstractFileByPath('split-attach-pic.png') === null,
            // The attachment the text left behind still references never moved.
            sharedMoved: app.vault.getAbstractFileByPath(`${ROOT_FOLDER}/split-attach-shared.png`) !== null,
            sharedStayed: app.vault.getAbstractFileByPath('split-attach-shared.png') !== null,
            sourceContent: await app.vault.read(sourceFile)
          };
        } finally {
          app.vault.setConfig('attachmentFolderPath', originalAttachmentFolderPath);
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeSplitting = original.shouldAskBeforeSplitting;
            settings.shouldMoveAttachmentsWhenSplitting = original.shouldMoveAttachmentsWhenSplitting;
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
          return typeof node.editAndSave === 'function' && typeof node.settings?.shouldMoveAttachmentsWhenSplitting === 'boolean';
        }

        async function openAndGetEditor(file: TFile): Promise<Editor> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: 'markdown editor did not open',
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor !== undefined
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          return view.editor;
        }

        async function removeIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }

        async function resetFile(path: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            return existing;
          }
          return app.vault.create(path, '');
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // What issue #239 asked for: the attachment the extracted heading referenced sits in the created note's
    // Own attachment folder, and the note still points at it.
    expect(result.picSourceGone).toBe(true);
    expect(result.createdContent).toContain('split-attach-pic.png');
    expect(result.createdContent).toContain('SplitAttachA');

    // The other half, and the reason the setting can default to on: an attachment the note left behind still
    // References is not dragged away from it.
    expect(result.sharedStayed).toBe(true);
    expect(result.sharedMoved).toBe(false);
    expect(result.sourceContent).toContain('split-attach-shared.png');
  });
});
