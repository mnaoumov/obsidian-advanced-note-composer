import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only: both flows move/delete files, matching the plugin's established integration convention.
// File-move suites can hit the documented headless rename wall when several run in one aggregate; if this
// Stalls in the aggregate, it is `it.skip`-ped and must still pass alone.
// Isolation: `npx vitest run --project integration-tests:desktop src/merge-attachments.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: MergeAttachmentSettings;
}

interface MergeAttachmentSettings {
  attachmentExtensions: string[];
  shouldAskBeforeMerging: boolean;
  shouldMoveAttachmentsWhenMergingFile: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: MergeAttachmentSettings) => void): Promise<void>;
  settings: MergeAttachmentSettings;
}

describe('attachments in a merge (issue #161)', () => {
  it('moves a markdown-shaped attachment into the destination folder instead of merging it', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = false;
            settings.attachmentExtensions = ['.excalidraw.md'];
          });

          await trashIfExists('md-attach-src');
          await trashIfExists('md-attach-dst');

          await app.vault.createFolder('md-attach-src');
          await app.vault.createFolder('md-attach-dst');
          // The destination already holds a drawing of the same name: merging the two would concatenate
          // Two raw payloads and corrupt it.
          await app.vault.create('md-attach-dst/sketch.excalidraw.md', 'destination payload');
          await app.vault.create('md-attach-src/sketch.excalidraw.md', 'source payload');
          const note = await app.vault.create('md-attach-src/note.md', 'note body');

          // Open a note inside the folder so the folder command resolves the active file's parent folder.
          await openFile(note);

          app.commands.executeCommandById(`${pluginId}:merge-folder`);
          await waitUntil({
            message: 'merge-folder picker did not open',
            predicate: () => document.querySelector('.prompt') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          await chooseFolderInPicker('md-attach-dst');

          await waitUntil({
            message: 'the note was not merged into the destination folder',
            predicate: () => app.vault.getAbstractFileByPath('md-attach-dst/note.md') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const movedDrawing = app.vault.getAbstractFileByPath('md-attach-dst/sketch.excalidraw 1.md');
          const destinationDrawing = app.vault.getAbstractFileByPath('md-attach-dst/sketch.excalidraw.md');

          return {
            destinationPayload: destinationDrawing instanceof obsidianModule.TFile ? await app.vault.read(destinationDrawing) : '',
            movedPayload: movedDrawing instanceof obsidianModule.TFile ? await app.vault.read(movedDrawing) : '',
            sourceDrawingGone: app.vault.getAbstractFileByPath('md-attach-src/sketch.excalidraw.md') === null
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = original.shouldAskBeforeMerging;
            settings.attachmentExtensions = original.attachmentExtensions;
          });
        }

        async function chooseFolderInPicker(folderPath: string): Promise<void> {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new Error('No merge-folder picker input.');
          }
          input.value = folderPath;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: 'target folder suggestion did not appear',
            predicate: () => Array.from(document.querySelectorAll('.suggestion-item')).some((el) => el.textContent === folderPath)
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
          return typeof node.editAndSave === 'function' && typeof node.settings?.shouldMoveAttachmentsWhenMergingFile === 'boolean';
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

    // The drawing was moved (de-duplicated), not merged: both payloads survive intact.
    expect(result.sourceDrawingGone).toBe(true);
    expect(result.destinationPayload).toBe('destination payload');
    expect(result.movedPayload).toBe('source payload');
  });

  it('moves the attachments a merged note owns into the destination note\'s attachment folder', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        const originalAttachmentFolderPath = app.vault.getConfig('attachmentFolderPath');
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = false;
            settings.shouldMoveAttachmentsWhenMergingFile = true;
          });
          // Attachments live beside their note, so a merge into a note in another folder has to move them.
          app.vault.setConfig('attachmentFolderPath', './');

          await trashIfExists('file-attach-src');
          await trashIfExists('file-attach-dst');

          await app.vault.createFolder('file-attach-src');
          await app.vault.createFolder('file-attach-dst');
          await app.vault.createBinary('file-attach-src/pic.png', new ArrayBuffer(4));
          await app.vault.createBinary('file-attach-src/shared.png', new ArrayBuffer(4));
          await app.vault.create('file-attach-src/keeper.md', '![[shared.png]]');
          await app.vault.create('file-attach-dst/file-attach-target.md', 'target body');
          const source = await app.vault.create('file-attach-src/file-attach-source.md', '![[pic.png]]\n![[shared.png]]\nsource body');

          await openFile(source);
          await waitUntil({
            message: 'embed cache not ready',
            predicate: () => (app.metadataCache.getFileCache(source)?.embeds ?? []).length === 2
          });

          app.commands.executeCommandById(`${pluginId}:merge-file`);
          await waitUntil({
            message: 'merge-file picker did not open',
            predicate: () => document.querySelector('.prompt') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          await chooseInPicker('file-attach-target');

          await waitUntil({
            message: 'the source note was not merged away',
            predicate: () => app.vault.getAbstractFileByPath('file-attach-src/file-attach-source.md') === null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const merged = app.vault.getAbstractFileByPath('file-attach-dst/file-attach-target.md');
          const mergedContent = merged instanceof obsidianModule.TFile ? await app.vault.read(merged) : '';

          return {
            // The attachment only this note referenced followed it.
            picMoved: app.vault.getAbstractFileByPath('file-attach-dst/pic.png') !== null,
            picSourceGone: app.vault.getAbstractFileByPath('file-attach-src/pic.png') === null,
            // The embed in the merged content points at the new location.
            resolvesEmbed: mergedContent.includes('pic.png'),
            // The attachment another note also references stayed put.
            sharedStayed: app.vault.getAbstractFileByPath('file-attach-src/shared.png') !== null
          };
        } finally {
          app.vault.setConfig('attachmentFolderPath', originalAttachmentFolderPath);
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = original.shouldAskBeforeMerging;
            settings.shouldMoveAttachmentsWhenMergingFile = original.shouldMoveAttachmentsWhenMergingFile;
          });
        }

        async function chooseInPicker(basename: string): Promise<void> {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new Error('No merge picker input.');
          }
          input.value = basename;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: 'target note suggestion did not appear',
            predicate: () => Array.from(document.querySelectorAll('.suggestion-title')).some((el) => el.textContent.includes(basename))
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
          return typeof node.editAndSave === 'function' && typeof node.settings?.shouldMoveAttachmentsWhenMergingFile === 'boolean';
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

    expect(result.picMoved).toBe(true);
    expect(result.picSourceGone).toBe(true);
    expect(result.resolvesEmbed).toBe(true);
    // A shared attachment belongs to no single note, so it is left where it is.
    expect(result.sharedStayed).toBe(true);
  });
});
