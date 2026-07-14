import type {
  Editor,
  TFile
} from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup';
import {
  describe,
  expect,
  it
} from 'vitest';

const PLUGIN_ID = 'advanced-note-composer';

describe('move marked selection', () => {
  it('should move a marked selection to the cursor across notes and within the same note', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const SETTLE_IN_MILLISECONDS = 400;
        const NOTICE_REMOVAL_IN_MILLISECONDS = 700;

        // --- Cross-file move: mark "BBB" in the source and move it to the cursor in the target. ---
        const source = await resetFile('move-it-source.md', 'AAA BBB CCC');
        await resetFile('move-it-target.md', 'target end');

        const sourceEditor = await openAndGetEditor(source);
        sourceEditor.setSelection(sourceEditor.offsetToPos(4), sourceEditor.offsetToPos(7));
        app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
        await sleep(SETTLE_IN_MILLISECONDS);

        // The mark shows a permanent "Smart cut & paste" notice whose body offers the move buttons.
        const markNoticeEl = findMarkNotice();
        const markNoticeText = markNoticeEl?.textContent ?? '';
        const markNoticeButtonTexts = markNoticeEl
          ? Array.from(markNoticeEl.querySelectorAll('button')).map((buttonEl) => buttonEl.textContent)
          : [];

        // The marked selection is persistently highlighted in the source editor.
        const highlightAfterMark = activeDocument.querySelectorAll('.advanced-note-composer-pending-selection').length;

        const target = await resetFile('move-it-target.md', 'target end');
        const targetEditor = await openAndGetEditor(target);
        targetEditor.setCursor(targetEditor.offsetToPos(7));
        app.commands.executeCommandById(`${pluginId}:move-marked-selection-here`);
        await waitUntil({ predicate: () => editorValueFor('move-it-target.md')?.includes('BBB') === true });
        await sleep(SETTLE_IN_MILLISECONDS);

        const crossFileTarget = editorValueFor('move-it-target.md') ?? '';
        const crossFileSource = editorValueFor('move-it-source.md') ?? await app.vault.read(source);

        // --- Same-note move: mark "one" and move it to a cursor after it in the same note. ---
        const same = await resetFile('move-it-same.md', 'one two three');
        const sameEditor = await openAndGetEditor(same);
        sameEditor.setSelection(sameEditor.offsetToPos(0), sameEditor.offsetToPos(3));
        app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
        await sleep(SETTLE_IN_MILLISECONDS);

        // Place the cursor at the end of the note (outside the marked selection) and move.
        sameEditor.setCursor(sameEditor.offsetToPos(13));
        app.commands.executeCommandById(`${pluginId}:move-marked-selection-here`);
        await waitUntil({ predicate: () => editorValueFor('move-it-same.md')?.endsWith('one') === true });
        await sleep(SETTLE_IN_MILLISECONDS);

        const sameNote = editorValueFor('move-it-same.md') ?? '';

        // Once the mark is released (by the move), the permanent notice is hidden again and the
        // Persistent highlight is removed from every editor.
        await sleep(NOTICE_REMOVAL_IN_MILLISECONDS);
        const markNoticeGoneAfterMoves = findMarkNotice() === null;
        const highlightGoneAfterMoves = activeDocument.querySelectorAll('.advanced-note-composer-pending-selection').length === 0;

        return { crossFileSource, crossFileTarget, highlightAfterMark, highlightGoneAfterMoves, markNoticeButtonTexts, markNoticeGoneAfterMoves, markNoticeText, sameNote };

        function findMarkNotice(): Element | null {
          for (const el of Array.from(activeDocument.querySelectorAll('.notice'))) {
            if (el.textContent.includes('Smart cut & paste')) {
              return el;
            }
          }
          return null;
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

        function editorValueFor(path: string): string | undefined {
          for (const leaf of app.workspace.getLeavesOfType('markdown')) {
            const view = leaf.view;
            if (view instanceof obsidianModule.MarkdownView && view.file?.path === path) {
              return view.editor.getValue();
            }
          }
          return undefined;
        }
      },
      vaultPath: getTempVault().path
    });

    // Cross-file: the moved text was inserted at the cursor (which was before "end"), not appended, and
    // Left the source. It lands after the default `\n\n{{content}}` template prefix, so assert position
    // Relative to "end" rather than an exact offset.
    expect(result.crossFileTarget).toContain('BBB');
    expect(result.crossFileTarget).toContain('end');
    expect(result.crossFileTarget.indexOf('BBB')).toBeLessThan(result.crossFileTarget.indexOf('end'));
    expect(result.crossFileSource).not.toContain('BBB');

    // Same-note: the marked "one" was removed from the front and re-inserted at the end cursor. With
    // The default setting, a same-note move leaves nothing (no meaningless self-link) in its place.
    expect(result.sameNote).toContain('one');
    expect(result.sameNote.startsWith('one ')).toBe(false);
    expect(result.sameNote.endsWith('one')).toBe(true);
    expect(result.sameNote).not.toContain('[[move-it-same');
    // A move, not a copy: the marked "one" appears exactly once (it was cut from the front, not left there).
    expect(result.sameNote.match(/one/g)?.length).toBe(1);

    // The mark notice is permanent and branded "Smart cut & paste", offering the move buttons, then is
    // Hidden once the mark is released.
    expect(result.markNoticeText).toContain('Smart cut & paste');
    expect(result.markNoticeButtonTexts).toEqual([
      'Move marked selection to top of file',
      'Move marked selection to bottom of file',
      'Move marked selection at cursor',
      'Cancel move'
    ]);
    expect(result.markNoticeGoneAfterMoves).toBe(true);

    // The marked selection is persistently highlighted while marked, and the highlight is removed once
    // The mark is released.
    expect(result.highlightAfterMark).toBeGreaterThan(0);
    expect(result.highlightGoneAfterMoves).toBe(true);
  });
});
