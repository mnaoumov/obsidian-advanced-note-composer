import type {
  MarkdownView,
  TFile
} from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

const PLUGIN_ID = 'advanced-note-composer';

/*
 * Issue #287. The reporter's own scenario: a manual selection is interrupted part-way by a horizontal
 * rule, leaving `[partial]|` with the caret at its end. Each of the three commands that can finish it must
 * keep where the partial selection BEGAN — before #287 `Select after cursor` restarted at the caret and
 * `Start selection` anchored there, so both threw the partial selection away.
 */
describe('resuming a partial selection (issues #287, #305)', () => {
  it('keeps the start of a live selection in Select after cursor, Select before cursor and the anchor pair', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const LINES = [
          '# H1', // 0
          '', // 1
          'Content with already started or partial selection', // 2
          '', // 3
          '---', // 4
          '', // 5
          'More content', // 6
          '', // 7
          'End of file/selection' // 8
        ];
        const SOURCE = LINES.join('\n');
        const PATH = 'resume-partial-selection-fixture.md';
        const PARTIAL_START = { ch: 'Content with '.length, line: 2 };
        const PARTIAL_END = { ch: 0, line: 4 };
        const LAST_LINE = 8;
        const DOCUMENT_END = { ch: LINES[LAST_LINE]?.length ?? 0, line: LAST_LINE };
        // The one wait below names its ceiling, well under the transport's 30 s cap.
        const WAIT_TIMEOUT_IN_MILLISECONDS = 10_000;

        const view = await openFixture();
        const editor = view.editor;
        // `vault.modify` leaves an already-open buffer stale, so the note is reset through the editor.
        editor.setValue(SOURCE);

        const afterCursor = runOnPartialSelection('select-after-cursor');
        const beforeCursor = runOnPartialSelection('select-before-cursor');

        // The anchor pair: start with the partial selection live, tap the far end, end.
        editor.setSelection(PARTIAL_START, PARTIAL_END);
        app.commands.executeCommandById(`${pluginId}:start-selection`);
        editor.setCursor(DOCUMENT_END);
        const isEndSelectionAvailable = app.commands.commands[`${pluginId}:end-selection`]?.editorCheckCallback?.(true, editor, view) === true;
        app.commands.executeCommandById(`${pluginId}:end-selection`);
        const anchorPair = editor.getSelection();

        /*
         * Issue #305: the same resume with ONE command. The partial selection is collapsed by the tap that
         * marks where it should end, and `End selection` still reaches back to where it began.
         */
        editor.setSelection(PARTIAL_START, PARTIAL_END);
        editor.setCursor(DOCUMENT_END);
        const isEndSelectionAvailableWithoutStart = app.commands.commands[`${pluginId}:end-selection`]?.editorCheckCallback?.(true, editor, view) === true;
        app.commands.executeCommandById(`${pluginId}:end-selection`);
        const oneCommand = editor.getSelection();

        return {
          afterCursor,
          anchorPair,
          beforeCursor,
          isEndSelectionAvailable,
          isEndSelectionAvailableWithoutStart,
          oneCommand
        };

        function runOnPartialSelection(commandId: string): string {
          editor.setSelection(PARTIAL_START, PARTIAL_END);
          app.commands.executeCommandById(`${pluginId}:${commandId}`);
          return editor.getSelection();
        }

        async function openFixture(): Promise<MarkdownView> {
          const existing = app.vault.getAbstractFileByPath(PATH);
          const file: TFile = existing instanceof obsidianModule.TFile ? existing : await app.vault.create(PATH, SOURCE);
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === PATH,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          const markdownView = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!markdownView) {
            throw new Error('No active markdown view.');
          }
          return markdownView;
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    const RESUMED_TO_END = 'already started or partial selection\n\n---\n\nMore content\n\nEnd of file/selection';

    // Grown from where the partial selection began, not restarted at the caret (which sat on the `---`).
    expect(result.afterCursor).toBe(RESUMED_TO_END);
    // The mirror image keeps the partial selection's END and grows it to the top.
    expect(result.beforeCursor).toBe('# H1\n\nContent with already started or partial selection\n\n');
    // `Start selection` anchored where the partial selection began, so `End selection` reaches back to it.
    expect(result.isEndSelectionAvailable).toBe(true);
    expect(result.anchorPair).toBe(RESUMED_TO_END);
    // Issue #305: no `Start selection` needed.
    expect(result.isEndSelectionAvailableWithoutStart).toBe(true);
    expect(result.oneCommand).toBe(RESUMED_TO_END);
  });

  /*
   * Issue #305's guard. Obsidian reuses one editor per leaf across notes, so a selection start remembered
   * in one note must not let `End selection` reach into the next one.
   */
  it('forgets where a selection began once the note is left', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const PATH = 'resume-partial-selection-leave-fixture.md';
        const OTHER_PATH = 'resume-partial-selection-other-fixture.md';
        const SOURCE = 'first line\nsecond line\nthird line';
        // Three opens share this ceiling, well under the transport's 30 s cap.
        const WAIT_TIMEOUT_IN_MILLISECONDS = 7000;

        const view = await openNote(PATH);
        view.editor.setValue(SOURCE);
        view.editor.setSelection({ ch: 0, line: 0 }, { ch: 5, line: 1 });
        view.editor.setCursor({ ch: 0, line: 2 });
        const isAvailableBeforeLeaving = isEndSelectionAvailable(view);

        const otherView = await openNote(OTHER_PATH);
        const isAvailableInOtherNote = isEndSelectionAvailable(otherView);
        const reopened = await openNote(PATH);
        reopened.editor.setCursor({ ch: 0, line: 2 });

        return {
          isAvailableAfterComingBack: isEndSelectionAvailable(reopened),
          isAvailableBeforeLeaving,
          isAvailableInOtherNote
        };

        function isEndSelectionAvailable(markdownView: MarkdownView): boolean {
          return app.commands.commands[`${pluginId}:end-selection`]?.editorCheckCallback?.(true, markdownView.editor, markdownView) === true;
        }

        async function openNote(notePath: string): Promise<MarkdownView> {
          const existing = app.vault.getAbstractFileByPath(notePath);
          const file: TFile = existing instanceof obsidianModule.TFile ? existing : await app.vault.create(notePath, SOURCE);
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === notePath,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          const markdownView = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!markdownView) {
            throw new Error('No active markdown view.');
          }
          return markdownView;
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    expect(result).toEqual({
      isAvailableAfterComingBack: false,
      isAvailableBeforeLeaving: true,
      isAvailableInOtherNote: false
    });
  });
});
