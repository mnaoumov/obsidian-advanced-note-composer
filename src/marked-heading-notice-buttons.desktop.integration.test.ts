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

const PLUGIN_ID = 'advanced-note-composer';
const SOURCE_PATH = 'marked-heading-notice-source.md';
const SOURCE_CONTENT = [
  'Intro text',
  '',
  '## NoticeA',
  '',
  'body of NoticeA',
  '',
  '## NoticeB',
  '',
  'body of NoticeB',
  '',
  '### NoticeB1',
  '',
  'body of NoticeB1',
  '',
  '## NoticeC',
  '',
  'body of NoticeC',
  ''
].join('\n');
// Inside `NoticeB`'s body — the enclosing heading is the one the mark resolves.
const CURSOR_LINE = 8;
const EXPECTED_HEADING_COUNT = 4;
const ASK_BEFORE_SPLITTING_TOGGLE = 'Should ask before splitting';

/**
 * What driving one heading-only notice button observed.
 */
interface HeadingActionResult {
  /**
   * The text of the dialog the button's command opened.
   */
  readonly dialogText: string;

  /**
   * The notice's button labels as the heading mark was made, before the button was clicked.
   */
  readonly labels: string[];

  /**
   * Whether the notice went away, which is the observable proof that the handoff released the mark.
   */
  readonly wasMarkReleased: boolean;
}

describe('marked heading notice buttons', () => {
  it('should offer the heading-only actions and drive each of them after cancelling the mark', async () => {
    /*
     * The recursive split's up-front confirmation is what this suite drives instead of letting the split
     * run, so the dialog must be on even if another suite left the toggle off in the shared vault.
     */
    const wasOriginalShouldAsk = await didSetToggle(ASK_BEFORE_SPLITTING_TOGGLE, true);
    try {
      // A plain SELECTION mark: the two heading actions must NOT be offered, since there is no heading
      // the buttons could act on.
      const selectionMarkLabels = await readSelectionMarkLabels();

      // Each button hands off to the existing command, which needs the mark (and its mutation-blocking lock
      // on the note) released first.
      const split = await driveHeadingAction('Split heading recursively...', 'Split heading recursively');
      const reorder = await driveHeadingAction('Reorder headings...', 'Reorder headings');

      // A plain selection mark keeps exactly the buttons it always had.
      expect(selectionMarkLabels).not.toContain('Split heading recursively...');
      expect(selectionMarkLabels).not.toContain('Reorder headings...');
      expect(selectionMarkLabels).toContain('Cancel move');

      // A heading mark adds the two heading-only actions.
      expect(split.labels).toContain('Split heading recursively...');
      expect(split.labels).toContain('Reorder headings...');

      // Each button drove the EXISTING command against the marked heading, and released the mark to do it.
      expect(split.dialogText).toContain('NoticeB1');
      expect(split.dialogText).not.toContain('NoticeA');
      expect(split.wasMarkReleased).toBe(true);
      expect(reorder.dialogText).toContain('NoticeB');
      expect(reorder.wasMarkReleased).toBe(true);
    } finally {
      await didSetToggle(ASK_BEFORE_SPLITTING_TOGGLE, wasOriginalShouldAsk);
    }
  });
});

/**
 * Flips one toggle through the REAL settings tab, reporting what it was set to before.
 * @param toggleName - The toggle's displayed name.
 * @param isEnabledWanted - What to leave it set to.
 * @returns Whether the toggle was enabled before this call.
 */
