import type {
  Editor,
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

const SOURCE = 'one two three\nfour five six\nseven eight nine';
const PATH = 'selection-anchor-fixture.md';
const OTHER_PATH = 'selection-anchor-other-note.md';

/*
 * The expected selection in EVERY direction case below, including the one that edits the document in
 * between. Anchoring at `two` and ending at `four` names the same text however the anchor got there, which
 * is what makes the edit case a real test rather than a restatement of the arithmetic.
 */
const EXPECTED_SELECTION = 'two three\nfour';
const ANCHOR_POSITION = { ch: 4, line: 0 };
const END_POSITION = { ch: 4, line: 1 };

/*
 * Issue #266. Cross-platform rather than desktop-only on purpose: `manifest.json` sets
 * `isDesktopOnly: false`, and Android is the platform this feature exists FOR — the reporter measures ~20%
 * success at touch text-selection there, which is what makes marking a selection by hand unusable and
 * every selection-first feature with it.
 */
describe('selection anchor (issue #266)', () => {
  it('selects between the two marked points, in either direction and across edits made in between', async () => {
    const result = await evalInObsidian({
      async callback({ anchorPosition, app, endPosition, lib: { waitUntil }, obsidianModule, path, pluginId, source }) {
        const editor = await openFixture();

        return {
          afterEditInBetween: await anchorAndEnd(true),
          backwards: await anchorAndEnd(false, true),
          forwards: await anchorAndEnd(false)
        };

        /**
         * Anchors, optionally edits the document above the anchor, then ends the selection.
         *
         * @param shouldEditInBetween - Whether to insert text ABOVE the anchor before ending.
         * @param shouldAnchorAfterCursor - Whether to anchor at the END of the range and finish at its start.
         * @returns What the two commands reported and what ended up selected.
         */
        async function anchorAndEnd(shouldEditInBetween: boolean, shouldAnchorAfterCursor = false): Promise<AnchorOutcome> {
          editor.setValue(source);
          const anchorAt = shouldAnchorAfterCursor ? endPosition : anchorPosition;
          const endAt = shouldAnchorAfterCursor ? anchorPosition : endPosition;

          editor.setSelection(anchorAt, anchorAt);
          app.commands.executeCommandById(`${pluginId}:start-selection`);

          let inserted = 0;
          if (shouldEditInBetween) {
            /*
             * THE case. The user is expected to keep typing between the two commands — that is the whole
             * design, and why the anchor is a CodeMirror `StateField` rather than a number held beside the
             * editor. A raw offset would still point at character 4 here and silently select the wrong
             * text; a test that skips this step passes against exactly that broken implementation.
             */
            const PREFIX = 'PREFIX ';
            editor.replaceRange(PREFIX, { ch: 0, line: 0 });
            inserted = PREFIX.length;
            await waitUntil({
              message: 'the editor did not take the inserted text',
              predicate: () => editor.getValue().startsWith(PREFIX)
            });
          }

          const endCursor = endAt.line === 0 ? { ch: endAt.ch + inserted, line: 0 } : endAt;
          editor.setSelection(endCursor, endCursor);
          // Availability comes from the check callback, the same question the command palette asks;
          // `executeCommandById` reports whether a command was DISPATCHED, not whether it was offered.
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          const isEndAvailable = !!view
            && app.commands.commands[`${pluginId}:end-selection`]?.editorCheckCallback?.(true, editor, view) === true;
          app.commands.executeCommandById(`${pluginId}:end-selection`);

          return {
            isEndAvailable,
            selectedText: editor.getSelection()
          };
        }

        async function openFixture(): Promise<Editor> {
          const existing = app.vault.getAbstractFileByPath(path);
          const file = existing instanceof obsidianModule.TFile ? existing : await app.vault.create(path, source);
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({ predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor !== undefined });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          // Through the editor, not `vault.modify`: this vault is shared, so the note may already be open
          // With a stale buffer that an offset-based selection would silently read instead.
          view.editor.setValue(source);
          return view.editor;
        }
      },
      input: {
        anchorPosition: ANCHOR_POSITION,
        endPosition: END_POSITION,
        path: PATH,
        pluginId: PLUGIN_ID,
        source: SOURCE
      },
      vaultPath: getTemporaryVault().path
    });

    expect(result.forwards).toEqual({
      isEndAvailable: true,
      selectedText: EXPECTED_SELECTION
    });

    // Anchoring the FAR end and finishing at the near one is the ordinary case on a phone, where the caret
    // Is placed by tapping and taps do not arrive in document order.
    expect(result.backwards).toEqual({
      isEndAvailable: true,
      selectedText: EXPECTED_SELECTION
    });

    // Same text as the two cases above, despite seven characters being inserted above the anchor: the
    // Anchor tracked the edit. An unmapped offset selects from character 4 of the NEW document instead.
    expect(result.afterEditInBetween).toEqual({
      isEndAvailable: true,
      selectedText: EXPECTED_SELECTION
    });
  });

  it('shows a marker while armed, and is unavailable with no anchor or after leaving the note', async () => {
    const result = await evalInObsidian({
      async callback({ anchorPosition, app, lib: { waitUntil }, obsidianModule, otherPath, path, pluginId, source }) {
        const ANCHOR_SELECTOR = '.advanced-note-composer-selection-anchor';

        /*
         * `file-open` fires AFTER the view is live, so waiting on `getActiveViewOfType(...).file` can
         * return before the plugin's own `file-open` handler has run — and the anchor that handler drops
         * when you leave a note would still be armed when the next line probes for it. Recording the
         * events and waiting for the one that matters removes the race, and tells a handler that never
         * fires apart from one that merely fires late.
         */
        const openedPaths: string[] = [];
        const fileOpenRef = app.workspace.on('file-open', (openedFile) => {
          openedPaths.push(openedFile?.path ?? '(none)');
        });

        const view = await openNote(path, source);
        view.editor.setValue(source);
        view.editor.setSelection(anchorPosition, anchorPosition);

        // With nothing anchored, the two commands that consume an anchor are not offered — so on a phone
        // They stay out of the command palette until they can actually do something.
        const isEndAvailableWithNoAnchor = isAvailable('end-selection', view);
        const isCancelAvailableWithNoAnchor = isAvailable('cancel-selection', view);

        app.commands.executeCommandById(`${pluginId}:start-selection`);
        /*
         * An anchor is a POINT, so it renders as a widget decoration rather than the mark decoration the
         * pending-selection highlight uses — a mark over a zero-length range draws nothing at all. Without
         * the widget there is no way to tell an armed anchor from an unarmed one, which on the platform
         * this feature is for is the difference between working and appearing to do nothing.
         */
        await waitUntil({
          message: 'the anchor marker was never rendered',
          predicate: () => view.containerEl.querySelector(ANCHOR_SELECTOR) !== null
        });
        const markerWhileArmed = view.containerEl.querySelector(ANCHOR_SELECTOR);
        const hasMarkerWhileArmed = markerWhileArmed !== null;
        /*
         * Present in the DOM is not the same as visible, and visible is the whole point: the marker is the
         * only thing telling the user the anchor is armed. A widget whose stylesheet never shipped, or was
         * overridden, is a zero-width span that passes a `querySelector` check and shows the user nothing.
         */
        const markerStyle = markerWhileArmed === null ? null : activeWindow.getComputedStyle(markerWhileArmed);
        const isMarkerVisible = !!markerStyle && markerStyle.display !== 'none' && Number.parseFloat(markerStyle.width) > 0;

        // Opening another note drops the anchor: Obsidian reuses one editor per leaf across file switches,
        // So an anchor left behind would map into a DIFFERENT document and select text nobody pointed at.
        const otherView = await openNote(otherPath, 'a different note');
        const isEndAvailableInAnotherNote = isAvailable('end-selection', otherView);

        // Coming back is the assertion that carries the weight. In the other note the command is refused
        // Anyway, because the anchored note is not this one — only returning to the anchored note can tell
        // A dropped anchor from one that merely does not apply where you are standing.
        const reopened = await openNote(path, source);
        const isEndAvailableAfterComingBack = isAvailable('end-selection', reopened);

        // Arm it again, this time to cancel it.
        reopened.editor.setSelection(anchorPosition, anchorPosition);
        app.commands.executeCommandById(`${pluginId}:start-selection`);
        await waitUntil({
          message: 'the anchor marker was never rendered for the cancel case',
          predicate: () => reopened.containerEl.querySelector(ANCHOR_SELECTOR) !== null
        });
        const isCancelAvailableWhileArmed = isAvailable('cancel-selection', reopened);
        app.commands.executeCommandById(`${pluginId}:cancel-selection`);
        await waitUntil({
          message: 'the anchor marker survived Cancel selection',
          predicate: () => reopened.containerEl.querySelector(ANCHOR_SELECTOR) === null
        });

        app.workspace.offref(fileOpenRef);

        return {
          hasMarkerAfterCancel: reopened.containerEl.querySelector(ANCHOR_SELECTOR) !== null,
          hasMarkerWhileArmed,
          isCancelAvailableWhileArmed,
          isCancelAvailableWithNoAnchor,
          isEndAvailableAfterComingBack,
          isEndAvailableInAnotherNote,
          isEndAvailableWithNoAnchor,
          isMarkerVisible,
          selectionAfterCancel: reopened.editor.getSelection()
        };

        /**
         * Whether the command is offered in the given view — the same question the command palette asks.
         * `executeCommandById` cannot answer it: that reports whether a command was DISPATCHED.
         *
         * @param commandId - The command's id, without the plugin prefix.
         * @param markdownView - The view to ask about.
         * @returns Whether the command is available there.
         */
        function isAvailable(commandId: string, markdownView: MarkdownView): boolean {
          return app.commands.commands[`${pluginId}:${commandId}`]?.editorCheckCallback?.(true, markdownView.editor, markdownView) === true;
        }

        async function openNote(notePath: string, content: string): Promise<MarkdownView> {
          const existing = app.vault.getAbstractFileByPath(notePath);
          const file: TFile = existing instanceof obsidianModule.TFile ? existing : await app.vault.create(notePath, content);
          // Re-opening the note that is already showing is a no-op that fires NO `file-open` at all, and
          // This vault is shared, so the fixture may well already be active from an earlier suite.
          const isAlreadyActive = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === notePath;
          const openCountBefore = openedPaths.filter((openedPath) => openedPath === notePath).length;
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({ predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === notePath });
          if (!isAlreadyActive) {
            // The view being live is not enough — every `file-open` subscriber, the plugin's included, has
            // To have seen the event before the next line asks about its effect.
            await waitUntil({
              message: `file-open never fired for ${notePath}`,
              predicate: () => openedPaths.filter((openedPath) => openedPath === notePath).length > openCountBefore
            });
          }
          const markdownView = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!markdownView) {
            throw new Error('No active markdown view.');
          }
          return markdownView;
        }
      },
      input: {
        anchorPosition: ANCHOR_POSITION,
        otherPath: OTHER_PATH,
        path: PATH,
        pluginId: PLUGIN_ID,
        source: SOURCE
      },
      vaultPath: getTemporaryVault().path
    });

    expect(result).toEqual({
      hasMarkerAfterCancel: false,
      hasMarkerWhileArmed: true,
      isCancelAvailableWhileArmed: true,
      isCancelAvailableWithNoAnchor: false,
      // Dropped when the note was left, and not restored by coming back — an anchor lives only as long as
      // You stay in the note you set it in.
      isEndAvailableAfterComingBack: false,
      isEndAvailableInAnotherNote: false,
      isEndAvailableWithNoAnchor: false,
      isMarkerVisible: true,
      // Cancel drops the anchor without selecting anything, mirroring `Smart cut & paste: Cancel move`.
      selectionAfterCancel: ''
    });
  });
});

interface AnchorOutcome {
  readonly isEndAvailable: boolean;
  readonly selectedText: string;
}
