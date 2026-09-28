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

// Desktop-only: it reads a rendered notice out of the DOM and clicks it with trusted mouse input, neither of
// which the Android transport covers.
// Isolation: `npx vitest run --project integration-tests:desktop src/move-notice-link.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: MoveNoticeLinkSettings;
}

interface MoveNoticeLinkSettings {
  shouldShowOperationNotices: boolean;
  smartCutAndPasteCompletionFeedback: string;
}

interface SettingsCarrier {
  editAndSave: (editor: (settings: MoveNoticeLinkSettings) => void) => Promise<void>;
  settings: MoveNoticeLinkSettings;
}

/*
 * Issue #300: the smart cut & paste completion notice (`Select moved content and show notice`) names the
 * destination with a link, and clicking that link is how a user gets back to what they moved. Issue #263
 * made the EXTRACT notice's link re-select the content on every click; this notice's link had no such
 * action, so the file explorer's reveal took the focus (the selection was drawn nowhere) and a click from
 * another note opened the destination at its top.
 *
 * Every click is judged by where it leaves the user: the destination's editor active and focused, holding
 * the moved text as its selection. Click 2 follows a click in the editor that collapses the selection, and
 * click 3 follows a trip back to the source note — the two ways a user loses the highlight before clicking
 * again.
 */
