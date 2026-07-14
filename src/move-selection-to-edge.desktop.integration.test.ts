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

describe('move marked selection to top/bottom of file', () => {
  it('should move a marked selection to the top and bottom of the same note and another note', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const SETTLE_IN_MILLISECONDS = 400;

        // --- Same-note bottom: mark "one" at the front and move it to the bottom of the same note. ---
        const sameBottom = await resetFile('edge-same-bottom.md', 'one two three');
        const sameBottomEditor = await openAndGetEditor(sameBottom);
        sameBottomEditor.setSelection(sameBottomEditor.offsetToPos(0), sameBottomEditor.offsetToPos(3));
        app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
        await sleep(SETTLE_IN_MILLISECONDS);
        app.commands.executeCommandById(`${pluginId}:move-marked-selection-to-bottom-of-file`);
        await waitUntil({ predicate: () => editorValueFor('edge-same-bottom.md')?.trimEnd().endsWith('one') === true });
        await sleep(SETTLE_IN_MILLISECONDS);
        const sameBottomNote = editorValueFor('edge-same-bottom.md') ?? '';

        // --- Same-note top: mark "three" at the end and move it to the top of the same note. ---
        const sameTop = await resetFile('edge-same-top.md', 'one two three');
        const sameTopEditor = await openAndGetEditor(sameTop);
        sameTopEditor.setSelection(sameTopEditor.offsetToPos(8), sameTopEditor.offsetToPos(13));
        app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
        await sleep(SETTLE_IN_MILLISECONDS);
        app.commands.executeCommandById(`${pluginId}:move-marked-selection-to-top-of-file`);
        await waitUntil({ predicate: () => editorValueFor('edge-same-top.md')?.trimStart().startsWith('three') === true });
        await sleep(SETTLE_IN_MILLISECONDS);
        const sameTopNote = editorValueFor('edge-same-top.md') ?? '';

        // --- Same-note top with frontmatter: the moved text lands after the frontmatter, not above it. ---
        const withFm = await resetFile('edge-frontmatter-top.md', '---\ntitle: T\n---\nalpha beta gamma');
        const withFmEditor = await openAndGetEditor(withFm);
        const gammaOffset = withFmEditor.getValue().indexOf('gamma');
        withFmEditor.setSelection(withFmEditor.offsetToPos(gammaOffset), withFmEditor.offsetToPos(gammaOffset + 'gamma'.length));
        app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
        await sleep(SETTLE_IN_MILLISECONDS);
        app.commands.executeCommandById(`${pluginId}:move-marked-selection-to-top-of-file`);
        await waitUntil({ predicate: () => wasMovedAboveMarker('edge-frontmatter-top.md', 'gamma', 'alpha') });
        await sleep(SETTLE_IN_MILLISECONDS);
        const withFmNote = editorValueFor('edge-frontmatter-top.md') ?? '';

        // --- Cross-note bottom: mark in the source, move it to the bottom of the (different) active note. ---
        const crossSource = await resetFile('edge-cross-source.md', 'keep MOVEME keep');
        const crossSourceEditor = await openAndGetEditor(crossSource);
        crossSourceEditor.setSelection(crossSourceEditor.offsetToPos(5), crossSourceEditor.offsetToPos(11));
        app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
        await sleep(SETTLE_IN_MILLISECONDS);
        const crossTarget = await resetFile('edge-cross-target.md', 'target body');
        await openAndGetEditor(crossTarget);
        app.commands.executeCommandById(`${pluginId}:move-marked-selection-to-bottom-of-file`);
        await waitUntil({ predicate: () => editorValueFor('edge-cross-target.md')?.includes('MOVEME') === true });
        await sleep(SETTLE_IN_MILLISECONDS);
        const crossTargetNote = editorValueFor('edge-cross-target.md') ?? '';
        const crossSourceNote = editorValueFor('edge-cross-source.md') ?? await app.vault.read(crossSource);

        // --- Same-note footnote integrity: a selection carrying a footnote ref keeps ref + definition. ---
        const footnote = await resetFile('edge-footnote.md', 'intro claim[^1] end\n\n[^1]: the definition');
        const footnoteEditor = await openAndGetEditor(footnote);
        footnoteEditor.setSelection(footnoteEditor.offsetToPos(6), footnoteEditor.offsetToPos(15));
        app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
        await sleep(SETTLE_IN_MILLISECONDS);
        app.commands.executeCommandById(`${pluginId}:move-marked-selection-to-bottom-of-file`);
        await waitUntil({ predicate: () => editorValueFor('edge-footnote.md')?.trimEnd().endsWith('claim[^1]') === true });
        await sleep(SETTLE_IN_MILLISECONDS);
        const footnoteNote = editorValueFor('edge-footnote.md') ?? '';

        return { crossSourceNote, crossTargetNote, footnoteNote, sameBottomNote, sameTopNote, withFmNote };

        function wasMovedAboveMarker(path: string, moved: string, marker: string): boolean {
          const value = editorValueFor(path);
          if (value === undefined) {
            return false;
          }
          const movedIndex = value.indexOf(moved);
          const markerIndex = value.indexOf(marker);
          return movedIndex !== -1 && markerIndex !== -1 && movedIndex < markerIndex;
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

    // Same-note bottom: "one" cut from the front, appended to the end, exactly once, no self-link.
    expect(result.sameBottomNote).toContain('one');
    expect(result.sameBottomNote.startsWith('one ')).toBe(false);
    expect(result.sameBottomNote.trimEnd().endsWith('one')).toBe(true);
    expect(result.sameBottomNote.match(/one/g)?.length).toBe(1);
    expect(result.sameBottomNote).not.toContain('[[edge-same-bottom');

    // Same-note top: "three" cut from the end, prepended to the top, exactly once.
    expect(result.sameTopNote).toContain('three');
    expect(result.sameTopNote.trimStart().startsWith('three')).toBe(true);
    expect(result.sameTopNote.match(/three/g)?.length).toBe(1);

    // Same-note top with frontmatter: frontmatter preserved at the very top; the moved text lands below it.
    expect(result.withFmNote.startsWith('---\ntitle: T\n---')).toBe(true);
    expect(result.withFmNote.match(/gamma/g)?.length).toBe(1);
    expect(result.withFmNote.indexOf('gamma')).toBeGreaterThan(result.withFmNote.indexOf('title: T'));

    // Cross-note bottom: moved to the end of the active target, removed from the source.
    expect(result.crossTargetNote).toContain('MOVEME');
    expect(result.crossTargetNote.indexOf('MOVEME')).toBeGreaterThan(result.crossTargetNote.indexOf('target body'));
    expect(result.crossSourceNote).not.toContain('MOVEME');

    // Same-note footnote move: the ref and its definition both survive (no rename, no dangling ref).
    expect(result.footnoteNote).toContain('[^1]');
    expect(result.footnoteNote).toContain('[^1]: the definition');
    expect(result.footnoteNote).not.toContain('[^1-1]');
    expect(result.footnoteNote.trimEnd().endsWith('claim[^1]')).toBe(true);
  });
});