async function didSetToggle(toggleName: string, isEnabledWanted: boolean): Promise<boolean> {
  return evalInObsidian({
    async callback({ app, findSettingItem, name, pluginId, shouldEnable }): Promise<boolean> {
      const RENDER_DELAY_IN_MILLISECONDS = 400;

      app.setting.open();
      app.setting.openTabById(pluginId);
      const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
      if (!tab) {
        throw new Error('Settings tab was not found.');
      }
      await sleep(RENDER_DELAY_IN_MILLISECONDS);

      const item = await findSettingItem({ app, name, settingTab: tab });
      const toggle = item?.querySelector('.checkbox-container');
      if (!(toggle instanceof HTMLElement)) {
        throw new TypeError(`"${name}" toggle was not found.`);
      }
      const wasEnabled = toggle.classList.contains('is-enabled');
      if (wasEnabled !== shouldEnable) {
        toggle.click();
        await sleep(RENDER_DELAY_IN_MILLISECONDS);
      }
      app.setting.close();
      await sleep(RENDER_DELAY_IN_MILLISECONDS);
      return wasEnabled;
    },
    input: { findSettingItem: findSettingItemInObsidian, name: toggleName, pluginId: PLUGIN_ID, shouldEnable: isEnabledWanted },
    vaultPath: getTemporaryVault().path
  });
}

/**
 * Marks the heading under the cursor, clicks one of the heading-only notice buttons, and reports what the
 * command it hands off to opened.
 *
 * One eval per button rather than both inside one closure: together with the selection-mark phase they
 * declared 67 400 ms of waiting against the transport's ~30 s per-closure cap, because a helper's ceiling
 * is charged once per CALL SITE, so the eval could only ever die as a bare `script timeout` naming the
 * harness rather than the wait that overran. The phases share nothing but the note, so the sequencing
 * belongs in NODE, where no cap applies to it.
 * @param label - The notice button to click.
 * @param title - The title of the dialog that button's command is expected to open.
 * @returns The notice labels, the dialog's text, and whether the mark was released.
 */
async function driveHeadingAction(label: string, title: string): Promise<HeadingActionResult> {
  return evalInObsidian({
    async callback({
      app,
      buttonLabel,
      cursorLine,
      expectedHeadingCount,
      lib: { waitUntil },
      modalTitle,
      obsidianModule,
      pluginId,
      sourceContent,
      sourcePath
    }): Promise<HeadingActionResult> {
      /**
       * Sized so the SUM of every wait this closure declares stays under the transport's ~30 s per-closure
       * cap, not at it. Four ceilings share it - the editor opening, the headings being indexed, the notice
       * appearing, and the dialog opening - plus the notice's own disappearance below. Each is a DOM or
       * cache change a frame or two after the command that causes it.
       */
      const WAIT_TIMEOUT_IN_MILLISECONDS = 3000;
      // `Notice.hide()` animates the element out, so the notice is still in the DOM for a moment after the
      // mark is released. This one gives up rather than throwing, because whether it went away is the
      // observation - so it is the one wait here that must be allowed to run out.
      const NOTICE_TIMEOUT_IN_MILLISECONDS = 5000;

      const sourceFile = await resetFile(sourcePath, sourceContent);
      const editor = await openAndGetEditor(sourceFile);
      editor.setCursor({ ch: 0, line: cursorLine });
      await waitUntil({
        message: 'metadata cache did not index the source headings',
        predicate: () => (app.metadataCache.getFileCache(sourceFile)?.headings ?? []).length === expectedHeadingCount,
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
      });
      app.commands.executeCommandById(`${pluginId}:mark-heading-to-move`);
      await waitUntil({
        message: 'the marked-selection notice did not appear for the heading mark',
        predicate: () => readNoticeButtonLabels().length > 0,
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
      });
      const labels = readNoticeButtonLabels();

      clickNoticeButton(buttonLabel);
      await waitUntil({
        message: `the ${modalTitle} dialog did not open`,
        predicate: () => findModalEl() !== null,
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
      });
      const modalEl = findModalEl();
      const dialogText = modalEl?.querySelector('.modal-content')?.textContent ?? '';
      const wasMarkReleased = await didNoticeGoAway();
      closeModal(modalEl);

      return { dialogText, labels, wasMarkReleased };

      async function didNoticeGoAway(): Promise<boolean> {
        try {
          await waitUntil({
            message: 'the marked-selection notice is still up',
            predicate: () => readNoticeButtonLabels().length === 0,
            timeoutInMilliseconds: NOTICE_TIMEOUT_IN_MILLISECONDS
          });
          return true;
        } catch {
          return false;
        }
      }

      function readNoticeButtonLabels(): string[] {
        const containerEl = activeDocument.querySelector('.advanced-note-composer-move-notice-buttons');
        return containerEl ? [...containerEl.querySelectorAll('button')].map((buttonEl) => buttonEl.textContent) : [];
      }

      function clickNoticeButton(buttonText: string): void {
        const containerEl = activeDocument.querySelector('.advanced-note-composer-move-notice-buttons');
        const buttonEl = [...containerEl?.querySelectorAll('button') ?? []].find((el) => el.textContent === buttonText);
        if (!(buttonEl instanceof HTMLElement)) {
          throw new TypeError(`The "${buttonText}" notice button was not found.`);
        }
        buttonEl.click();
      }

      // Scoped by title: a fresh vault also shows the plugin's release-notes modal, so a document-wide
      // `.modal-content` read picks that one up instead.
      function findModalEl(): Element | null {
        return [...activeDocument.querySelectorAll('.modal')]
          .find((el) => el.querySelector('.modal-title')?.textContent === modalTitle) ?? null;
      }

      function closeModal(modalElToClose: Element | null): void {
        const cancelButtonEl = [...modalElToClose?.querySelectorAll('button') ?? []].find((el) => el.textContent === 'Cancel');
        if (!(cancelButtonEl instanceof HTMLElement)) {
          throw new TypeError('The "Cancel" button was not found.');
        }
        cancelButtonEl.click();
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
          message: 'markdown editor did not open',
          predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor !== undefined,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
        if (!view) {
          throw new Error('No active markdown view.');
        }
        return view.editor;
      }
    },
    input: {
      buttonLabel: label,
      cursorLine: CURSOR_LINE,
      expectedHeadingCount: EXPECTED_HEADING_COUNT,
      modalTitle: title,
      pluginId: PLUGIN_ID,
      sourceContent: SOURCE_CONTENT,
      sourcePath: SOURCE_PATH
    },
    vaultPath: getTemporaryVault().path
  });
}

