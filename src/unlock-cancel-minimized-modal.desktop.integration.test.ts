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

describe('cancel a pending extract from the minimized modal bar', () => {
  it('should cancel the extract and release the source lock when the minimized bar Cancel button is clicked', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const SETTLE_IN_MILLISECONDS = 400;

        // Start an `Extract current selection...` on the source note. `prepareForSplitFile` acquires a
        // Lock on the source note (making its editor read-only and showing the lock indicator) and opens
        // The minimizable split picker. This reproduces issue #130: an extract whose modal is minimized.
        const source = await resetFile('cancel-it.md', 'AAA BBB CCC');
        const sourceEditor = await openAndGetEditor(source);
        sourceEditor.setSelection(sourceEditor.offsetToPos(4), sourceEditor.offsetToPos(7));
        app.commands.executeCommandById(`${pluginId}:extract-current-selection`);
        await sleep(SETTLE_IN_MILLISECONDS);

        // The split picker opened (it is minimizable) and the source note is locked.
        const minimizeButtonEl = activeDocument.querySelector<HTMLElement>('.minimize-button');
        const pickerMinimizable = minimizeButtonEl !== null;
        const lockedWhilePickerOpen = countLockIndicators() > 0;

        // Minimize the picker → a floating bar appears with a Cancel button (the #130 ask).
        minimizeButtonEl?.click();
        await sleep(SETTLE_IN_MILLISECONDS);

        const barEl = activeDocument.querySelector('.minimized-modal-bar');
        const barPresentAfterMinimize = barEl !== null;
        const cancelButtonEl = barEl?.querySelector<HTMLElement>('button.cancel-button') ?? null;
        const cancelButtonPresentOnBar = cancelButtonEl !== null;

        // Click the bar's Cancel button → the modal closes, cancelling the extract and releasing the lock.
        cancelButtonEl?.click();
        await sleep(SETTLE_IN_MILLISECONDS);

        const barGoneAfterCancel = activeDocument.querySelector('.minimized-modal-bar') === null;
        const minimizeButtonGoneAfterCancel = activeDocument.querySelector('.minimize-button') === null;
        const unlockedAfterCancel = countLockIndicators() === 0;

        return {
          barGoneAfterCancel,
          barPresentAfterMinimize,
          cancelButtonPresentOnBar,
          lockedWhilePickerOpen,
          minimizeButtonGoneAfterCancel,
          pickerMinimizable,
          unlockedAfterCancel
        };

        function countLockIndicators(): number {
          return activeDocument.querySelectorAll('.obsidian-dev-utils-lock-indicator').length;
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

        async function resetFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          return app.vault.create(path, content);
        }
      },
      vaultPath: getTempVault().path
    });

    // The extract picker opened and is minimizable, and the source note is locked while it is open.
    expect(result.pickerMinimizable).toBe(true);
    expect(result.lockedWhilePickerOpen).toBe(true);

    // Minimizing shows the floating bar, and the bar carries a Cancel button (the #130 ask).
    expect(result.barPresentAfterMinimize).toBe(true);
    expect(result.cancelButtonPresentOnBar).toBe(true);

    // Clicking the bar's Cancel button closes the modal, cancelling the extract...
    expect(result.barGoneAfterCancel).toBe(true);
    expect(result.minimizeButtonGoneAfterCancel).toBe(true);

    // ...and releasing the source lock (the lock indicator is gone).
    expect(result.unlockedAfterCancel).toBe(true);
  });
});