describe('smart cut & paste completion notice link (issue #300)', () => {
  it('re-selects the moved content on every click', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { clickMouse, waitUntil }, obsidianModule, pluginId }) {
        /**
         * Shared by the six waits below, so their sum stays well under the transport's ~30 s cap. Each one
         * settles in well under a second on a healthy machine.
         */
        const WAIT_TIMEOUT_IN_MILLISECONDS = 3000;
        const SETTLE_IN_MILLISECONDS = 300;
        /**
         * How long after a click the state is read. The explorer's reveal takes the focus in two steps, the
         * second a frame later, so an instant read could precede the step that undoes the selection.
         */
        const SETTLE_AFTER_CLICK_IN_MILLISECONDS = 1500;
        const MOVED_TEXT = 'MOVED-BY-ISSUE-300';
        const SOURCE_PATH = 'issue-300-source.md';
        const DESTINATION_PATH = 'issue-300-destination.md';

        const settingsComponent = findSettingsComponent();
        const originalSettings = {
          shouldShowOperationNotices: settingsComponent.settings.shouldShowOperationNotices,
          smartCutAndPasteCompletionFeedback: settingsComponent.settings.smartCutAndPasteCompletionFeedback
        };
        const states: string[] = [];
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldShowOperationNotices = true;
            settings.smartCutAndPasteCompletionFeedback = 'SelectMovedContentAndNotice';
          });

          const source = await createFile(SOURCE_PATH, `first line\n${MOVED_TEXT}\nlast line`);
          const destination = await createFile(DESTINATION_PATH, 'destination line 1\ndestination line 2\n');

          const sourceView = await openAndGetView(source);
          const startOffset = sourceView.editor.getValue().indexOf(MOVED_TEXT);
          sourceView.editor.setSelection(
            sourceView.editor.offsetToPos(startOffset),
            sourceView.editor.offsetToPos(startOffset + MOVED_TEXT.length)
          );
          app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
          await sleep(SETTLE_IN_MILLISECONDS);

          const destinationView = await openAndGetView(destination);
          destinationView.editor.setCursor({ ch: 0, line: 2 });
          app.commands.executeCommandById(`${pluginId}:move-marked-selection-here`);

          await waitUntil({
            message: 'no smart cut & paste completion notice named the destination',
            predicate: () => findNoticeLink() !== null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await sleep(SETTLE_IN_MILLISECONDS);

          // The explorer has to be on screen for its reveal to compete for the focus.
          app.workspace.leftSplit.expand();
          const fileExplorerLeaf = app.workspace.getLeavesOfType('file-explorer')[0];
          if (fileExplorerLeaf) {
            await app.workspace.revealLeaf(fileExplorerLeaf);
          }

          await clickNoticeLink();
          states.push(readDestinationState());

          // Click 2: the user clicked into the text first, collapsing the selection.
          const activeView = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          const firstLineEl = activeView?.contentEl.querySelector('.cm-line');
          if (firstLineEl) {
            const box = firstLineEl.getBoundingClientRect();
            await clickMouse({ x: box.x + 5, y: box.y + box.height / 2 });
            await sleep(SETTLE_IN_MILLISECONDS);
          }
          states.push(`between|${readDestinationState()}`);
          await clickNoticeLink();
          states.push(readDestinationState());

          // Click 3: the user went back to the source note, so the click has to open the destination again.
          await openAndGetView(source);
          await clickNoticeLink();
          states.push(readDestinationState());
        } finally {
          await settingsComponent.editAndSave((settings) => {
            Object.assign(settings, originalSettings);
          });
        }

        return { states };

        /**
         * Clicks the notice's destination link with TRUSTED mouse input — a synthetic `click()` is what let
         * issue #263's first fix pass while every real click lost the focus — and lets the reveal settle.
         * The centre of the link's LAST line box is clicked, because the link can wrap.
         */
        async function clickNoticeLink(): Promise<void> {
          const lastLineBox = [...findNoticeLink()?.getClientRects() ?? []].at(-1);
          if (lastLineBox) {
            await clickMouse({ x: lastLineBox.x + lastLineBox.width / 2, y: lastLineBox.y + lastLineBox.height / 2 });
          }
          await sleep(SETTLE_AFTER_CLICK_IN_MILLISECONDS);
        }

        async function createFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
          return await app.vault.create(path, content);
        }

        /**
         * Finds the destination link in the smart cut & paste completion notice. Notices render into
         * `activeDocument`, never `document`.
         *
         * @returns The link, or `null` while no such notice is up.
         */
        function findNoticeLink(): HTMLElement | null {
          for (const noticeEl of activeDocument.querySelectorAll('.notice')) {
            if (!noticeEl.textContent.includes('Moved the marked selection into')) {
              continue;
            }
            for (const aEl of noticeEl.querySelectorAll('a')) {
              if (aEl.textContent.includes(DESTINATION_PATH)) {
                return aEl;
              }
            }
          }
          return null;
        }

        function findSettingsComponent(): SettingsCarrier {
          const plugin = app.plugins.getPlugin(pluginId) as ComponentTreeNode | null;
          const queue: ComponentTreeNode[] = plugin ? [plugin] : [];
          while (queue.length > 0) {
            const node = queue.shift();
            if (!node) {
              continue;
            }
            if (isSettingsComponent(node)) {
              return node;
            }
            if (node._children) {
              queue.push(...node._children);
            }
          }
          throw new Error('Settings component was not found.');
        }

        function isSettingsComponent(node: ComponentTreeNode): node is SettingsCarrier {
          return typeof node.editAndSave === 'function' && typeof node.settings?.shouldShowOperationNotices === 'boolean';
        }

        async function openAndGetView(file: TFile): Promise<MarkdownView> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await sleep(SETTLE_IN_MILLISECONDS);
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error(`No markdown view for ${file.path}.`);
          }
          return view;
        }

        /**
         * Where the user is, as one string so a failure names the whole state.
         *
         * @returns `<active view type>|<active file>|<destination editor focused>|<destination selection>`.
         */
        function readDestinationState(): string {
          let hasFocus = false;
          let selection = '';
          for (const leaf of app.workspace.getLeavesOfType('markdown')) {
            const view = leaf.view;
            if (!(view instanceof obsidianModule.MarkdownView && view.file?.path === DESTINATION_PATH)) {
              continue;
            }
            hasFocus ||= view.editor.hasFocus();
            selection ||= view.editor.getSelection();
          }
          const viewType = app.workspace.getActiveViewOfType(obsidianModule.View)?.getViewType() ?? '';
          return `${viewType}|${app.workspace.getActiveFile()?.path ?? ''}|${String(hasFocus)}|${selection}`;
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    const expectedState = 'markdown|issue-300-destination.md|true|MOVED-BY-ISSUE-300';
    // The click-2 precondition is reported alongside, so a failure shows the selection really was gone.
    expect(result.states).toEqual([
      expectedState,
      'between|markdown|issue-300-destination.md|true|',
      expectedState,
      expectedState
    ]);
  });
});
