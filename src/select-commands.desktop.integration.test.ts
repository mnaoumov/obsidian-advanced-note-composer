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
 * Issue #266. The five per-shape select commands set exactly the ranges the matching `Extract ...`
 * commands compute, and then stop — no picker, no confirmation, nothing written. The reporter was already
 * getting these selections by running an extract and CANCELLING its modal; the point of the commands is
 * that the modal never opens, so "opened no modal" is asserted alongside every range.
 */
describe('select commands (issue #266)', () => {
  it('sets each range without opening a modal, and hides itself when it has nothing to select', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        /*
         * `# Gamma` is last and deliberately empty: it is the heading that gives
         * `Select this heading's content` nothing to select. `# Beta` bounds `# Alpha`'s section, so that
         * section does not run to the end of the note.
         */
        const LINES = [
          '# Alpha', // 0
          '', // 1
          'alpha body one', // 2
          'alpha body two', // 3
          '', // 4
          '# Beta', // 5
          '', // 6
          'beta body', // 7
          '', // 8
          '---', // 9
          '', // 10
          'between rules', // 11
          '', // 12
          '---', // 13
          '', // 14
          '# Gamma' // 15
        ];
        const SOURCE = LINES.join('\n');
        const PATH = 'select-commands-fixture.md';
        const ALPHA_BODY_LINE = 2;
        const BETWEEN_RULES_LINE = 11;
        const GAMMA_LINE = 15;
        const EXPECTED_HEADING_COUNT = 3;
        const EXPECTED_RULE_COUNT = 2;

        const view = await openFixture();
        const editor = view.editor;
        const fixtureFile = view.file;
        if (!fixtureFile) {
          throw new Error('The fixture view has no file.');
        }
        // `vault.modify` leaves an already-open buffer stale, and this vault is shared with every other
        // Suite, so the note may well be open from an earlier run.
        editor.setValue(SOURCE);

        // Both heading commands and the horizontal-rule one read the metadata cache. Run before it has
        // Indexed the note and they simply refuse, which surfaces as a wrong range rather than an error.
        await waitUntil({
          message: 'metadata cache did not index the fixture headings',
          predicate: () => (app.metadataCache.getFileCache(fixtureFile)?.headings ?? []).length === EXPECTED_HEADING_COUNT
        });
        await waitUntil({
          message: 'metadata cache did not index the horizontal rules',
          predicate: () =>
            (app.metadataCache.getFileCache(fixtureFile)?.sections ?? []).filter((section) => section.type === 'thematicBreak').length
              === EXPECTED_RULE_COUNT
        });

        return {
          afterCursor: runAt('select-after-cursor', { ch: 0, line: ALPHA_BODY_LINE }),
          beforeCursor: runAt('select-before-cursor', { ch: 0, line: ALPHA_BODY_LINE }),
          betweenRules: runAt('select-between-horizontal-rules', { ch: 0, line: BETWEEN_RULES_LINE }),
          // Nothing sits above the first character, nor below the last one.
          isAfterCursorAvailableAtEndOfNote: isAvailableAt('select-after-cursor', {
            ch: LINES[GAMMA_LINE]?.length ?? 0,
            line: GAMMA_LINE
          }),
          isBeforeCursorAvailableAtStartOfNote: isAvailableAt('select-before-cursor', { ch: 0, line: 0 }),
          // A heading with no body has content to select only if you count nothing.
          isContentOfEmptyHeadingAvailable: isAvailableAt('select-this-heading-content', { ch: 0, line: GAMMA_LINE }),
          isEmptyHeadingAvailable: isAvailableAt('select-this-heading', { ch: 0, line: GAMMA_LINE }),
          noteAfterwards: editor.getValue(),
          thisHeading: runAt('select-this-heading', { ch: 0, line: ALPHA_BODY_LINE }),
          thisHeadingContent: runAt('select-this-heading-content', { ch: 0, line: ALPHA_BODY_LINE })
        };

        /**
         * Counts the modals currently up.
         *
         * The vault is shared with every other suite, and one of them can leave a modal behind, so a
         * command is asked whether it opened a NEW one rather than whether any is open at all.
         *
         * @returns How many modals are open.
         */
        function countModals(): number {
          return document.querySelectorAll('.modal-container').length + document.querySelectorAll('.prompt').length;
        }

        /**
         * Whether the command is offered with the cursor at the given position — the same question the
         * command palette asks, and the one that decides whether the command is listed at all.
         *
         * @param commandId - The command's id, without the plugin prefix.
         * @param cursor - Where to put the cursor first.
         * @returns Whether the command is available there.
         */
        function isAvailableAt(commandId: string, cursor: CursorPosition): boolean {
          editor.setSelection(cursor, cursor);
          return app.commands.commands[`${pluginId}:${commandId}`]?.editorCheckCallback?.(true, editor, view) === true;
        }

        function runAt(commandId: string, cursor: CursorPosition): SelectionOutcome {
          const modalsBefore = countModals();
          const isAvailable = isAvailableAt(commandId, cursor);
          app.commands.executeCommandById(`${pluginId}:${commandId}`);
          return {
            isAvailable,
            openedModal: countModals() > modalsBefore,
            selectedText: editor.getSelection()
          };
        }

        async function openFixture(): Promise<MarkdownView> {
          const existing = app.vault.getAbstractFileByPath(PATH);
          const file: TFile = existing instanceof obsidianModule.TFile ? existing : await app.vault.create(PATH, SOURCE);
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({ predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === PATH });
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

    // The heading line and its whole body — the very range `Extract this heading...` would have taken.
    expect(result.thisHeading).toEqual({
      isAvailable: true,
      openedModal: false,
      selectedText: '# Alpha\n\nalpha body one\nalpha body two'
    });

    // The same section with its `#` line left out.
    expect(result.thisHeadingContent).toEqual({
      isAvailable: true,
      openedModal: false,
      selectedText: '\nalpha body one\nalpha body two'
    });

    expect(result.beforeCursor).toEqual({
      isAvailable: true,
      openedModal: false,
      selectedText: '# Alpha\n\n'
    });

    expect(result.afterCursor.isAvailable).toBe(true);
    expect(result.afterCursor.openedModal).toBe(false);
    expect(result.afterCursor.selectedText.startsWith('alpha body one')).toBe(true);
    expect(result.afterCursor.selectedText.endsWith('# Gamma')).toBe(true);

    // The bounding rules stay outside the selection, exactly as the extract leaves them in place.
    expect(result.betweenRules.isAvailable).toBe(true);
    expect(result.betweenRules.openedModal).toBe(false);
    expect(result.betweenRules.selectedText).toContain('between rules');
    expect(result.betweenRules.selectedText).not.toContain('---');

    // A command with nothing to select is not offered at all, which keeps it out of the command palette —
    // Worth real money on a phone, where filtering the palette means typing.
    expect({
      isAfterCursorAvailableAtEndOfNote: result.isAfterCursorAvailableAtEndOfNote,
      isBeforeCursorAvailableAtStartOfNote: result.isBeforeCursorAvailableAtStartOfNote,
      isContentOfEmptyHeadingAvailable: result.isContentOfEmptyHeadingAvailable,
      // The heading itself is still selectable — only its (absent) content is not.
      isEmptyHeadingAvailable: result.isEmptyHeadingAvailable
    }).toEqual({
      isAfterCursorAvailableAtEndOfNote: false,
      isBeforeCursorAvailableAtStartOfNote: false,
      isContentOfEmptyHeadingAvailable: false,
      isEmptyHeadingAvailable: true
    });

    // Nothing was written: a select only moves the caret.
    expect(result.noteAfterwards).toContain('# Alpha');
    expect(result.noteAfterwards).toContain('between rules');
    expect(result.noteAfterwards).not.toContain('[[select-commands-fixture');
  });
});

interface CursorPosition {
  readonly ch: number;
  readonly line: number;
}

interface SelectionOutcome {
  readonly isAvailable: boolean;
  readonly openedModal: boolean;
  readonly selectedText: string;
}
