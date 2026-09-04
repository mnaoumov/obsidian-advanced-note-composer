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
// Transport covers.
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
  editAndSave(editor: (settings: ExtractNoticeLinkSettings) => void): Promise<void>;
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
      async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        // Kept well under the 30 s a single `evalInObsidian` closure gets, even if both waits time out.
        const OPEN_TIMEOUT_IN_MILLISECONDS = 10_000;
        const SETTLE_BEFORE_CLICK_IN_MILLISECONDS = 1000;
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
            // Itself — the notice link is the only thing that can open it.
            settings.shouldAskBeforeSplitting = false;
            settings.shouldOpenTargetNoteAfterSplit = false;
            settings.shouldShowOperationNotices = true;
          });

          await trashIfExists(DESTINATION_PATH);
          const source = await resetFile('issue-232-source.md', SOURCE_CONTENT);
          const sourceEditor = await openAndGetEditor(source);
          // Reset through the EDITOR, not the vault: an open buffer would keep the previous run's text and
          // The offsets below would then select the wrong characters.
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
          // And a wikilink to a path the cache does not know yet resolves as unresolved — so clicking it
          // Would take the "create the note" branch instead of opening the one that is already there.
          await waitUntil({
            message: `metadata cache never indexed ${DESTINATION_PATH}`,
            predicate: () => {
              const destination = app.vault.getFileByPath(DESTINATION_PATH);
              return destination !== null && app.metadataCache.getFileCache(destination) !== null;
            }
          });

          // Let the vault settle before clicking. The split has just created, written and re-read notes,
          // And Obsidian's own open into the middle of that reaction shows the note before its content is
          // There — the same race `open-after-operation.ts` centralizes its delay for. A real user cannot
          // Click a notice within milliseconds of it rendering; without this pause the suite hit an empty
          // Destination editor in roughly half its runs, which is the open being early, not the jump
          // Failing.
          await sleep(SETTLE_BEFORE_CLICK_IN_MILLISECONDS);

          const activeBeforeClick = app.workspace.getActiveFile()?.path ?? '';
          noticeLinkEl?.click();

          // Give-up wrapper around both waits: the assertions below report what the click actually
          // Achieved, and a throw out of this closure would discard exactly that evidence.
          try {
            await waitUntil({
              message: 'the destination note did not open',
              predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === DESTINATION_PATH,
              // Above the 5 s default: the open is Obsidian's own, behind a freshly created note and a
              // Metadata cache still settling, and it was seen to exceed 5 s on a loaded machine.
              timeoutInMilliseconds: OPEN_TIMEOUT_IN_MILLISECONDS
            });
            await waitUntil({
              // The selection is applied by a poll that has to see the destination's editor first, so it is
              // Waited for rather than read the instant the note opens.
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
          const viewBeforeSecondClick = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          viewBeforeSecondClick?.editor.setCursor({ ch: 0, line: 0 });
          noticeLinkEl?.click();
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
          // The point of #263: the editor is BACK, so the selection is something the user can see. A
          // Repeat click leaves the file explorer active without this.
          const isMarkdownViewActiveAfterSecondClick = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView) !== null;

          return {
            activeBeforeClick,
            activeFileAfterClick: app.workspace.getActiveFile()?.path ?? '',
            // Reported alongside the selection so a failure says WHICH thing went wrong: an empty editor is
            // Obsidian's open having raced the write, a populated one with no selection is the jump.
            destinationEditorValue: app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor.getValue() ?? '',
            // `getActiveViewOfType` answers `null` once a non-markdown leaf (the file explorer) is the
            // Active one, which is exactly the focus question `revealInFolder` raises — it "opens the view
            // If it is not already open/visible".
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
          await waitUntil({ message: 'picker did not open', predicate: () => activeDocument.querySelector('.prompt-input') !== null });
          const inputEl = activeDocument.querySelector('.prompt-input');
          if (!(inputEl instanceof HTMLInputElement)) {
            throw new TypeError('No picker input.');
          }
          inputEl.value = basename;
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));

          // `Mod+Enter` chooses with no item at all, which is the same path the `Enter to create` row takes —
          // And unlike that row it is always available, since the row is pushed only when the search matched
          // Nothing whatsoever ([[T880-P12]]).
          inputEl.focus();
          await pressKey({ key: 'Enter', modifiers: ['Mod'] });
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
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
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
              predicate: () => findLink() !== null
            });
          } catch {
            // Give-up wrapper: the caller reports what WAS observed, which a throw out of the closure
            // Would discard.
            return null;
          }
          return findLink();

          function findLink(): HTMLElement | null {
            for (const noticeEl of activeDocument.querySelectorAll('.notice')) {
              // Accumulated across polls: a Notice auto-hides, so reading them only once at the end can
              // Report an empty list for a notice that really did appear.
              seenNoticeTexts.add(noticeEl.textContent);
              // `includes`, not `startsWith`: `PluginNoticeComponent` puts the plugin's name on its own
              // Line above the message.
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
    // The accumulated notice texts are what says why.
    // Surfaced first: every later assertion is meaningless if the notice never named the destination, and
    // The accumulated notice texts are what says why.
    expect({ noticeTexts: result.noticeTexts, wasNoticeLinkFound: result.wasNoticeLinkFound })
      .toMatchObject({ wasNoticeLinkFound: true });
    // The click, and only the click, opened the destination.
    expect(result.activeBeforeClick).toBe('issue-232-source.md');
    expect(result.activeFileAfterClick).toBe('issue-232-destination.md');
    // It landed ON the extracted content rather than at the top of the note — the whole point of #232.
    expect({ destinationEditorValue: result.destinationEditorValue, selectionAfterClick: result.selectionAfterClick })
      .toMatchObject({ selectionAfterClick: 'EXTRACTED-BY-ISSUE-232' });
    // And the destination is highlighted in the file explorer, matching the folder-side behavior the
    // Reporter asked for consistency with.
    // Issue #263: clicking again re-selects the content, so the notice keeps working as a way back to it
    // Rather than only the first time.
    expect(result.selectionAfterSecondClick).toBe('EXTRACTED-BY-ISSUE-232');
    expect(result.isMarkdownViewActiveAfterSecondClick).toBe(true);

    expect(result.revealedPaths).toContain('issue-232-destination.md');
    // The editor is still the active view: `revealInFolder` "opens the view if it is not already
    // Open/visible", so this is the assertion that it does not leave the user parked in the file explorer.
    expect(result.isMarkdownViewActive).toBe(true);
  });
});
