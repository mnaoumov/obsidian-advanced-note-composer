import type {
  TFile,
  TFolder
} from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only: a folder-contents merge (file-move/delete) flow, matching the plugin's established convention.
// Isolation: `npx vitest run --project integration-tests:desktop src/merge-folder-into-file-attachment-unit.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';
const PLUGIN_NAME = 'Advanced Note Composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: MergeSettings;
}

interface MenuItemLike {
  dom?: HTMLElement;
  section?: string;
}

interface MenuLike {
  hide: () => void;
  items: MenuItemLike[];
}

interface MergeSettings {
  emptyFolderBehaviorAfterMergingFolder: string;
  shouldAskBeforeMerging: boolean;
  shouldMoveAttachmentsWhenMergingFolder: boolean;
}

interface SettingsCarrier {
  editAndSave: (editor: (settings: MergeSettings) => void) => Promise<void>;
  settings: MergeSettings;
}

/**
 * Issue #298: an attachment unit folder — one an attachment-location plugin designated to travel as ONE
 * attachment — must never be merged into the single file. The designation is published the way Custom
 * Attachment Location publishes it, as a member on the patched `Vault.getAvailablePathForAttachments`, so
 * this proves the plugin reads it from real Obsidian rather than from anything local.
 */
describe('merge folder into file with an attachment unit folder (issue #298)', () => {
  it('hides the entry inside a unit and moves a referenced unit whole', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId, pluginName }) {
        // Four waits share the 30 s transport cap, so each is given a ceiling well under a quarter of it.
        const WAIT_TIMEOUT_IN_MILLISECONDS = 6000;
        const UNIT_FOLDER_PATH = 'unit298-src/unit298-page_files';

        const settingsComponent = findSettingsComponent();
        const originalSettings = {
          emptyFolderBehaviorAfterMergingFolder: settingsComponent.settings.emptyFolderBehaviorAfterMergingFolder,
          shouldAskBeforeMerging: settingsComponent.settings.shouldAskBeforeMerging,
          shouldMoveAttachmentsWhenMergingFolder: settingsComponent.settings.shouldMoveAttachmentsWhenMergingFolder
        };
        const originalAttachmentFolderPath = app.vault.getConfig('attachmentFolderPath');
        const originalGetAvailablePathForAttachments = app.vault.getAvailablePathForAttachments;
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.emptyFolderBehaviorAfterMergingFolder = 'Delete';
            settings.shouldAskBeforeMerging = false;
            settings.shouldMoveAttachmentsWhenMergingFolder = true;
          });
          app.vault.setConfig('attachmentFolderPath', '/');
          // Wrapped rather than replaced, keeping whatever members are already there.
          app.vault.getAvailablePathForAttachments = Object.assign(
            (...callArguments: Parameters<typeof originalGetAvailablePathForAttachments>) => originalGetAvailablePathForAttachments.apply(app.vault, callArguments),
            originalGetAvailablePathForAttachments,
            {
              checkIsAttachmentUnitFolder: (folderPath: string): boolean => folderPath === UNIT_FOLDER_PATH || folderPath.startsWith(`${UNIT_FOLDER_PATH}/`)
            }
          );

          await app.vault.createFolder('unit298-src');
          await app.vault.createFolder(UNIT_FOLDER_PATH);
          await app.vault.createFolder(`${UNIT_FOLDER_PATH}/deep`);
          await app.vault.createBinary(`${UNIT_FOLDER_PATH}/img.png`, new ArrayBuffer(4));
          await app.vault.create(`${UNIT_FOLDER_PATH}/deep/style.css`, 'CSS');
          await app.vault.create(`${UNIT_FOLDER_PATH}/page.md`, 'unit body');
          await app.vault.create('unit298-src/unit298-zz.md', 'zz body');
          const zeta = await app.vault.create('unit298-src/unit298-zeta.md', `zeta body ![[${UNIT_FOLDER_PATH}/img.png]]`);

          const hasEntryOnUnit = hasMergeFolderIntoFileItem(getFolder(UNIT_FOLDER_PATH));
          const hasEntryInsideUnit = hasMergeFolderIntoFileItem(getFolder(`${UNIT_FOLDER_PATH}/deep`));
          const hasEntryOnHolder = hasMergeFolderIntoFileItem(getFolder('unit298-src'));

          await app.workspace.getLeaf(false).openFile(zeta);
          await waitUntil({
            message: 'the embed into the unit was not resolved',
            predicate: () => Object.keys(app.metadataCache.resolvedLinks[zeta.path] ?? {}).includes(`${UNIT_FOLDER_PATH}/img.png`),
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await waitUntil({
            message: `editor for ${zeta.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === zeta.path,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          app.commands.executeCommandById(`${pluginId}:merge-folder-into-file`);

          // The LAST thing the merge does is remove the emptied folders, so that is what is waited on.
          await waitUntil({
            message: 'the merge did not finish',
            predicate: () => app.vault.getAbstractFileByPath('unit298-src.md') !== null && app.vault.getAbstractFileByPath('unit298-src') === null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          return {
            hasEntryInsideUnit,
            hasEntryOnHolder,
            hasEntryOnUnit,
            isImageLoose: app.vault.getAbstractFileByPath('img.png') !== null,
            mergedContent: await app.vault.read(getFile('unit298-src.md')),
            movedUnitChildren: ['unit298-page_files/img.png', 'unit298-page_files/deep/style.css', 'unit298-page_files/page.md']
              .filter((path) => app.vault.getAbstractFileByPath(path) !== null),
            unitPageContent: await app.vault.read(getFile('unit298-page_files/page.md'))
          };
        } finally {
          restoreGetAvailablePathForAttachments();
          app.vault.setConfig('attachmentFolderPath', originalAttachmentFolderPath);
          await settingsComponent.editAndSave((settings) => {
            settings.emptyFolderBehaviorAfterMergingFolder = originalSettings.emptyFolderBehaviorAfterMergingFolder;
            settings.shouldAskBeforeMerging = originalSettings.shouldAskBeforeMerging;
            settings.shouldMoveAttachmentsWhenMergingFolder = originalSettings.shouldMoveAttachmentsWhenMergingFolder;
          });
        }

        // Restored from a synchronous function, so the restore cannot be read as racing the awaits around it.
        function restoreGetAvailablePathForAttachments(): void {
          app.vault.getAvailablePathForAttachments = originalGetAvailablePathForAttachments;
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

        function getFile(path: string): TFile {
          const file = app.vault.getFileByPath(path);
          if (!file) {
            throw new Error(`${path} does not exist.`);
          }
          return file;
        }

        function getFolder(path: string): TFolder {
          const folder = app.vault.getFolderByPath(path);
          if (!folder) {
            throw new Error(`${path} was not created.`);
          }
          return folder;
        }

        function hasMergeFolderIntoFileItem(targetFolder: TFolder): boolean {
          const menu = new obsidianModule.Menu();
          app.workspace.trigger('file-menu', menu, targetFolder, 'file-explorer-context-menu');
          const sectionText = (menu as MenuLike).items
            .filter((item) => item.section === pluginName)
            .map((item) => item.dom?.textContent ?? '')
            .join('\n');
          (menu as MenuLike).hide();
          return sectionText.includes('Merge folder contents into a single file...');
        }

        function isSettingsComponent(node: ComponentTreeNode): node is SettingsCarrier {
          return typeof node.editAndSave === 'function' && typeof node.settings?.shouldMoveAttachmentsWhenMergingFolder === 'boolean';
        }
      },
      input: { pluginId: PLUGIN_ID, pluginName: PLUGIN_NAME },
      vaultPath: getTemporaryVault().path
    });

    expect(result.hasEntryOnUnit).toBe(false);
    expect(result.hasEntryInsideUnit).toBe(false);
    expect(result.hasEntryOnHolder).toBe(true);
    // The unit moved whole into the merged note's attachment folder (the vault root), shape intact.
    expect(result.movedUnitChildren).toEqual(['unit298-page_files/img.png', 'unit298-page_files/deep/style.css', 'unit298-page_files/page.md']);
    expect(result.isImageLoose).toBe(false);
    // The note inside the unit is part of the attachment: never merged, still whole.
    expect(result.unitPageContent).toBe('unit body');
    expect(result.mergedContent).toContain('zeta body');
    expect(result.mergedContent).toContain('zz body');
    expect(result.mergedContent).not.toContain('unit body');
  });
});
