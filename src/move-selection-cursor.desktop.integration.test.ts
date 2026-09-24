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

import { findSettingItemInObsidian } from './settings-tab-navigation.ts';

// Desktop-only: an editor-selection behavior on a move flow, matching the plugin's established
// integration convention (no Android emulator wired). Version coverage: pure editor-API behavior (`setSelection`)
// with no dependence on minified Obsidian internals / version-sensitive DOM / serialization, so
// public-latest verification is sufficient.
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

/**
 * Runs ONE move scenario in Obsidian and reports where the cursor landed.
 *
 * The three scenarios used to share a single closure, which declared 122 400 ms of waiting against the
 * transport's ~30 s per-closure cap: five ceilings apiece, charged three times over, so the eval could only
 * ever die as a bare `script timeout` naming the harness rather than the wait that overran. The scenarios
 * are independent and each resets its own notes, so the loop belongs in NODE, where no cap applies to the
 * sequence - one scenario per eval leaves each closure declaring about a third of what the cap allows.
 * @param commandToRun - The move command to run, without the plugin-id prefix.
 * @param cursorOffset - Where to put the cursor in the target first, or `null` to leave it be.
 * @returns The active note and its selection once the move has landed.
 */
async function moveAndReadSelection(commandToRun: string, cursorOffset: null | number): Promise<MoveResult> {
  return evalInObsidian({
    async callback({ app, command, lib: { waitUntil }, obsidianModule, pluginId, targetCursorOffset }): Promise<MoveResult> {
      /**
       * Sized so the SUM of every wait this closure declares stays under the transport's ~30 s per-closure
       * cap, not at it. Five ceilings share it - two editor opens, the moved text arriving, the cursor
       * landing, and the settle - and each of those steps lands in well under a second on a healthy
       * machine. Adding an `openAndGetEditor` call adds a whole ceiling: re-divide this budget by the new
       * call count, not by the `waitUntil` calls the body shows.
       */
      const WAIT_TIMEOUT_IN_MILLISECONDS = 3000;
      const SETTLE_IN_MILLISECONDS = 400;

      const source = await resetFile('cursor-move-source.md', 'AAA MOVED CCC');
      const target = await resetFile('cursor-move-target.md', 'target end');

      // Mark "MOVED" (offsets 4..9) in the source.
      const sourceEditor = await openAndGetEditor(source);
      sourceEditor.setSelection(sourceEditor.offsetToPos(4), sourceEditor.offsetToPos(9));
      app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
      await sleep(SETTLE_IN_MILLISECONDS);

      // Make the target the active note (the move target), then run the move command.
      const targetEditor = await openAndGetEditor(target);
      if (targetCursorOffset !== null) {
        targetEditor.setCursor(targetEditor.offsetToPos(targetCursorOffset));
      }
      app.commands.executeCommandById(`${pluginId}:${command}`);

      // The move opens the target; wait for the moved text to arrive there.
      await waitUntil({
        message: `moved text did not arrive in the target for ${command}`,
        predicate: () => activeEditorValue()?.includes('MOVED') === true,
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
      });

      // Then wait for the cursor to land on the moved content (the composer selects it once the
      // target editor is ready). Capture the state at the moment the wait succeeds — the selection
      // is the observable effect under test, so the wait IS the assertion.
      let activeFilePath = '';
      let selection = '';
      await waitUntil({
        message: `cursor did not select the moved text in the target for ${command}`,
        predicate: () => {
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          activeFilePath = view?.file?.path ?? '';
          selection = view?.editor.getSelection() ?? '';
          // Require the TARGET to be active (the source transiently shows the restored marked
          // selection mid-operation, which also reads as 'MOVED').
          return activeFilePath === target.path && selection === 'MOVED';
        },
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
      });

      // Let the workspace settle before the next scenario opens files again.
      await sleep(SETTLE_IN_MILLISECONDS);
      return { activeFilePath, selection };

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
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
        if (!view) {
          throw new Error('No active markdown view.');
        }
        return view.editor;
      }
    },
    input: { command: commandToRun, pluginId: PLUGIN_ID, targetCursorOffset: cursorOffset },
    vaultPath: getTemporaryVault().path
  });
}

