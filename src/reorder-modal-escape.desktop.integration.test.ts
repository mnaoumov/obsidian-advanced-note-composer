import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// The reorder modal's `Escape` was never exercised — the same shape of gap that let issue #231's
// Broken drag ship, and issue #142 is the precedent for a real defect in exactly this handler shape (a
// Keymap handler that does not `return false` leaks the key past the modal). Driven with the harness's
// TRUSTED `pressKey`, so the key travels the real input pipeline a user's does.
//
// Verified by mutation, so the scope of what this pins is known rather than assumed. The modal
// Registers no `Escape` handler at all — writing this test is what proved the one it used to have to
// Be dead code, since Obsidian's `Modal` already closes on `Escape` and preventDefaults it. What this
// Pins instead is the cancel contract in `onClose`: making it resolve `true` (a confirm) writes the
// Reordered note and fails here.
const PLUGIN_ID = 'advanced-note-composer';

const NOTE_CONTENT = '# A\naaa\n\n# B\nbbb\n\n# C\nccc\n';
const NOTE_PATH = 'reorder-escape-headings.md';

describe('reorder modal keyboard paths', () => {
  it('should discard a pending reorder and leave the note untouched when Escape is pressed', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, noteContent, notePath, obsidianModule, pluginId }) {
        // The callback is serialized into the Obsidian process, so it cannot reach this file's
        // Module scope — everything it needs arrives through `input` or is declared right here.
        const HEADING_COUNT = 3;
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        // Comfortably past the time the reorder itself takes, so "nothing was written" cannot just
        // Mean "not yet".
        const PAST_REORDER_DELAY_IN_MILLISECONDS = 3000;

        const existing = app.vault.getAbstractFileByPath(notePath);
        const file = existing instanceof obsidianModule.TFile ? existing : await app.vault.create(notePath, noteContent);
        await app.workspace.getLeaf(false).openFile(file);
        await waitUntil({
          message: `editor for ${notePath} did not become active`,
          predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === notePath,
          timeoutInMilliseconds: 15_000
        });
        const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
        if (!view) {
          throw new Error(`No active markdown view for ${notePath}.`);
        }
        // Reset through the EDITOR: an already-open buffer would keep the previous run's text.
        view.editor.setValue(noteContent);

        // The command reads the heading cache; firing it before the cache catches up makes it silently
        // No-op and the timeout then blames the modal instead of the cache.
        await waitUntil({
          message: 'heading cache not ready',
          predicate: () => (app.metadataCache.getFileCache(file)?.headings?.length ?? 0) === HEADING_COUNT
        });

        app.commands.executeCommandById(`${pluginId}:reorder-headings`);
        await waitUntil({
          message: 'reorder modal did not open',
          predicate: () => document.querySelector('.advanced-note-composer-reorder-list') !== null
        });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        // Move "A" down FIRST, so the modal really is holding a pending change. Without it the
        // Assertion below would hold even for a modal that had nothing to write on confirm.
        moveRowDown('A');
        await sleep(RENDER_DELAY_IN_MILLISECONDS);
        const rowLabelsAfterMove = readRowLabels();

        const editorValueBeforeEscape = view.editor.getValue();

        // Obsidian's keymap listens on `window` in the CAPTURE phase and stops propagation, so a
        // Bubble-phase listener never sees the key at all. A capture listener registered here runs
        // After Obsidian's (same target, same phase — registration order) and therefore reads the
        // Outcome off the SAME trusted key press: `preventDefault`-ed exactly when the handler returned
        // `false`. That is the issue #142 contract, and nothing else observes it — the modal holds the
        // Focus, so a key that leaks has no visible effect to assert on.
        let wasDefaultPrevented = false;
        window.addEventListener('keydown', captureEscape, { capture: true });
        try {
          pressKey({ key: 'Escape' });

          await waitUntil({
            message: 'Escape did not close the reorder modal',
            predicate: () => document.querySelector('.advanced-note-composer-reorder-list') === null
          });
        } finally {
          window.removeEventListener('keydown', captureEscape, { capture: true });
        }
        await sleep(PAST_REORDER_DELAY_IN_MILLISECONDS);

        return {
          editorValueAfterEscape: view.editor.getValue(),
          editorValueBeforeEscape,
          noteContentAfterEscape: await app.vault.read(file),
          rowLabelsAfterMove,
          wasDefaultPrevented
        };

        function captureEscape(event: KeyboardEvent): void {
          if (event.key === 'Escape') {
            wasDefaultPrevented = event.defaultPrevented;
          }
        }

        function getRow(rowLabel: string): HTMLElement {
          const itemEl = document.querySelector(`.advanced-note-composer-reorder-item[data-row-label="${CSS.escape(rowLabel)}"]`);
          if (!(itemEl instanceof HTMLElement)) {
            throw new TypeError(`No row "${rowLabel}". Available: ${readRowLabels().join(' | ')}`);
          }
          return itemEl;
        }

        function moveRowDown(rowLabel: string): void {
          const button = getRow(rowLabel).querySelector('.advanced-note-composer-reorder-down');
          if (!(button instanceof HTMLButtonElement)) {
            throw new TypeError(`No down button on row "${rowLabel}".`);
          }
          button.click();
        }

        function readRowLabels(): (string | undefined)[] {
          return [...document.querySelectorAll<HTMLElement>('.advanced-note-composer-reorder-item')]
            .map((itemEl) => itemEl.dataset['rowLabel']);
        }
      },
      input: { noteContent: NOTE_CONTENT, notePath: NOTE_PATH, pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // There really was a pending reorder to discard, so the assertions below are not vacuous.
    expect(result.rowLabelsAfterMove).toEqual(['B', 'A', 'C']);

    // Escape discarded it: the note still holds the original order.
    expect(result.noteContentAfterEscape).toBe(NOTE_CONTENT);
    expect(result.noteContentAfterEscape.indexOf('# A')).toBeLessThan(result.noteContentAfterEscape.indexOf('# B'));
    expect(result.noteContentAfterEscape.indexOf('# B')).toBeLessThan(result.noteContentAfterEscape.indexOf('# C'));

    // The handler returned `false`, so the key was preventDefault-ed and cannot leak past the modal
    // Into the editor underneath (issue #142). This is the ONLY assertion here that pins that.
    expect(result.wasDefaultPrevented).toBe(true);

    expect(result.editorValueAfterEscape).toBe(result.editorValueBeforeEscape);
    expect(result.editorValueAfterEscape).toBe(NOTE_CONTENT);
  });
});
