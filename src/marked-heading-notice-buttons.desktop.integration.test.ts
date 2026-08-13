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

describe('marked heading notice buttons', () => {
  it('should offer the heading-only actions and drive each of them after cancelling the mark', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingItem, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
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

        /*
         * The recursive split's up-front confirmation is what this suite drives instead of letting the split
         * run, so the dialog must be on even if another suite left the toggle off in the shared vault.
         */
        const wasOriginalShouldAsk = await didSetToggle('Should ask before splitting', true);
        try {
          const sourceFile = await resetFile(SOURCE_PATH, SOURCE_CONTENT);

          // A plain SELECTION mark: the two heading actions must NOT be offered, since there is no heading
          // The buttons could act on.
          const selectionEditor = await openAndGetEditor(sourceFile);
          selectionEditor.setSelection(selectionEditor.offsetToPos(0), selectionEditor.offsetToPos(5));
          app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
          await waitUntil({
            message: 'the marked-selection notice did not appear for the selection mark',
            predicate: () => readNoticeButtonLabels().length > 0
          });
          const selectionMarkLabels = readNoticeButtonLabels();
          await cancelMove();

          const headingMarkLabels = await markHeading(sourceFile);

          // `Split heading recursively...` — hands off to the existing command, which needs the mark (and its
          // Mutation-blocking lock on the note) released first.
          clickNoticeButton('Split heading recursively...');
          await waitUntil({
            message: 'the scoped split confirmation dialog did not open',
            predicate: () => findModalEl('Split heading recursively') !== null
          });
          const splitModalEl = findModalEl('Split heading recursively');
          const splitDialogText = splitModalEl?.querySelector('.modal-content')?.textContent ?? '';
          // Waited for rather than sampled: `Notice.hide()` animates the element out, so the notice is
          // Still in the DOM for a moment after the mark is released.
          const wasMarkReleasedBySplit = await didNoticeGoAway();
          closeModal(splitModalEl);

          // `Reorder headings...` — the same handoff into the other existing command.
          await markHeading(sourceFile);
          clickNoticeButton('Reorder headings...');
          await waitUntil({
            message: 'the reorder-headings dialog did not open',
            predicate: () => findModalEl('Reorder headings') !== null
          });
          const reorderModalEl = findModalEl('Reorder headings');
          const reorderDialogText = reorderModalEl?.querySelector('.modal-content')?.textContent ?? '';
          const wasMarkReleasedByReorder = await didNoticeGoAway();
          closeModal(reorderModalEl);

          return {
            headingMarkLabels,
            reorderDialogText,
            selectionMarkLabels,
            splitDialogText,
            wasMarkReleasedByReorder,
            wasMarkReleasedBySplit
          };
        } finally {
          await didSetToggle('Should ask before splitting', wasOriginalShouldAsk);
        }

        async function markHeading(file: TFile): Promise<string[]> {
          const editor = await openAndGetEditor(file);
          editor.setCursor({ ch: 0, line: CURSOR_LINE });
          await waitUntil({
            message: 'metadata cache did not index the source headings',
            predicate: () => (app.metadataCache.getFileCache(file)?.headings ?? []).length === EXPECTED_HEADING_COUNT
          });
          app.commands.executeCommandById(`${pluginId}:mark-heading-to-move`);
          await waitUntil({
            message: 'the marked-selection notice did not appear for the heading mark',
            predicate: () => readNoticeButtonLabels().length > 0
          });
          return readNoticeButtonLabels();
        }

        /**
         * Waits for the marked-selection notice to disappear, reporting whether it did within the timeout —
         * the observable proof that the handoff released the mark (and its lock on the note).
         *
         * @returns Whether the notice went away.
         */
        async function didNoticeGoAway(): Promise<boolean> {
          const NOTICE_TIMEOUT_IN_MILLISECONDS = 5000;
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

        async function cancelMove(): Promise<void> {
          app.commands.executeCommandById(`${pluginId}:cancel-move`);
          await waitUntil({
            message: 'the marked-selection notice did not go away',
            predicate: () => readNoticeButtonLabels().length === 0
          });
        }

        function readNoticeButtonLabels(): string[] {
          const containerEl = activeDocument.querySelector('.advanced-note-composer-move-notice-buttons');
          if (!containerEl) {
            return [];
          }
          return [...containerEl.querySelectorAll('button')].map((buttonEl) => buttonEl.textContent);
        }

        function clickNoticeButton(label: string): void {
          const containerEl = activeDocument.querySelector('.advanced-note-composer-move-notice-buttons');
          const buttonEl = [...containerEl?.querySelectorAll('button') ?? []].find((el) => el.textContent === label);
          if (!(buttonEl instanceof HTMLElement)) {
            throw new TypeError(`The "${label}" notice button was not found.`);
          }
          buttonEl.click();
        }

        // Scoped by title: a fresh vault also shows the plugin's release-notes modal, so a document-wide
        // `.modal-content` read picks that one up instead.
        function findModalEl(title: string): Element | null {
          return [...activeDocument.querySelectorAll('.modal')]
            .find((el) => el.querySelector('.modal-title')?.textContent === title) ?? null;
        }

        function closeModal(modalEl: Element | null): void {
          const cancelButtonEl = [...modalEl?.querySelectorAll('button') ?? []].find((el) => el.textContent === 'Cancel');
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
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor !== undefined
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          return view.editor;
        }

        async function didSetToggle(name: string, shouldEnable: boolean): Promise<boolean> {
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
        }
      },
      input: { findSettingItem: findSettingItemInObsidian, pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // A plain selection mark keeps exactly the buttons it always had.
    expect(result.selectionMarkLabels).not.toContain('Split heading recursively...');
    expect(result.selectionMarkLabels).not.toContain('Reorder headings...');
    expect(result.selectionMarkLabels).toContain('Cancel move');

    // A heading mark adds the two heading-only actions.
    expect(result.headingMarkLabels).toContain('Split heading recursively...');
    expect(result.headingMarkLabels).toContain('Reorder headings...');

    // Each button drove the EXISTING command against the marked heading, and released the mark to do it.
    expect(result.splitDialogText).toContain('NoticeB1');
    expect(result.splitDialogText).not.toContain('NoticeA');
    expect(result.wasMarkReleasedBySplit).toBe(true);
    expect(result.reorderDialogText).toContain('NoticeB');
    expect(result.wasMarkReleasedByReorder).toBe(true);
  });
});
