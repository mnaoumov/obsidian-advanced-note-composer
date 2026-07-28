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

import type { PluginSettingsTab } from './plugin-settings-tab.ts';

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

  // The off case, plus the proof that a move AT THE CURSOR ignores these settings entirely. The test
  // Above is the positive control: it proves this harness DOES observe the jump when the settings are
  // On, so an empty selection here is a real absence rather than a missed window.
  it('leaves the cursor alone for edge moves when their jump settings are off, but still jumps at the cursor', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const SETTLE_IN_MILLISECONDS = 400;
        // Comfortably past the jump's own delays (200 ms before the target opens + 300 ms before the
        // Selection is applied), so an empty selection cannot just mean "not yet".
        const PAST_JUMP_DELAY_IN_MILLISECONDS = 2000;
        const SETTING_NAMES = [
          'Should jump to content moved to top of file',
          'Should jump to content moved to bottom of file'
        ];

        for (const settingName of SETTING_NAMES) {
          await setToggle(settingName, false);
        }
        try {
          // Both edge moves stay put...
          const toBottom = await markMoveAndReadSelection('move-marked-selection-to-bottom-of-file');
          const toTop = await markMoveAndReadSelection('move-marked-selection-to-top-of-file');
          // ...while a move at the cursor jumps anyway, with BOTH toggles still off.
          const atCursor = await markMoveAndReadSelection('move-marked-selection-here', 7);
          return { atCursor, toBottom, toTop };
        } finally {
          // Leave the shared instance on the defaults for the suites that follow.
          for (const settingName of SETTING_NAMES) {
            await setToggle(settingName, true);
          }
        }

        async function markMoveAndReadSelection(command: string, targetCursorOffset?: number): Promise<MoveResult> {
          const source = await resetFile('cursor-no-jump-source.md', 'AAA MOVED CCC');
          const target = await resetFile('cursor-no-jump-target.md', 'target end');

          // Mark "MOVED" (offsets 4..9) in the source.
          const sourceEditor = await openAndGetEditor(source);
          sourceEditor.setSelection(sourceEditor.offsetToPos(4), sourceEditor.offsetToPos(9));
          app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
          await sleep(SETTLE_IN_MILLISECONDS);

          const targetEditor = await openAndGetEditor(target);
          if (targetCursorOffset !== undefined) {
            targetEditor.setCursor(targetEditor.offsetToPos(targetCursorOffset));
          }
          app.commands.executeCommandById(`${pluginId}:${command}`);

          // Wait for the move to actually land in the target and the target to be the active note (the
          // Source transiently shows the restored marked selection mid-operation).
          await waitUntil({
            message: `moved text did not arrive in the active target note for ${command}`,
            predicate: () => {
              const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
              return view?.file?.path === target.path && view.editor.getValue().includes('MOVED');
            },
            timeoutInMilliseconds: 15_000
          });
          await sleep(PAST_JUMP_DELAY_IN_MILLISECONDS);

          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          return {
            activeFilePath: view?.file?.path ?? '',
            selection: view?.editor.getSelection() ?? ''
          };
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

        // Drives the REAL settings tab, so the toggle is exercised the way a user flips it.
        async function setToggle(settingName: string, shouldEnable: boolean): Promise<void> {
          const RENDER_DELAY_IN_MILLISECONDS = 150;
          const EDIT_SAVE_DELAY_IN_MILLISECONDS = 300;

          app.setting.open();
          app.setting.openTabById(pluginId);
          const settingTab = app.setting.pluginTabs.find((tab) => tab.id === pluginId);
          if (!settingTab) {
            throw new Error('Settings tab was not found.');
          }
          (settingTab as PluginSettingsTab).displayLegacy();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const settingItems = Array.from(settingTab.containerEl.querySelectorAll('.setting-item'));
          const settingItem = settingItems.find((el) => el.querySelector('.setting-item-name')?.textContent === settingName);
          const toggleEl = settingItem?.querySelector('.checkbox-container');
          if (!(toggleEl instanceof HTMLElement)) {
            throw new Error(`"${settingName}" toggle was not found.`);
          }

          if (toggleEl.classList.contains('is-enabled') !== shouldEnable) {
            toggleEl.click();
            await sleep(EDIT_SAVE_DELAY_IN_MILLISECONDS);
          }

          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        }
      },
      vaultPath: getTempVault().path
    });

    // Each move still happened — the wait above only proceeds once the moved text is in the target and
    // The target is the active note — but the edge moves left the cursor alone.
    expect(result.toBottom.activeFilePath).toBe('cursor-no-jump-target.md');
    expect(result.toBottom.selection).toBe('');

    expect(result.toTop.activeFilePath).toBe('cursor-no-jump-target.md');
    expect(result.toTop.selection).toBe('');

    // A move at the cursor is not configurable and jumps regardless of those two toggles.
    expect(result.atCursor.activeFilePath).toBe('cursor-no-jump-target.md');
    expect(result.atCursor.selection).toBe('MOVED');
  });
});
