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

// The paste-options modal registers `Enter` (confirm) and `Escape` (close) and nothing exercised
// Either — the same shape of gap that let issue #231's broken drag ship. Issue #142 is the precedent
// For a real defect in exactly this handler shape: a keymap handler that does not `return false` lets
// The key leak past the modal into the editor underneath. Both keys are therefore driven with the
// Harness's TRUSTED `pressKey` (a real Electron key press through the real input pipeline) rather than
// A synthetic `KeyboardEvent`, and `defaultPrevented` is read off that same press.
//
// Verified by mutation, so the scope of what this pins is known rather than assumed: for `Enter`,
// Dropping `this.confirm()` and flipping its `return false` to `return true` each fail here. The modal
// Registers no `Escape` handler at all — writing this test is what proved one to be dead code, since
// Obsidian's `Modal` already closes on `Escape` and preventDefaults it — so what the `Escape` case
// Pins is the cancel contract in `onClose`: resolving anything but `null` fails loudly.
const PLUGIN_ID = 'advanced-note-composer';

const SOURCE_CONTENT = 'AAA MOVED CCC';
const TARGET_CONTENT = 'target end';

describe('paste options modal keyboard paths', () => {
  it('should move the marked selection with the options set in the modal when Enter is pressed', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId, sourceContent, targetContent }) {
        // The callback is serialized into the Obsidian process, so it cannot reach this file's
        // Module scope — everything it needs arrives through `input` or is declared right here.
        const MARKED_TEXT_END_OFFSET = 9;
        const MARKED_TEXT_START_OFFSET = 4;
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const TARGET_CURSOR_OFFSET = 7;

        await markSelectionInSource();

        const targetEditor = await openAndResetEditor('paste-options-keys-target.md', targetContent);
        targetEditor.setCursor(targetEditor.offsetToPos(TARGET_CURSOR_OFFSET));
        app.commands.executeCommandById(`${pluginId}:move-marked-selection-here-advanced`);

        await waitUntil({
          message: 'paste options modal did not open',
          predicate: () => findButton('Move') !== null
        });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        // Leave a DIFFERENT residual than the settings default (`Link to new file`), so a confirm that
        // Ignored the modal and fell back to the defaults is distinguishable from one that honored it.
        selectDropdownOption('Text after extraction', 'None');
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        // Obsidian's keymap listens on `window` in the CAPTURE phase and stops propagation, so a
        // Bubble-phase listener never sees the key at all. A capture listener registered here runs
        // After Obsidian's (same target, same phase — registration order) and therefore reads the
        // Outcome off the SAME trusted key press: `preventDefault`-ed exactly when the handler returned
        // `false`. That is the issue #142 contract, and nothing else observes it — the modal holds the
        // Focus, so a key that leaks has no visible effect to assert on.
        let wasDefaultPrevented = false;
        window.addEventListener('keydown', captureEnter, { capture: true });
        try {
          pressKey({ key: 'Enter' });

          await waitUntil({
            message: 'Enter did not confirm the move',
            predicate: async () => {
              const value = await readFile('paste-options-keys-target.md');
              return value.includes('MOVED');
            },
            timeoutInMilliseconds: 15_000
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        } finally {
          window.removeEventListener('keydown', captureEnter, { capture: true });
        }

        return {
          isModalClosed: findButton('Move') === null,
          sourceContent: await readFile('paste-options-keys-source.md'),
          targetContent: await readFile('paste-options-keys-target.md'),
          wasDefaultPrevented
        };

        function captureEnter(event: KeyboardEvent): void {
          if (event.key === 'Enter') {
            wasDefaultPrevented = event.defaultPrevented;
          }
        }

        function findButton(text: string): HTMLButtonElement | null {
          for (const el of document.querySelectorAll('.modal-button-container button')) {
            if (el.instanceOf(HTMLButtonElement) && el.textContent === text) {
              return el;
            }
          }
          return null;
        }

        async function markSelectionInSource(): Promise<void> {
          const sourceEditor = await openAndResetEditor('paste-options-keys-source.md', sourceContent);
          sourceEditor.setSelection(sourceEditor.offsetToPos(MARKED_TEXT_START_OFFSET), sourceEditor.offsetToPos(MARKED_TEXT_END_OFFSET));
          app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        }

        // Resets through the EDITOR rather than `vault.modify`: an already-open buffer keeps the
        // Previous run's text, and the offsets above would then mark the wrong words.
        async function openAndResetEditor(path: string, content: string): Promise<Editor> {
          const existing = app.vault.getAbstractFileByPath(path);
          const file = existing instanceof obsidianModule.TFile ? existing : await app.vault.create(path, content);
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `editor for ${path} did not become active`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === path,
            timeoutInMilliseconds: 15_000
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error(`No active markdown view for ${path}.`);
          }
          view.editor.setValue(content);
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return view.editor;
        }

        async function readFile(path: string): Promise<string> {
          const file = app.vault.getFileByPath(path);
          if (!file) {
            throw new Error(`No file at ${path}.`);
          }
          return await app.vault.read(file);
        }

        function selectDropdownOption(settingName: string, optionText: string): void {
          const settingItemEl = [...document.querySelectorAll('.modal-content .setting-item')]
            .find((el) => el.querySelector('.setting-item-name')?.textContent === settingName);
          const selectEl = settingItemEl?.querySelector('select');
          if (!(selectEl instanceof HTMLSelectElement)) {
            throw new TypeError(`No "${settingName}" dropdown in the paste options modal.`);
          }
          const option = [...selectEl.options].find((el) => el.text === optionText);
          if (!option) {
            throw new Error(`No "${optionText}" option in "${settingName}".`);
          }
          selectEl.value = option.value;
          selectEl.dispatchEvent(new Event('change'));
        }
      },
      input: { pluginId: PLUGIN_ID, sourceContent: SOURCE_CONTENT, targetContent: TARGET_CONTENT },
      vaultPath: getTemporaryVault().path
    });

    // The handler returned `false`, so Obsidian preventDefault-ed the key and it cannot leak past the
    // Modal (issue #142). This is the ONLY assertion that pins the `return false`; every other one here
    // Holds just as well without it.
    expect(result.wasDefaultPrevented).toBe(true);

    // Enter confirmed: the modal is gone and the marked text landed in the target.
    expect(result.isModalClosed).toBe(true);
    expect(result.targetContent).toContain('MOVED');
    expect(result.sourceContent).not.toContain('MOVED');

    // ...with the modal's OWN options, not the plugin defaults. `Text after extraction` defaults to
    // `Link to new file`, so a confirm that ignored the modal would have left a link in the source.
    expect(result.sourceContent).not.toContain('[[');
  });

  it('should cancel the move and leave the editor untouched when Escape is pressed', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId, sourceContent, targetContent }) {
        // The callback is serialized into the Obsidian process, so it cannot reach this file's
        // Module scope — everything it needs arrives through `input` or is declared right here.
        const MARKED_TEXT_END_OFFSET = 9;
        const MARKED_TEXT_START_OFFSET = 4;
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const TARGET_CURSOR_OFFSET = 7;
        // Comfortably past the time the move itself takes, so "nothing happened" cannot just mean
        // "not yet".
        const PAST_MOVE_DELAY_IN_MILLISECONDS = 3000;

        let wasDefaultPrevented = false;

        try {
          await markSelectionInSource();

          const targetEditor = await openAndResetEditor('paste-options-escape-target.md', targetContent);
          targetEditor.setCursor(targetEditor.offsetToPos(TARGET_CURSOR_OFFSET));
          app.commands.executeCommandById(`${pluginId}:move-marked-selection-here-advanced`);

          await waitUntil({
            message: 'paste options modal did not open',
            predicate: () => findButton('Move') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const editorValueBeforeEscape = targetEditor.getValue();

          // Obsidian's keymap listens on `window` in the CAPTURE phase and stops propagation, so this
          // Capture listener — registered after Obsidian's, hence run after it — is what reads the
          // Outcome off the SAME trusted key press (issue #142's contract).
          window.addEventListener('keydown', captureEscape, { capture: true });
          try {
            pressKey({ key: 'Escape' });

            await waitUntil({
              message: 'Escape did not close the paste options modal',
              predicate: () => findButton('Move') === null
            });
          } finally {
            window.removeEventListener('keydown', captureEscape, { capture: true });
          }
          await sleep(PAST_MOVE_DELAY_IN_MILLISECONDS);

          const editorValueAfterEscape = targetEditor.getValue();
          const sourceContentAfterEscape = await readFile('paste-options-escape-source.md');
          const targetContentAfterEscape = await readFile('paste-options-escape-target.md');

          // A cancelled advanced move deliberately KEEPS the mark (the handler returns before clearing
          // The buffer), so the source note is still locked. Cancelling is both the cleanup that keeps
          // The shared vault usable for later suites AND the observation that the mark survived — the
          // Command refuses to run at all without one. Notices auto-hide and render into
          // `activeDocument`, so read them as the wait succeeds rather than afterwards.
          let noticeTexts: string[] = [];
          app.commands.executeCommandById(`${pluginId}:cancel-move`);
          await waitUntil({
            message: 'the marked selection did not survive the cancelled move',
            predicate: () => {
              noticeTexts = [...activeDocument.querySelectorAll('.notice')].map((el) => el.textContent);
              return noticeTexts.some((text) => text.includes('Cancelled move'));
            }
          });

          return {
            editorValueAfterEscape,
            editorValueBeforeEscape,
            noticeTexts,
            sourceContent: sourceContentAfterEscape,
            targetContent: targetContentAfterEscape,
            wasDefaultPrevented
          };
        } finally {
          // Safety net only: if anything above threw before the cancel, the source note would stay
          // Locked for every suite that follows in the shared instance. A no-op once the mark is gone
          // (`canExecute` is false, so the command never runs).
          app.commands.executeCommandById(`${pluginId}:cancel-move`);
        }

        function captureEscape(event: KeyboardEvent): void {
          if (event.key === 'Escape') {
            wasDefaultPrevented = event.defaultPrevented;
          }
        }

        function findButton(text: string): HTMLButtonElement | null {
          for (const el of document.querySelectorAll('.modal-button-container button')) {
            if (el.instanceOf(HTMLButtonElement) && el.textContent === text) {
              return el;
            }
          }
          return null;
        }

        async function markSelectionInSource(): Promise<void> {
          const sourceEditor = await openAndResetEditor('paste-options-escape-source.md', sourceContent);
          sourceEditor.setSelection(sourceEditor.offsetToPos(MARKED_TEXT_START_OFFSET), sourceEditor.offsetToPos(MARKED_TEXT_END_OFFSET));
          app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        }

        async function openAndResetEditor(path: string, content: string): Promise<Editor> {
          const existing = app.vault.getAbstractFileByPath(path);
          const file: TFile = existing instanceof obsidianModule.TFile ? existing : await app.vault.create(path, content);
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `editor for ${path} did not become active`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === path,
            timeoutInMilliseconds: 15_000
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error(`No active markdown view for ${path}.`);
          }
          view.editor.setValue(content);
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return view.editor;
        }

        async function readFile(path: string): Promise<string> {
          const file = app.vault.getFileByPath(path);
          if (!file) {
            throw new Error(`No file at ${path}.`);
          }
          return await app.vault.read(file);
        }
      },
      input: { pluginId: PLUGIN_ID, sourceContent: SOURCE_CONTENT, targetContent: TARGET_CONTENT },
      vaultPath: getTemporaryVault().path
    });

    // The handler returned `false`, so the key was preventDefault-ed and cannot leak past the modal
    // (issue #142). This is the ONLY assertion here that pins the `return false`.
    expect(result.wasDefaultPrevented).toBe(true);

    // The target editor is byte-identical: the move did not run.
    expect(result.editorValueAfterEscape).toBe(result.editorValueBeforeEscape);
    expect(result.editorValueAfterEscape).toBe(TARGET_CONTENT);

    // Nothing was written to either note.
    expect(result.targetContent).not.toContain('MOVED');
    expect(result.sourceContent).toBe(SOURCE_CONTENT);

    // The mark outlived the cancelled move — `Cancel move` refuses to run without one, so its notice
    // Appearing IS the proof.
    expect(result.noticeTexts.some((text) => text.includes('Cancelled move'))).toBe(true);
  });
});
