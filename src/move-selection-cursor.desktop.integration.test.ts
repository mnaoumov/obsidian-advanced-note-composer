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

// Desktop-only: an editor-selection behavior on a move flow, matching the plugin's established
// Integration convention (no Android emulator wired). G99: pure editor-API behavior (`setSelection`)
// With no dependence on minified Obsidian internals / version-sensitive DOM / serialization, so
// Public-latest verification is sufficient.
// Isolation: `npx vitest run --project integration-tests:desktop src/move-selection-cursor.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface MoveResult {
  readonly activeFilePath: string;
  readonly selection: string;
}

describe('cursor follows the moved content (issue #144)', () => {
  it('selects the moved text in the target for move-here, move-to-top, and move-to-bottom', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const SETTLE_IN_MILLISECONDS = 400;

        const atCursor = await markMoveAndReadSelection('move-marked-selection-here', 7);
        const toTop = await markMoveAndReadSelection('move-marked-selection-to-top-of-file');
        const toBottom = await markMoveAndReadSelection('move-marked-selection-to-bottom-of-file');

        return { atCursor, toBottom, toTop };

        async function markMoveAndReadSelection(command: string, targetCursorOffset?: number): Promise<MoveResult> {
          const source = await resetFile('cursor-move-source.md', 'AAA MOVED CCC');
          const target = await resetFile('cursor-move-target.md', 'target end');

          // Mark "MOVED" (offsets 4..9) in the source.
          const sourceEditor = await openAndGetEditor(source);
          sourceEditor.setSelection(sourceEditor.offsetToPos(4), sourceEditor.offsetToPos(9));
          app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
          await sleep(SETTLE_IN_MILLISECONDS);

          // Make the target the active note (the move target), then run the move command.
          const targetEditor = await openAndGetEditor(target);
          if (targetCursorOffset !== undefined) {
            targetEditor.setCursor(targetEditor.offsetToPos(targetCursorOffset));
          }
          app.commands.executeCommandById(`${pluginId}:${command}`);

          // The move opens the target; wait for the moved text to arrive there.
          await waitUntil({
            message: `moved text did not arrive in the target for ${command}`,
            predicate: () => activeEditorValue()?.includes('MOVED') === true
          });

          // Then wait for the cursor to land on the moved content (the composer selects it after a
          // Settle delay once the target editor is ready). Capture the state at the moment the wait
          // Succeeds — the selection is the observable effect under test, so the wait IS the assertion.
          // Then wait for the cursor to land on the moved content (the composer selects it after a
          // Settle delay once the target editor is ready). Capture the state at the moment the wait
          // Succeeds — the selection is the observable effect under test, so the wait IS the assertion.
          let activeFilePath = '';
          let selection = '';
          await waitUntil({
            message: `cursor did not select the moved text in the target for ${command}`,
            predicate: () => {
              const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
              activeFilePath = view?.file?.path ?? '';
              selection = view?.editor.getSelection() ?? '';
              // Require the TARGET to be active (the source transiently shows the restored marked
              // Selection mid-operation, which also reads as 'MOVED').
              return activeFilePath === target.path && selection === 'MOVED';
            },
            timeoutInMilliseconds: 5000
          });

          // Let the workspace settle before the next scenario opens files again.
          await sleep(SETTLE_IN_MILLISECONDS);
          return { activeFilePath, selection };
        }

        function activeEditorValue(): string | undefined {
          return app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor.getValue();
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
          await waitUntil({
            message: `editor for ${file.path} did not become active`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path,
            timeoutInMilliseconds: 15_000
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          return view.editor;
        }
      },
      vaultPath: getTempVault().path
    });

    // Every move lands in the target note, and the editor selection covers exactly the moved text.
    expect(result.atCursor.activeFilePath).toBe('cursor-move-target.md');
    expect(result.atCursor.selection).toBe('MOVED');

    expect(result.toTop.activeFilePath).toBe('cursor-move-target.md');
    expect(result.toTop.selection).toBe('MOVED');

    expect(result.toBottom.activeFilePath).toBe('cursor-move-target.md');
    expect(result.toBottom.selection).toBe('MOVED');
  });
});
