import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
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

describe('move folder to... (issue #73)', () => {
  it('moves the chosen folder into a target picked from the suggester and updates links', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        // A prior run may have moved `mv-src` under `mv-dst`; reset both trees and the linking note.
        await trashIfExists('mv-dst');
        await trashIfExists('mv-src');
        await trashIfExists('mv-link.md');

        // `mv-src` is the folder to move; `mv-dst` is the destination; `mv-link.md` links into `mv-src`.
        await app.vault.createFolder('mv-src');
        const noteInSrc = await app.vault.create('mv-src/note-in-src.md', 'inner body');
        await app.vault.createFolder('mv-dst');
        await app.vault.create('mv-dst/keep.md', 'keep body');
        await app.vault.create('mv-link.md', 'Go to [[note-in-src]].');

        // Open a note inside `mv-src` so the folder command resolves the active file's parent folder.
        await openFile(noteInSrc);
        await waitUntil({
          message: 'link cache not ready',
          predicate: () => app.metadataCache.getFirstLinkpathDest('note-in-src', 'mv-link.md')?.path === 'mv-src/note-in-src.md'
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
          throw new Error('No move-folder picker input.');
        }
        input.value = 'mv-dst';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await waitUntil({
          message: 'target folder suggestion did not appear',
          predicate: () => Array.from(document.querySelectorAll('.suggestion-item')).some((el) => el.textContent === 'mv-dst')
        });
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Enter', key: 'Enter' }));

        // The folder is moved into the destination: `mv-src` now lives under `mv-dst`.
        await waitUntil({
          message: 'folder was not moved into the destination',
          predicate: () => app.vault.getAbstractFileByPath('mv-dst/mv-src/note-in-src.md') !== null
        });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        const movedIntoTarget = app.vault.getAbstractFileByPath('mv-dst/mv-src/note-in-src.md') !== null;
        const oldLocationGone = app.vault.getAbstractFileByPath('mv-src') === null;
        // The inbound link now resolves to the folder's new location (links updated by the move).
        const linkUpdated = app.metadataCache.getFirstLinkpathDest('note-in-src', 'mv-link.md')?.path === 'mv-dst/mv-src/note-in-src.md';

        return { linkUpdated, movedIntoTarget, oldLocationGone };

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
      vaultPath: getTempVault().path
    });

    // The folder was moved into the destination folder, keeping its own name and contents.
    expect(result.movedIntoTarget).toBe(true);
    // It no longer exists at its old top-level location.
    expect(result.oldLocationGone).toBe(true);
    // The inbound link resolves to the folder's new location.
    expect(result.linkUpdated).toBe(true);
  });
});
