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

// Desktop-only: it reads a rendered notice out of the DOM and clicks it, neither of which the Android
// transport covers.
// Isolation: `npx vitest run --project integration-tests:desktop src/extract-notice-link.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: ExtractNoticeLinkSettings;
}

interface ExtractNoticeLinkSettings {
  shouldAskBeforeSplitting: boolean;
  shouldOpenTargetNoteAfterSplit: boolean;
  shouldShowOperationNotices: boolean;
}

interface SettingsCarrier {
  editAndSave: (editor: (settings: ExtractNoticeLinkSettings) => void) => Promise<void>;
  settings: ExtractNoticeLinkSettings;
}

/*
 * Issue #232: the destination link of an extract's completion notice used to open the note at its top,
 * leaving the reporter to hunt for what they had just extracted. Clicking it must now land them ON that
 * content and highlight the note in the file explorer.
 *
 * Driven with `shouldOpenTargetNoteAfterSplit` OFF on purpose: with it on the destination is already open
 * and active, and the test would pass without the link having done anything at all.
 */
describe('extract completion notice link (issue #232)', () => {
  it('jumps to the extracted content and reveals the destination when clicked', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { clickMouse, pressKey, waitUntil }, obsidianModule, pluginId }) {
        /**
         * Sized so the SUM of every wait this closure declares stays under the transport's ~30 s per-closure
         * cap, not at it. Before this shared budget it declared 51 000 ms, so the eval could only ever die
         * as a bare transport timeout - which names the harness rather than the wait that overran. Every step
         * waited for here settles in well under a second on a healthy machine. A helper that waits is charged
         * once per CALL SITE, so adding a call to one adds a whole ceiling: re-divide this budget by the new
         * count, not by the `waitUntil` calls the body shows.
         */
        const WAIT_TIMEOUT_IN_MILLISECONDS = 2500;
        // Kept well under the 30 s a single `evalInObsidian` closure gets, even if both waits time out.
        const OPEN_TIMEOUT_IN_MILLISECONDS = 5000;
        const SETTLE_BEFORE_CLICK_IN_MILLISECONDS = 1000;
        /**
         * How long after the selection appears the focus is read again. The file explorer's reveal takes the
         * focus in two steps, the second a frame later, so a read the instant the selection shows up can
         * precede the step that undoes it (issue #263 reopened: 5.11.0 passed here and failed for the user).
         */
        const SETTLE_AFTER_REVEAL_IN_MILLISECONDS = 500;
        const EXTRACTED_TEXT = 'EXTRACTED-BY-ISSUE-232';
        const DESTINATION_BASENAME = 'issue-232-destination';
        const DESTINATION_PATH = `${DESTINATION_BASENAME}.md`;
        const SOURCE_CONTENT = `first line\n${EXTRACTED_TEXT}\nlast line`;

        const seenNoticeTexts = new Set<string>();
        const settingsComponent = findSettingsComponent();
        const originalSettings = {
          shouldAskBeforeSplitting: settingsComponent.settings.shouldAskBeforeSplitting,
          shouldOpenTargetNoteAfterSplit: settingsComponent.settings.shouldOpenTargetNoteAfterSplit,
          shouldShowOperationNotices: settingsComponent.settings.shouldShowOperationNotices
        };
        try {
          await settingsComponent.editAndSave((settings) => {
            // No confirmation dialog in the way, and the destination deliberately NOT opened by the split
            // itself — the notice link is the only thing that can open it.
            settings.shouldAskBeforeSplitting = false;
            settings.shouldOpenTargetNoteAfterSplit = false;
            settings.shouldShowOperationNotices = true;
          });

          await trashIfExists(DESTINATION_PATH);
          const source = await resetFile('issue-232-source.md', SOURCE_CONTENT);
          const sourceEditor = await openAndGetEditor(source);
          // Reset through the EDITOR, not the vault: an open buffer would keep the previous run's text and
          // the offsets below would then select the wrong characters.
          sourceEditor.setValue(SOURCE_CONTENT);
          const startOffset = SOURCE_CONTENT.indexOf(EXTRACTED_TEXT);
          sourceEditor.setSelection(
            sourceEditor.offsetToPos(startOffset),
            sourceEditor.offsetToPos(startOffset + EXTRACTED_TEXT.length)
          );

          app.commands.executeCommandById(`${pluginId}:extract-current-selection`);
          await createDestinationFromPicker(DESTINATION_BASENAME);

          const noticeLinkEl = await waitForNoticeLink(DESTINATION_PATH);

          // The notice can be up before the metadata cache has indexed the note the split just created,
          // and a wikilink to a path the cache does not know yet resolves as unresolved — so clicking it
          // would take the "create the note" branch instead of opening the one that is already there.
          await waitUntil({
            message: `metadata cache never indexed ${DESTINATION_PATH}`,
            predicate: () => {
              const destination = app.vault.getFileByPath(DESTINATION_PATH);
              return destination !== null && app.metadataCache.getFileCache(destination) !== null;
            },
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          // Let the vault settle before clicking. The split has just created, written and re-read notes,
          // and Obsidian's own open into the middle of that reaction shows the note before its content is
          // there — the same race `open-after-operation.ts` centralizes its delay for. A real user cannot
          // click a notice within milliseconds of it rendering; without this pause the suite hit an empty
          // destination editor in roughly half its runs, which is the open being early, not the jump
          // failing.
          await sleep(SETTLE_BEFORE_CLICK_IN_MILLISECONDS);

          // The explorer has to be on screen for its reveal to compete for the focus, as it is in the
          // reporter's video.
          app.workspace.leftSplit.expand();
          const fileExplorerLeaf = app.workspace.getLeavesOfType('file-explorer')[0];
          if (fileExplorerLeaf) {
            await app.workspace.revealLeaf(fileExplorerLeaf);
          }

          const activeBeforeClick = app.workspace.getActiveFile()?.path ?? '';
          await clickLink(noticeLinkEl);

          // Give-up wrapper around both waits: the assertions below report what the click actually
          // achieved, and a throw out of this closure would discard exactly that evidence.
          try {
            await waitUntil({
              message: 'the destination note did not open',
              predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === DESTINATION_PATH,
              // Above the 5 s default: the open is Obsidian's own, behind a freshly created note and a
              // metadata cache still settling, and it was seen to exceed 5 s on a loaded machine.
              timeoutInMilliseconds: OPEN_TIMEOUT_IN_MILLISECONDS
            });
            await waitUntil({
              // The selection is applied by a poll that has to see the destination's editor first, so it is
              // waited for rather than read the instant the note opens.
              message: 'the extracted content was never selected in the destination',
              predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor.getSelection() !== '',
              timeoutInMilliseconds: OPEN_TIMEOUT_IN_MILLISECONDS
            });
          } catch {
            // Reported through the returned state.
          }

          /*
           * Issue #263: the SECOND click has to re-select the content, exactly as the first did. Collapse
           * the selection first so a stale one from the first click cannot pass for a fresh reveal.
           */
          const selectionAfterFirstClick = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor.getSelection() ?? '';
          await sleep(SETTLE_AFTER_REVEAL_IN_MILLISECONDS);
          const focusAfterFirstClick = readDestinationFocus();
          const viewBeforeSecondClick = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          viewBeforeSecondClick?.editor.setCursor({ ch: 0, line: 0 });
          await clickLink(noticeLinkEl);
          try {
            await waitUntil({
              message: 'the extracted content was never re-selected on the second click',
              predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor.getSelection() !== '',
              timeoutInMilliseconds: OPEN_TIMEOUT_IN_MILLISECONDS
            });
          } catch {
            // Reported through the returned state.
          }
          const selectionAfterSecondClick = readDestinationSelection();
          await sleep(SETTLE_AFTER_REVEAL_IN_MILLISECONDS);
          const focusAfterSecondClick = readDestinationFocus();
          // The point of #263: the editor is BACK, so the selection is something the user can see. A
          // repeat click leaves the file explorer active without this.
          const isMarkdownViewActiveAfterSecondClick = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView) !== null;

          return {
            activeBeforeClick,
            activeFileAfterClick: app.workspace.getActiveFile()?.path ?? '',
            // Reported alongside the selection so a failure says WHICH thing went wrong: an empty editor is
            // Obsidian's open having raced the write, a populated one with no selection is the jump.
            destinationEditorValue: app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor.getValue() ?? '',
            // Read after the reveal has had time to finish: the ACTIVE leaf and the editor's own focus are
            // what decide whether the selection is drawn at all.
            focusAfterFirstClick,
            focusAfterSecondClick,
            // `getActiveViewOfType` answers `null` once a non-markdown leaf (the file explorer) is the
            // active one, which is exactly the focus question `revealInFolder` raises — it "opens the view
            // if it is not already open/visible".
            isMarkdownViewActive: app.workspace.getActiveViewOfType(obsidianModule.MarkdownView) !== null,
            isMarkdownViewActiveAfterSecondClick,
            noticeTexts: [...seenNoticeTexts],
            revealedPaths: [...activeDocument.querySelectorAll<HTMLElement>('.nav-file-title.is-active')]
              .map((el) => el.dataset['path'] ?? ''),
            selectionAfterClick: selectionAfterFirstClick,
            selectionAfterFirstClick,
            selectionAfterSecondClick,
            wasNoticeLinkFound: noticeLinkEl !== null
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            Object.assign(settings, originalSettings);
          });
        }

        /**
         * Drives the destination picker into creating the note the extract writes to.
         *
         * A brand-new note rather than a pre-made one on purpose: creating from a typed name is the ordinary
         * way an extract names its destination, and it keeps this suite from depending on how the picker
         * ranks existing notes.
         *
         * @param basename - The destination note's name.
         */
        async function createDestinationFromPicker(basename: string): Promise<void> {
          await waitUntil({ message: 'picker did not open', predicate: () => activeDocument.querySelector('.prompt-input') !== null, timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS });
          const inputEl = activeDocument.querySelector('.prompt-input');
          if (!(inputEl instanceof HTMLInputElement)) {
            throw new TypeError('No picker input.');
          }
          inputEl.value = basename;
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));

          // `Mod+Enter` chooses with no item at all, which is the same path the `Enter to create` row takes —
          // and unlike that row it is always available, since the row is pushed only when the search matched
          // nothing whatsoever.
          inputEl.focus();
          await pressKey({ key: 'Enter', modifiers: ['Mod'] });
        }

        /**
         * Clicks the link with TRUSTED mouse input. A synthetic `click()` is not good enough here: it is what
         * let 5.11.0 pass this suite while every real repeat click left the file explorer holding the focus.
         *
         * The link can wrap onto a second line inside the notice, so its bounding box's centre can land on the
         * SOURCE link on the line above; the centre of its last line box is always on the link itself.
         *
         * @param linkEl - The link, or `null` when the notice never showed one.
         */
        async function clickLink(linkEl: HTMLElement | null): Promise<void> {
          const lineBoxes = linkEl ? [...linkEl.getClientRects()] : [];
          const lastLineBox = lineBoxes.at(-1);
          if (lastLineBox) {
            await clickMouse({ x: lastLineBox.x + lastLineBox.width / 2, y: lastLineBox.y + lastLineBox.height / 2 });
          }
        }

        /**
         * Where the focus is once the click has settled, as one string so a failure names the whole state.
         *
         * @returns `<active leaf's view type>|<does the destination's editor have the focus>`.
         */
        function readDestinationFocus(): string {
          let hasFocus = false;
          for (const leaf of app.workspace.getLeavesOfType('markdown')) {
            const view = leaf.view;
            if (view instanceof obsidianModule.MarkdownView && view.file?.path === DESTINATION_PATH) {
              hasFocus = view.editor.hasFocus();
            }
          }
          return `${app.workspace.getActiveViewOfType(obsidianModule.View)?.getViewType() ?? ''}|${String(hasFocus)}`;
        }

        /**
         * The destination note's own editor selection, found by PATH rather than through the active view:
         * the notice's link reveals the file in the explorer, which can leave the explorer as the active
         * leaf — and `getActiveViewOfType` then answers `null` for a selection that is perfectly fine.
         *
         * @returns The selected text in the destination's editor, or an empty string.
         */
        function readDestinationSelection(): string {
          for (const leaf of app.workspace.getLeavesOfType('markdown')) {
            const view = leaf.view;
            if (view instanceof obsidianModule.MarkdownView && view.file?.path === DESTINATION_PATH) {
              return view.editor.getSelection();
            }
          }
          return '';
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

        async function openAndGetEditor(file: TFile): Promise<Editor> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error(`No markdown view for ${file.path}.`);
          }
          return view.editor;
        }

        async function resetFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          return await app.vault.create(path, content);
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }

        /**
         * Finds the destination link inside this run's completion notice. Notices render into
         * `activeDocument`, never `document`.
         *
         * @param path - The destination note's path.
         * @returns The anchor to click, or `null` when no such notice appeared.
         */
        async function waitForNoticeLink(path: string): Promise<HTMLElement | null> {
          try {
            await waitUntil({
              message: 'no completion notice named the destination',
              predicate: () => findLink() !== null,
              timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
            });
          } catch {
            // Give-up wrapper: the caller reports what WAS observed, which a throw out of the closure
            // would discard.
            return null;
          }
          return findLink();

          function findLink(): HTMLElement | null {
            for (const noticeEl of activeDocument.querySelectorAll('.notice')) {
              // Accumulated across polls: a Notice auto-hides, so reading them only once at the end can
              // report an empty list for a notice that really did appear.
              seenNoticeTexts.add(noticeEl.textContent);
              // `includes`, not `startsWith`: `PluginNoticeComponent` puts the plugin's name on its own
              // line above the message.
              if (!noticeEl.textContent.includes('Split note ')) {
                continue;
              }
              for (const aEl of noticeEl.querySelectorAll('a')) {
                if (aEl.textContent.includes(path)) {
                  return aEl;
                }
              }
            }
            return null;
          }
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // Surfaced first: every later assertion is meaningless if the notice never named the destination.
    // Surfaced first: every later assertion is meaningless if the notice never named the destination, and
    // the accumulated notice texts are what says why.
    // Surfaced first: every later assertion is meaningless if the notice never named the destination, and
    // the accumulated notice texts are what says why.
    expect({ noticeTexts: result.noticeTexts, wasNoticeLinkFound: result.wasNoticeLinkFound })
      .toMatchObject({ wasNoticeLinkFound: true });
    // The click, and only the click, opened the destination.
    expect(result.activeBeforeClick).toBe('issue-232-source.md');
    expect(result.activeFileAfterClick).toBe('issue-232-destination.md');
    // It landed ON the extracted content rather than at the top of the note — the whole point of #232.
    expect({ destinationEditorValue: result.destinationEditorValue, selectionAfterClick: result.selectionAfterClick })
      .toMatchObject({ selectionAfterClick: 'EXTRACTED-BY-ISSUE-232' });
    // And the destination is highlighted in the file explorer, matching the folder-side behavior the
    // reporter asked for consistency with.
    // Issue #263: clicking again re-selects the content, so the notice keeps working as a way back to it
    // rather than only the first time.
    expect(result.selectionAfterSecondClick).toBe('EXTRACTED-BY-ISSUE-232');
    expect(result.isMarkdownViewActiveAfterSecondClick).toBe(true);
    // Issue #263 reopened: still true once the file explorer's reveal has finished, and the editor itself
    // holds the focus — the two things that make the selection VISIBLE. 5.11.0 failed both on every real
    // repeat click.
    expect(result.focusAfterFirstClick).toBe('markdown|true');
    expect(result.focusAfterSecondClick).toBe('markdown|true');

    expect(result.revealedPaths).toContain('issue-232-destination.md');
    // The editor is still the active view: `revealInFolder` "opens the view if it is not already
    // open/visible", so this is the assertion that it does not leave the user parked in the file explorer.
    expect(result.isMarkdownViewActive).toBe(true);
  });
});
