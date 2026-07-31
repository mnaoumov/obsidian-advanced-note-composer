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

interface NoticeFeedbackResult {
  readonly movedTextOffset: number;
  readonly noticeTexts: string[];
  readonly selection: string;
  readonly selectionStartOffset: number;
}

interface OccurrenceResult {
  readonly activeFilePath: string;
  readonly firstOccurrenceOffset: number;
  readonly lastOccurrenceOffset: number;
  readonly selection: string;
  readonly selectionStartOffset: number;
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

          // Then wait for the cursor to land on the moved content (the composer selects it once the
          // Target editor is ready). Capture the state at the moment the wait succeeds — the selection
          // Is the observable effect under test, so the wait IS the assertion.
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

  it('lands on the moved text at the bottom, not on an identical copy earlier in the target (issue #175)', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }): Promise<OccurrenceResult> {
        const SETTLE_IN_MILLISECONDS = 400;
        // The target already contains the moved text — with the same blank-line prefix the default
        // Template adds — BEFORE the paste cursor, which sits at the very end of the note. That is the
        // Reporter's note shape: moving to the top looked right only because the moved copy happened to
        // Be the first match.
        const TARGET_CONTENT = 'top\n\nMOVED here\n\nend';

        const source = await resetFile('cursor-occurrence-source.md', 'AAA MOVED CCC');
        const target = await resetFile('cursor-occurrence-target.md', TARGET_CONTENT);

        const sourceEditor = await openAndGetEditor(source);
        sourceEditor.setSelection(sourceEditor.offsetToPos(4), sourceEditor.offsetToPos(9));
        app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
        await sleep(SETTLE_IN_MILLISECONDS);

        // Paste cursor at the very END of the target — the case that failed.
        const targetEditor = await openAndGetEditor(target);
        targetEditor.setCursor(targetEditor.offsetToPos(TARGET_CONTENT.length));
        app.commands.executeCommandById(`${pluginId}:move-marked-selection-here`);

        // Capture the observations as the wait succeeds and assert on them OUTSIDE, so a timeout does
        // Not throw away what was already seen.
        let activeFilePath = '';
        let firstOccurrenceOffset = -1;
        let lastOccurrenceOffset = -1;
        let selection = '';
        let selectionStartOffset = -1;
        await waitUntil({
          message: 'cursor did not select the moved text in the target',
          predicate: () => {
            const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
            activeFilePath = view?.file?.path ?? '';
            selection = view?.editor.getSelection() ?? '';
            if (!view || activeFilePath !== target.path || selection !== 'MOVED') {
              return false;
            }
            const value = view.editor.getValue();
            firstOccurrenceOffset = value.indexOf('MOVED');
            lastOccurrenceOffset = value.lastIndexOf('MOVED');
            selectionStartOffset = view.editor.posToOffset(view.editor.getCursor('from'));
            return true;
          },
          timeoutInMilliseconds: 15_000
        });

        return { activeFilePath, firstOccurrenceOffset, lastOccurrenceOffset, selection, selectionStartOffset };

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

    expect(result.activeFilePath).toBe('cursor-occurrence-target.md');
    expect(result.selection).toBe('MOVED');
    // There really are two copies, so the assertion below is not vacuous.
    expect(result.firstOccurrenceOffset).toBeLessThan(result.lastOccurrenceOffset);
    // The cursor is on the copy that was just moved (the last one), not on the pre-existing one.
    expect(result.selectionStartOffset).toBe(result.lastOccurrenceOffset);
  });

  it('places a collapsed cursor and shows a notice in Notice feedback mode (issue #176)', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }): Promise<NoticeFeedbackResult> {
        const SETTLE_IN_MILLISECONDS = 400;
        const FEEDBACK_SETTING_NAME = 'Smart cut & paste completion feedback';

        await setDropdown(FEEDBACK_SETTING_NAME, 'Notice');
        try {
          const source = await resetFile('cursor-notice-source.md', 'AAA MOVED CCC');
          const target = await resetFile('cursor-notice-target.md', 'target end');

          const sourceEditor = await openAndGetEditor(source);
          sourceEditor.setSelection(sourceEditor.offsetToPos(4), sourceEditor.offsetToPos(9));
          app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
          await sleep(SETTLE_IN_MILLISECONDS);

          const targetEditor = await openAndGetEditor(target);
          targetEditor.setCursor(targetEditor.offsetToPos(7));
          app.commands.executeCommandById(`${pluginId}:move-marked-selection-here`);

          // Notices auto-hide, so read them as the wait succeeds rather than afterwards. Notices render
          // Into `activeDocument`, not `document`.
          let movedTextOffset = -1;
          let noticeTexts: string[] = [];
          let selection = '';
          let selectionStartOffset = -1;
          await waitUntil({
            message: 'completion notice did not appear for the Notice feedback mode',
            predicate: () => {
              noticeTexts = Array.from(activeDocument.querySelectorAll('.notice')).map((el) => el.textContent);
              if (!noticeTexts.some((text) => text.includes('Moved the marked selection into'))) {
                return false;
              }
              const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
              if (view?.file?.path !== target.path) {
                return false;
              }
              movedTextOffset = view.editor.getValue().indexOf('MOVED');
              selection = view.editor.getSelection();
              selectionStartOffset = view.editor.posToOffset(view.editor.getCursor('from'));
              return true;
            },
            timeoutInMilliseconds: 15_000
          });

          return { movedTextOffset, noticeTexts, selection, selectionStartOffset };
        } finally {
          // Leave the shared instance on the default for the suites that follow.
          await setDropdown(FEEDBACK_SETTING_NAME, 'Select moved content');
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

        // Drives the REAL settings tab, so the dropdown is exercised the way a user changes it.
        async function setDropdown(settingName: string, optionText: string): Promise<void> {
          const RENDER_DELAY_IN_MILLISECONDS = 150;
          const EDIT_SAVE_DELAY_IN_MILLISECONDS = 300;

          app.setting.open();
          app.setting.openTabById(pluginId);
          const settingTab = app.setting.pluginTabs.find((tab) => tab.id === pluginId);
          if (!settingTab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const settingItems = Array.from(settingTab.containerEl.querySelectorAll('.setting-item'));
          const settingItem = settingItems.find((el) => el.querySelector('.setting-item-name')?.textContent === settingName);
          const selectEl = settingItem?.querySelector('select');
          if (!(selectEl instanceof HTMLSelectElement)) {
            throw new Error(`"${settingName}" dropdown was not found.`);
          }

          const option = Array.from(selectEl.options).find((el) => el.text === optionText);
          if (!option) {
            throw new Error(`"${optionText}" option was not found in "${settingName}".`);
          }
          if (selectEl.value !== option.value) {
            selectEl.value = option.value;
            selectEl.dispatchEvent(new Event('change'));
            await sleep(EDIT_SAVE_DELAY_IN_MILLISECONDS);
          }

          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        }
      },
      vaultPath: getTempVault().path
    });

    expect(result.noticeTexts.some((text) => text.includes('Moved the marked selection into'))).toBe(true);
    // The cursor landed on the moved text, but nothing is highlighted.
    expect(result.selection).toBe('');
    expect(result.movedTextOffset).toBeGreaterThanOrEqual(0);
    expect(result.selectionStartOffset).toBe(result.movedTextOffset);
  });

  // The off case, plus the proof that a move AT THE CURSOR ignores these settings entirely. The test
  // Above is the positive control: it proves this harness DOES observe the jump when the settings are
  // On, so an empty selection here is a real absence rather than a missed window.
  it('leaves the cursor alone for edge moves when their jump settings are off, but still jumps at the cursor', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const SETTLE_IN_MILLISECONDS = 400;
        // Comfortably past the jump's own timings (200 ms before the target opens, then a poll for the
        // Moved content that gives up after 2 s), so an empty selection cannot just mean "not yet".
        const PAST_JUMP_DELAY_IN_MILLISECONDS = 3000;
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
