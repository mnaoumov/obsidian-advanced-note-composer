import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only: this is a file/folder-move flow driven through the real folder-picker suggester DOM.
// It runs desktop-only, matching the plugin's established integration convention (no Android emulator
// Wired for it). File-move suites can hit the documented headless rename wall
// (`renameFile`/`metadataCache.onCleanCache`) when several run in one aggregate; if this stalls in the
// Aggregate, it is `it.skip`-ped and must still pass alone.
// Isolation: `npx vitest run --project integration-tests:desktop src/move-folder.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: MoveSettings;
}

interface MoveSettings {
  shouldAskBeforeMovingFolder: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: MoveSettings) => void): Promise<void>;
  settings: MoveSettings;
}

describe('move folder to... (issue #73)', () => {
  it('moves the chosen folder into a target picked from the suggester and updates links', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const settingsComponent = findSettingsComponent();
        const isOriginalShouldAsk = settingsComponent.settings.shouldAskBeforeMovingFolder;
        try {
          // Skip the confirmation dialog (issue #154, on by default) so the move runs straight from the
          // Picker; the dialog itself is covered by `folder-confirm.desktop.integration.test.ts`.
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMovingFolder = false;
          });

          // A prior run may have moved `mv-src` under `mv-dst`; reset both trees and the linking note.
          await trashIfExists('mv-dst');
          await trashIfExists('mv-src');
          await trashIfExists('mv-link.md');

          // `mv-src` is the folder to move; `mv-dst` is the destination; `mv-link.md` links into `mv-src`.
          // The note's basename is prefixed for THIS suite: the link below is unqualified, so it resolves by
          // Basename across the whole vault the aggregate shares - and a leftover note of the same name from
          // Another suite (`recent-target-order` moves one, and this file's own second test creates one) makes
          // The resolution ambiguous, which is decided by cache order rather than by the move under test.
          await app.vault.createFolder('mv-src');
          const noteInSrc = await app.vault.create('mv-src/mv-note.md', 'inner body');
          await app.vault.createFolder('mv-dst');
          await app.vault.create('mv-dst/keep.md', 'keep body');
          await app.vault.create('mv-link.md', 'Go to [[mv-note]].');

          // Open a note inside `mv-src` so the folder command resolves the active file's parent folder.
          await openFile(noteInSrc);
          await waitUntil({
            message: 'link cache not ready',
            predicate: () => app.metadataCache.getFirstLinkpathDest('mv-note', 'mv-link.md')?.path === 'mv-src/mv-note.md'
          });

          app.commands.executeCommandById(`${pluginId}:move-folder`);
          await waitUntil({
            message: 'move-folder picker did not open',
            predicate: () => document.querySelector('.prompt') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // Pick the destination folder through the real fuzzy suggester DOM.
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No move-folder picker input.');
          }
          input.value = 'mv-dst';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: 'target folder suggestion did not appear',
            predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent === 'mv-dst')
          });
          input.focus();
          await pressKey({ key: 'Enter' });

          // The folder is moved into the destination: `mv-src` now lives under `mv-dst`.
          await waitUntil({
            message: 'folder was not moved into the destination',
            predicate: () => app.vault.getAbstractFileByPath('mv-dst/mv-src/mv-note.md') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const isMovedIntoTarget = app.vault.getAbstractFileByPath('mv-dst/mv-src/mv-note.md') !== null;
          const isOldLocationGone = app.vault.getAbstractFileByPath('mv-src') === null;
          // The inbound link now resolves to the folder's new location (links updated by the move). Reported
          // As the resolved PATH rather than as a boolean, so a failure names what it resolved to instead of
          // Just `expected false to be true`.
          const linkDestinationPath = app.metadataCache.getFirstLinkpathDest('mv-note', 'mv-link.md')?.path ?? null;

          return { linkDestinationPath, movedIntoTarget: isMovedIntoTarget, oldLocationGone: isOldLocationGone };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMovingFolder = isOriginalShouldAsk;
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
          return typeof node.editAndSave === 'function' && typeof node.settings?.shouldAskBeforeMovingFolder === 'boolean';
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }

        async function openFile(file: TFile): Promise<void> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
          });
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The folder was moved into the destination folder, keeping its own name and contents.
    expect(result.movedIntoTarget).toBe(true);
    // It no longer exists at its old top-level location.
    expect(result.oldLocationGone).toBe(true);
    // The inbound link resolves to the folder's new location.
    expect(result.linkDestinationPath).toBe('mv-dst/mv-src/mv-note.md');
  });

  it('front-loads the recently-opened folders in the picker, in recent order (issue #149)', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        await trashIfExists('rf-src');
        await trashIfExists('rf-recent');
        await trashIfExists('rf-older');

        // `rf-src` is the folder to move (its active note is the source, so `rf-src` itself is never an
        // Offered target); `rf-older` and `rf-recent` hold notes we open in that order, so their folders
        // Become recently-opened valid targets, `rf-recent` being the more recent of the two.
        await app.vault.createFolder('rf-src');
        const noteInSrc = await app.vault.create('rf-src/note-in-src.md', 'src body');
        await app.vault.createFolder('rf-recent');
        const noteInRecent = await app.vault.create('rf-recent/note-in-recent.md', 'recent body');
        await app.vault.createFolder('rf-older');
        const noteInOlder = await app.vault.create('rf-older/note-in-older.md', 'older body');

        await openFile(noteInOlder);
        await openFile(noteInRecent);
        await openFile(noteInSrc);

        app.commands.executeCommandById(`${pluginId}:move-folder`);
        await waitUntil({
          message: 'move-folder picker did not open',
          predicate: () => document.querySelector('.suggestion-item') !== null
        });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        const suggestions = [...document.querySelectorAll('.suggestion-item')].map((el) => el.textContent);

        // Close the picker without moving anything (this test only checks ordering).
        const input = document.querySelector('.prompt-input');
        if (input instanceof HTMLInputElement) {
          input.focus();
          await pressKey({ key: 'Escape' });
        }

        // The expectations are stated outright, NOT derived from `getRecentFiles()` the way the
        // Production code does — deriving them made this test pass under ANY ordering (issue #158).
        return {
          olderIndex: suggestions.indexOf('rf-older'),
          recentIndex: suggestions.indexOf('rf-recent')
        };

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
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The picker front-loads the recently-opened folders, most-recent-first. `rf-src` holds the active
    // Note but is the folder being moved, so it is not an offered target and the folder of the note we
    // Were on just before it — `rf-recent` — comes ahead of the earlier `rf-older`. (Other folders
    // Visited by the previous test in this file can sit between them, hence the index compare.)
    // The claim is relative rather than "`rf-recent` is suggestion #0": since issue #206 the folders a
    // Completed operation targeted rank above every recently-opened one, and the move this file's first
    // Test performs records one — which says nothing about the recent-order behavior under test here.
    // Issue #206's own ordering is pinned by `recent-target-order.desktop.integration.test.ts`.
    expect(result.recentIndex).toBeGreaterThan(-1);
    expect(result.recentIndex).toBeLessThan(result.olderIndex);
    expect(result.olderIndex).toBeGreaterThan(-1);
  });
});