/**
 * Marks a plain selection and reports the labels the move notice offers for it, then cancels the mark.
 * @returns The notice's button labels for a selection mark.
 */
async function readSelectionMarkLabels(): Promise<string[]> {
  return evalInObsidian({
    async callback({ app, lib: { waitUntil }, obsidianModule, pluginId, sourceContent, sourcePath }): Promise<string[]> {
      /**
       * Sized so the SUM of every wait this closure declares stays under the transport's ~30 s per-closure
       * cap, not at it. Three ceilings share it - the editor opening, the notice appearing, and the notice
       * going away again - and each is a DOM change a frame or two after the command that causes it.
       */
      const WAIT_TIMEOUT_IN_MILLISECONDS = 3000;

      const sourceFile = await resetFile(sourcePath, sourceContent);
      const selectionEditor = await openAndGetEditor(sourceFile);
      selectionEditor.setSelection(selectionEditor.offsetToPos(0), selectionEditor.offsetToPos(5));
      app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
      await waitUntil({
        message: 'the marked-selection notice did not appear for the selection mark',
        predicate: () => readNoticeButtonLabels().length > 0,
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
      });
      const labels = readNoticeButtonLabels();

      app.commands.executeCommandById(`${pluginId}:cancel-move`);
      await waitUntil({
        message: 'the marked-selection notice did not go away',
        predicate: () => readNoticeButtonLabels().length === 0,
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
      });
      return labels;

      function readNoticeButtonLabels(): string[] {
        const containerEl = activeDocument.querySelector('.advanced-note-composer-move-notice-buttons');
        return containerEl ? [...containerEl.querySelectorAll('button')].map((buttonEl) => buttonEl.textContent) : [];
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
          message: 'markdown editor did not open',
          predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor !== undefined,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
        if (!view) {
          throw new Error('No active markdown view.');
        }
        return view.editor;
      }
    },
    input: { pluginId: PLUGIN_ID, sourceContent: SOURCE_CONTENT, sourcePath: SOURCE_PATH },
    vaultPath: getTemporaryVault().path
  });
}
