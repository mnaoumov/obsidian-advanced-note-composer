import type {
  Editor,
  TFile
} from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

const PLUGIN_ID = 'advanced-note-composer';

describe('unlock active note', () => {
  it('should cancel a pending mark: release the source-note lock, drop the mark, and hide the notice', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const SETTLE_IN_MILLISECONDS = 400;
        const NOTICE_REMOVAL_IN_MILLISECONDS = 700;

        // Mark "BBB" in the source note. This holds a mutation-blocking lock on the source note and
        // Shows the permanent "Smart cut & paste" notice while the mark is pending.
        const source = await resetFile('unlock-it.md', 'AAA BBB CCC');
        const sourceEditor = await openAndGetEditor(source);
        sourceEditor.setSelection(sourceEditor.offsetToPos(4), sourceEditor.offsetToPos(7));
        app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
        await sleep(SETTLE_IN_MILLISECONDS);

        const markNoticePresentWhileMarked = findMarkNotice() !== null;
        const highlightPresentWhileMarked = activeDocument.querySelectorAll('.advanced-note-composer-pending-selection').length > 0;

        // While marked, the source note's mutations are blocked: a direct vault write throws.
        const mutationBlockedWhileMarked = await isVaultModifyBlocked(source, 'blocked while marked');

        // Run the built-in "Unlock active note" command against the (active, locked) source note.
        const unlockCommandRan = app.commands.executeCommandById(`${pluginId}:unlock-active-note`);
        await sleep(SETTLE_IN_MILLISECONDS);
        await sleep(NOTICE_REMOVAL_IN_MILLISECONDS);

        // The unlock cancels the whole pending move: the mark notice and highlight are gone...
        const markNoticeGoneAfterUnlock = findMarkNotice() === null;
        const highlightGoneAfterUnlock = activeDocument.querySelectorAll('.advanced-note-composer-pending-selection').length === 0;

        // ...and the lock is genuinely released — the previously-blocked vault write now succeeds.
        const mutationAllowedAfterUnlock = !(await isVaultModifyBlocked(source, 'unlocked'));

        return {
          highlightGoneAfterUnlock,
          highlightPresentWhileMarked,
          markNoticeGoneAfterUnlock,
          markNoticePresentWhileMarked,
          mutationAllowedAfterUnlock,
          mutationBlockedWhileMarked,
          unlockCommandRan
        };

        function findMarkNotice(): Element | null {
          for (const el of Array.from(activeDocument.querySelectorAll('.notice'))) {
            if (el.textContent.includes('Smart cut & paste')) {
              return el;
            }
          }
          return null;
        }

        async function isVaultModifyBlocked(file: TFile, content: string): Promise<boolean> {
          try {
            await app.vault.modify(file, content);
            return false;
          } catch {
            return true;
          }
        }

        async function resetFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          return app.vault.create(path, content);
        }

        async function openAndGetEditor(file: TFile): Promise<Editor> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({ predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor !== undefined });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          return view.editor;
        }
      },
      vaultPath: getTempVault().path
    });

    // The mark is shown and the source note is locked (mutations blocked) while the mark is pending.
    expect(result.markNoticePresentWhileMarked).toBe(true);
    expect(result.highlightPresentWhileMarked).toBe(true);
    expect(result.mutationBlockedWhileMarked).toBe(true);

    // "Unlock active note" was available and ran, cancelling the whole move.
    expect(result.unlockCommandRan).toBe(true);
    expect(result.markNoticeGoneAfterUnlock).toBe(true);
    expect(result.highlightGoneAfterUnlock).toBe(true);

    // The lock was genuinely released — the write that was blocked while marked now succeeds.
    expect(result.mutationAllowedAfterUnlock).toBe(true);
  });
});
