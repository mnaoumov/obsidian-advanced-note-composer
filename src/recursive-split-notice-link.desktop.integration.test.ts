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
// Isolation: `npx vitest run --project integration-tests:desktop src/recursive-split-notice-link.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: RecursiveSplitNoticeSettings;
}

interface RecursiveSplitNoticeSettings {
  shouldAskBeforeSplitting: boolean;
  shouldBlockVaultDuringOperations: boolean;
  shouldShowOperationNotices: boolean;
  shouldSplitRecursivelyIntoDefaultNewNoteFolder: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: RecursiveSplitNoticeSettings) => void): Promise<void>;
  settings: RecursiveSplitNoticeSettings;
}

/*
 * Issue #235: a recursive split's completion notice named only the note it had just split, so the reporter
 * was handed a link back to where they already were and no way into anything the split produced. It must
 * now name what it CREATED — the note the chosen heading became — while the notes split out of THAT one
 * stay counted rather than listed, which is the part the reporter raised themselves ("if there many
 * headers... not sure how to handle this case").
 */
describe('recursive split completion notice link (issue #235)', () => {
  it('names and opens the note the split created, not the note it split', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        // Kept well under the 30 s a single `evalInObsidian` closure gets, even if every wait times out.
        const OPEN_TIMEOUT_IN_MILLISECONDS = 10_000;
        const SETTLE_BEFORE_CLICK_IN_MILLISECONDS = 1000;
        const ROOT_HEADING = 'Issue 235 chapter';
        const NESTED_HEADING = 'Issue 235 section';
        const SOURCE_PATH = 'issue-235-source.md';
        // Both forced into a folder of their own name, which is what makes the recursion a folder tree.
        const ROOT_NOTE_PATH = `${ROOT_HEADING}/${ROOT_HEADING}.md`;
        const NESTED_NOTE_PATH = `${ROOT_HEADING}/${NESTED_HEADING}/${NESTED_HEADING}.md`;
        const SOURCE_CONTENT = `# ${ROOT_HEADING}\nchapter body\n\n## ${NESTED_HEADING}\nsection body\n`;
        const EXPECTED_HEADING_COUNT = 2;

        const seenNoticeTexts = new Set<string>();
        let completionNoticeText = '';
        const settingsComponent = findSettingsComponent();
        const originalSettings = {
          shouldAskBeforeSplitting: settingsComponent.settings.shouldAskBeforeSplitting,
          shouldShowOperationNotices: settingsComponent.settings.shouldShowOperationNotices,
          shouldSplitRecursivelyIntoDefaultNewNoteFolder: settingsComponent.settings.shouldSplitRecursivelyIntoDefaultNewNoteFolder
        };
        try {
          await settingsComponent.editAndSave((settings) => {
            // No confirmation dialog in the way, and the tree rooted beside the source rather than in
            // Obsidian's default new-note folder, so the produced paths are the ones asserted below.
            settings.shouldAskBeforeSplitting = false;
            settings.shouldShowOperationNotices = true;
            settings.shouldSplitRecursivelyIntoDefaultNewNoteFolder = false;
          });

          await trashIfExists(ROOT_HEADING);
          const source = await resetFile(SOURCE_PATH, SOURCE_CONTENT);
          const sourceEditor = await openAndGetEditor(source);
          // Reset through the EDITOR, not the vault: an open buffer would keep the previous run's text, and
          // The command would then split whatever that left behind.
          sourceEditor.setValue(SOURCE_CONTENT);
          // Inside the H1's section, which is the heading the command scopes itself to (issue #143).
          sourceEditor.setCursor({ ch: 0, line: 1 });

          // The command resolves its heading from the metadata cache, so running it before the cache has
          // Caught up with the text just written makes it silently do nothing.
          await waitUntil({
            message: `metadata cache never indexed the headings of ${SOURCE_PATH}`,
            predicate: () => (app.metadataCache.getFileCache(source)?.headings ?? []).length === EXPECTED_HEADING_COUNT
          });

          app.commands.executeCommandById(`${pluginId}:split-heading-recursively`);

          const noticeLinkEl = await waitForNoticeLink(ROOT_NOTE_PATH);

          // A wikilink to a path the cache does not know yet resolves as UNRESOLVED, and clicking that
          // Takes the "create the note" branch instead of opening the one the split just wrote.
          await waitUntil({
            message: `metadata cache never indexed ${ROOT_NOTE_PATH}`,
            predicate: () => {
              const createdNote = app.vault.getFileByPath(ROOT_NOTE_PATH);
              return createdNote !== null && app.metadataCache.getFileCache(createdNote) !== null;
            }
          });

          // The same settle the extract-notice suite needs: the split has just created, written and re-read
          // Notes, and an open into the middle of that reaction shows a note before its content is there.
          await sleep(SETTLE_BEFORE_CLICK_IN_MILLISECONDS);

          const activeBeforeClick = app.workspace.getActiveFile()?.path ?? '';
          noticeLinkEl?.click();

          // Give-up wrapper: the assertions below report what the click actually achieved, and a throw out
          // Of this closure would discard exactly that evidence.
          try {
            await waitUntil({
              message: 'the created note did not open',
              predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === ROOT_NOTE_PATH,
              timeoutInMilliseconds: OPEN_TIMEOUT_IN_MILLISECONDS
            });
          } catch {
            // Reported through the returned state.
          }

          return {
            activeBeforeClick,
            activeFileAfterClick: app.workspace.getActiveFile()?.path ?? '',
            completionNoticeText,
            // Proves the run really produced the deeper note the notice deliberately does not name.
            existingCreatedPaths: [ROOT_NOTE_PATH, NESTED_NOTE_PATH].filter((path) => app.vault.getFileByPath(path) !== null),
            noticeTexts: [...seenNoticeTexts],
            revealedPaths: [...activeDocument.querySelectorAll<HTMLElement>('.nav-file-title.is-active')]
              .map((el) => el.dataset['path'] ?? ''),
            // Read back rather than assumed: a value a registered validator refuses is dropped silently,
            // Which would send the run down a different path and blame the notice for it.
            settingsInEffect: {
              shouldAskBeforeSplitting: settingsComponent.settings.shouldAskBeforeSplitting,
              // This suite asserts on the NOTICE, so the blocking dialog must be off for it to exist.
              shouldBlockVaultDuringOperations: settingsComponent.settings.shouldBlockVaultDuringOperations,
              shouldShowOperationNotices: settingsComponent.settings.shouldShowOperationNotices,
              shouldSplitRecursivelyIntoDefaultNewNoteFolder: settingsComponent.settings.shouldSplitRecursivelyIntoDefaultNewNoteFolder
            },
            wasNoticeLinkFound: noticeLinkEl !== null
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            Object.assign(settings, originalSettings);
          });
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
         * Finds the created note's link inside this run's completion notice. Notices render into
         * `activeDocument`, never `document`.
         *
         * @param path - The created note's path.
         * @returns The anchor to click, or `null` when no such notice appeared.
         */
        async function waitForNoticeLink(path: string): Promise<HTMLElement | null> {
          try {
            await waitUntil({
              message: 'no completion notice named the created note',
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
              // The COMPLETION notice's verb. The progress notice opens with `Splitting heading
              // Recursively in`, so this never matches it.
              if (!noticeEl.textContent.includes('Split heading in ')) {
                continue;
              }
              completionNoticeText = noticeEl.textContent;
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

    // Surfaced first: every later assertion is meaningless if the notice never named the created note, and
    // The accumulated notice texts (plus the settings actually in effect) are what says why.
    expect({ noticeTexts: result.noticeTexts, settingsInEffect: result.settingsInEffect, wasNoticeLinkFound: result.wasNoticeLinkFound })
      .toMatchObject({
        settingsInEffect: {
          shouldAskBeforeSplitting: false,
          shouldBlockVaultDuringOperations: false,
          shouldShowOperationNotices: true,
          shouldSplitRecursivelyIntoDefaultNewNoteFolder: false
        },
        wasNoticeLinkFound: true
      });
    // Both notes were produced...
    expect(result.existingCreatedPaths).toEqual(['Issue 235 chapter/Issue 235 chapter.md', 'Issue 235 chapter/Issue 235 section/Issue 235 section.md']);
    // ...and the notice names the ROOT one while only COUNTING the one below it — the shape #235 settled
    // On, because a recursive split can produce a tree no corner notice could list.
    expect(result.completionNoticeText).toContain('into 2 note(s): ');
    expect(result.completionNoticeText).toContain('Issue 235 chapter/Issue 235 chapter.md');
    expect(result.completionNoticeText).not.toContain('Issue 235 section/Issue 235 section.md');
    // The run parks the user back on the note they invoked it on, so the click — and only the click —
    // Opened what the split created.
    expect(result.activeBeforeClick).toBe('issue-235-source.md');
    expect(result.activeFileAfterClick).toBe('Issue 235 chapter/Issue 235 chapter.md');
    // And the created note is highlighted in the file explorer, the way every notice link behaves (#232).
    expect(result.revealedPaths).toContain('Issue 235 chapter/Issue 235 chapter.md');
  });
});