describe('cursor follows the moved content (issue #144)', () => {
  it('selects the moved text in the target for move-here, move-to-top, and move-to-bottom', async () => {
    const atCursor = await moveAndReadSelection('move-marked-selection-here', 7);
    const toTop = await moveAndReadSelection('move-marked-selection-to-top-of-file', null);
    const toBottom = await moveAndReadSelection('move-marked-selection-to-bottom-of-file', null);

    // Every move lands in the target note, and the editor selection covers exactly the moved text.
    expect(atCursor.activeFilePath).toBe('cursor-move-target.md');
    expect(atCursor.selection).toBe('MOVED');

    expect(toTop.activeFilePath).toBe('cursor-move-target.md');
    expect(toTop.selection).toBe('MOVED');

    expect(toBottom.activeFilePath).toBe('cursor-move-target.md');
    expect(toBottom.selection).toBe('MOVED');
  });

  it('lands on the moved text at the bottom, not on an identical copy earlier in the target (issue #175)', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }): Promise<OccurrenceResult> {
        /**
         * Sized so the SUM of every wait this closure declares stays under the transport's ~30 s per-closure
         * cap, not at it. Three ceilings share it - one per `openAndGetEditor` call and the cursor landing -
         * so at the 15 s each of them used to hold the closure declared 45 400 ms and could only ever die as
         * a bare transport timeout, which names the harness rather than the wait that overran. Each step is
         * a note opening or the composer selecting what it just moved, both well under a second. Adding an
         * `openAndGetEditor` call adds a whole ceiling: re-divide this budget by the new call count, not by
         * the `waitUntil` calls the body shows.
         */
        const WAIT_TIMEOUT_IN_MILLISECONDS = 8000;
        const SETTLE_IN_MILLISECONDS = 400;
        // The target already contains the moved text — with the same blank-line prefix the default
        // template adds — BEFORE the paste cursor, which sits at the very end of the note. That is the
        // reporter's note shape: moving to the top looked right only because the moved copy happened to
        // be the first match.
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
        // not throw away what was already seen.
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
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
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
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          return view.editor;
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
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
      async callback({ app, findSettingItem, lib: { waitUntil }, obsidianModule, pluginId }): Promise<NoticeFeedbackResult> {
        /**
         * Sized so the SUM of every wait this closure declares stays under the transport's ~30 s per-closure
         * cap, not at it. Three ceilings share it - one per `openAndGetEditor` call and the completion
         * notice appearing - so at the 15 s each of them used to hold the closure declared 46 600 ms and
         * could only ever die as a bare transport timeout, which names the harness rather than the wait that
         * overran. Each step is a note opening or a notice rendering, both well under a second. Adding an
         * `openAndGetEditor` call adds a whole ceiling: re-divide this budget by the new call count, not by
         * the `waitUntil` calls the body shows.
         */
        const WAIT_TIMEOUT_IN_MILLISECONDS = 7500;
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
          // into `activeDocument`, not `document`.
          let movedTextOffset = -1;
          let noticeTexts: string[] = [];
          let selection = '';
          let selectionStartOffset = -1;
          await waitUntil({
            message: 'completion notice did not appear for the Notice feedback mode',
            predicate: () => {
              noticeTexts = [...activeDocument.querySelectorAll('.notice')].map((el) => el.textContent);
              if (noticeTexts.every((text) => !text.includes('Moved the marked selection into'))) {
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
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
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
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
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

          const settingItem = await findSettingItem({ app, name: settingName, settingTab });
          const selectEl = settingItem?.querySelector('select');
          if (!(selectEl instanceof HTMLSelectElement)) {
            throw new TypeError(`"${settingName}" dropdown was not found.`);
          }

          const option = [...selectEl.options].find((el) => el.text === optionText);
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
      input: { findSettingItem: findSettingItemInObsidian, pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    expect(result.noticeTexts.some((text) => text.includes('Moved the marked selection into'))).toBe(true);
    // The cursor landed on the moved text, but nothing is highlighted.
    expect(result.selection).toBe('');
    expect(result.movedTextOffset).toBeGreaterThanOrEqual(0);
    expect(result.selectionStartOffset).toBe(result.movedTextOffset);
  });

  // The off case, plus the proof that a move AT THE CURSOR ignores these settings entirely. The test
  // above is the positive control: it proves this harness DOES observe the jump when the settings are
  // on, so an empty selection here is a real absence rather than a missed window.
  it('leaves the cursor alone for edge moves when their jump settings are off, but still jumps at the cursor', async () => {
    await setJumpToggles(false);
    try {
      // Both edge moves stay put...
      const toBottom = await moveAndReadSelectionWithoutWaitingForAJump('move-marked-selection-to-bottom-of-file', null);
      const toTop = await moveAndReadSelectionWithoutWaitingForAJump('move-marked-selection-to-top-of-file', null);
      // ...while a move at the cursor jumps anyway, with BOTH toggles still off.
      const atCursor = await moveAndReadSelectionWithoutWaitingForAJump('move-marked-selection-here', 7);

      // Each move still happened — the wait inside only proceeds once the moved text is in the target and
      // the target is the active note — but the edge moves left the cursor alone.
      expect(toBottom.activeFilePath).toBe('cursor-no-jump-target.md');
      expect(toBottom.selection).toBe('');

      expect(toTop.activeFilePath).toBe('cursor-no-jump-target.md');
      expect(toTop.selection).toBe('');

      // A move at the cursor is not configurable and jumps regardless of those two toggles.
      expect(atCursor.activeFilePath).toBe('cursor-no-jump-target.md');
      expect(atCursor.selection).toBe('MOVED');
    } finally {
      // Leave the shared instance on the defaults for the suites that follow.
      await setJumpToggles(true);
    }
  });
});

/**
 * Runs ONE move scenario and reads the selection back once the move has landed and the jump window has
 * passed - the shape the "no jump" case needs, where an empty selection is the observation.
 *
 * The three scenarios used to share a single closure, which declared 146 400 ms of waiting against the
 * transport's ~30 s per-closure cap, so the eval could only ever die as a bare `script timeout` naming the
 * harness rather than the wait that overran. Each scenario resets its own notes, so the loop belongs in
 * NODE, where no cap applies to the sequence.
 * @param commandToRun - The move command to run, without the plugin-id prefix.
 * @param cursorOffset - Where to put the cursor in the target first, or `null` to leave it be.
 * @returns The active note and its selection once the jump window has closed.
 */
async function moveAndReadSelectionWithoutWaitingForAJump(commandToRun: string, cursorOffset: null | number): Promise<MoveResult> {
  return evalInObsidian({
    async callback({ app, command, lib: { waitUntil }, obsidianModule, pluginId, targetCursorOffset }): Promise<MoveResult> {
      /**
       * Sized so the SUM of every wait this closure declares stays under the transport's ~30 s per-closure
       * cap, not at it. Three ceilings share it - one per `openAndGetEditor` call and the moved text
       * arriving - alongside the two fixed delays below, and each of those steps lands in well under a
       * second. Adding an `openAndGetEditor` call adds a whole ceiling: re-divide this budget by the new
       * call count, not by the `waitUntil` calls the body shows.
       */
      const WAIT_TIMEOUT_IN_MILLISECONDS = 7000;
      const SETTLE_IN_MILLISECONDS = 400;
      // Comfortably past the jump's own timings (200 ms before the target opens, then a poll for the
      // moved content that gives up after 2 s), so an empty selection cannot just mean "not yet".
      const PAST_JUMP_DELAY_IN_MILLISECONDS = 3000;

      const source = await resetFile('cursor-no-jump-source.md', 'AAA MOVED CCC');
      const target = await resetFile('cursor-no-jump-target.md', 'target end');

      // Mark "MOVED" (offsets 4..9) in the source.
      const sourceEditor = await openAndGetEditor(source);
      sourceEditor.setSelection(sourceEditor.offsetToPos(4), sourceEditor.offsetToPos(9));
      app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
      await sleep(SETTLE_IN_MILLISECONDS);

      const targetEditor = await openAndGetEditor(target);
      if (targetCursorOffset !== null) {
        targetEditor.setCursor(targetEditor.offsetToPos(targetCursorOffset));
      }
      app.commands.executeCommandById(`${pluginId}:${command}`);

      // Wait for the move to actually land in the target and the target to be the active note (the
      // source transiently shows the restored marked selection mid-operation).
      await waitUntil({
        message: `moved text did not arrive in the active target note for ${command}`,
        predicate: () => {
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          return view?.file?.path === target.path && view.editor.getValue().includes('MOVED');
        },
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
      });
      await sleep(PAST_JUMP_DELAY_IN_MILLISECONDS);

      const activeView = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
      return {
        activeFilePath: activeView?.file?.path ?? '',
        selection: activeView?.editor.getSelection() ?? ''
      };

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
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
        if (!view) {
          throw new Error('No active markdown view.');
        }
        return view.editor;
      }
    },
    input: { command: commandToRun, pluginId: PLUGIN_ID, targetCursorOffset: cursorOffset },
    vaultPath: getTemporaryVault().path
  });
}

/**
 * Flips both "jump to content moved to the edge" toggles through the REAL settings tab, the way a user does.
 *
 * Its own eval rather than a step inside each scenario: the settings are shared-instance state that has to
 * be set once around all three moves, and folding it into the scenario closure would charge its waiting
 * against the same per-closure cap the split below exists to stay under.
 * @param isJumpEnabled - What to leave both toggles set to.
 */
async function setJumpToggles(isJumpEnabled: boolean): Promise<void> {
  await evalInObsidian({
    async callback({ app, findSettingItem, pluginId, shouldEnable }): Promise<void> {
      const RENDER_DELAY_IN_MILLISECONDS = 150;
      const EDIT_SAVE_DELAY_IN_MILLISECONDS = 300;
      const SETTING_NAMES = [
        'Should jump to content moved to top of file',
        'Should jump to content moved to bottom of file'
      ];

      for (const settingName of SETTING_NAMES) {
        app.setting.open();
        app.setting.openTabById(pluginId);
        const settingTab = app.setting.pluginTabs.find((tab) => tab.id === pluginId);
        if (!settingTab) {
          throw new Error('Settings tab was not found.');
        }
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        const settingItem = await findSettingItem({ app, name: settingName, settingTab });
        const toggleEl = settingItem?.querySelector('.checkbox-container');
        if (!(toggleEl instanceof HTMLElement)) {
          throw new TypeError(`"${settingName}" toggle was not found.`);
        }

        if (toggleEl.classList.contains('is-enabled') !== shouldEnable) {
          toggleEl.click();
          await sleep(EDIT_SAVE_DELAY_IN_MILLISECONDS);
        }

        app.setting.close();
        await sleep(RENDER_DELAY_IN_MILLISECONDS);
      }
    },
    input: { findSettingItem: findSettingItemInObsidian, pluginId: PLUGIN_ID, shouldEnable: isJumpEnabled },
    vaultPath: getTemporaryVault().path
  });
}
