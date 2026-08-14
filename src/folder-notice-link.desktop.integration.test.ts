import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only: it reads a rendered notice out of the DOM and clicks it, neither of which the Android
// Transport covers.
// Isolation: `npx vitest run --project integration-tests:desktop src/folder-notice-link.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface MenuItemLike {
  dom?: HTMLElement;
}

interface MenuLike {
  hide(): void;
  items: MenuItemLike[];
}

/*
 * Issue #234: a folder name in an operation notice only highlighted the folder in the file explorer, leaving
 * the reporter in the explorer rather than in a document. Clicking it must now open that folder's folder
 * note, and highlight THAT — the reveal follows what the click opens, which is `obsidian-dev-utils`' own
 * behavior since 94.2.0 (it falls back to highlighting the folder when the note is hidden, or when the folder
 * has no note at all).
 *
 * Driven through `Rename folder...` because it is the folder operation whose target survives the operation
 * AND carries a folder note it keeps in step, so the notice's link names a folder that really has one.
 */
describe('folder operation notice link (issue #234)', () => {
  it('opens the folder note and highlights it when clicked', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule }) {
        // Kept well under the 30 s a single `evalInObsidian` closure gets, even if every wait times out.
        const OPEN_TIMEOUT_IN_MILLISECONDS = 10_000;
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const SETTLE_BEFORE_CLICK_IN_MILLISECONDS = 1000;
        const ROOT = 'Folder notice link';
        const OLD_FOLDER_NAME = '1. Alpha 234';
        const NEW_FOLDER_NAME = '1. Beta 234';
        const TYPED_NAME = 'Beta 234';
        const NEW_FOLDER_PATH = `${ROOT}/${NEW_FOLDER_NAME}`;
        const NEW_FOLDER_NOTE_PATH = `${NEW_FOLDER_PATH}/${NEW_FOLDER_NAME}.md`;
        const CONTROL_PATH = `${ROOT}/control.md`;

        const seenNoticeTexts = new Set<string>();

        // A folder note named after its folder — the `Auto` fallback layout, and the one the rename keeps in
        // Step, so it still IS the folder note under the new name.
        await removeFolder(ROOT);
        await app.vault.createFolder(ROOT);
        await app.vault.createFolder(`${ROOT}/${OLD_FOLDER_NAME}`);
        await app.vault.create(`${ROOT}/${OLD_FOLDER_NAME}/${OLD_FOLDER_NAME}.md`, 'Alpha folder note body\n');
        const control = await app.vault.create(CONTROL_PATH, 'control body\n');

        // Somewhere else to be clicked FROM: without it the folder note could be the active file already and
        // The assertion would pass without the link having done anything.
        await app.workspace.getLeaf(false).openFile(control);
        await waitUntil({
          message: 'the control note did not open',
          predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === CONTROL_PATH
        });

        const folder = app.vault.getFolderByPath(`${ROOT}/${OLD_FOLDER_NAME}`);
        if (!(folder instanceof obsidianModule.TFolder)) {
          throw new TypeError(`No folder at ${ROOT}/${OLD_FOLDER_NAME}.`);
        }

        // Driven through the folder MENU, which is how the command is actually reached.
        const menu = new obsidianModule.Menu();
        app.workspace.trigger('file-menu', menu, folder, 'file-explorer-context-menu');
        clickMenuItem(menu, 'Rename folder...');

        await waitUntil({
          message: 'rename prompt did not open',
          predicate: () => document.querySelector('.prompt-modal .text-box') !== null
        });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        const nameInput = document.querySelector('.prompt-modal .text-box');
        if (!(nameInput instanceof HTMLInputElement)) {
          throw new TypeError('No folder name prompt input.');
        }
        nameInput.value = TYPED_NAME;
        // The modal tracks its value through the component's change handler, so a bare `value` assignment
        // Would be accepted and then submitted as the seeded name.
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        // The prompt validates ASYNCHRONOUSLY and refuses to submit while the input is invalid, so clicking
        // Before the validation settles is silently ignored.
        await waitUntil({
          message: 'the typed folder name never became valid',
          predicate: () => nameInput.checkValidity()
        });

        const okButton = document.querySelector('.prompt-modal .ok-button');
        if (!(okButton instanceof HTMLElement)) {
          throw new TypeError('No folder name prompt OK button.');
        }
        okButton.click();

        const noticeLinkEl = await waitForNoticeLink(NEW_FOLDER_PATH);

        // The folder note is renamed AFTER the folder, and it is the thing the click has to find — so the
        // Click waits for it rather than for the folder alone.
        try {
          await waitUntil({
            message: `the folder note was never renamed to ${NEW_FOLDER_NOTE_PATH}`,
            predicate: () => app.vault.getFileByPath(NEW_FOLDER_NOTE_PATH) !== null
          });
        } catch {
          // Reported through the returned state.
        }

        // Let the vault settle before clicking, the same pause `extract-notice-link` needs: the operation has
        // Just renamed a folder and rewritten a note, and an open into the middle of Obsidian's reaction to
        // That shows an empty editor. A real user cannot click a notice within milliseconds of it rendering.
        await sleep(SETTLE_BEFORE_CLICK_IN_MILLISECONDS);

        const activeBeforeClick = app.workspace.getActiveFile()?.path ?? '';
        noticeLinkEl?.click();

        // Give-up wrapper: the assertions below report what the click actually achieved, and a throw out of
        // This closure would discard exactly that evidence.
        try {
          await waitUntil({
            message: 'the folder note did not open',
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === NEW_FOLDER_NOTE_PATH,
            timeoutInMilliseconds: OPEN_TIMEOUT_IN_MILLISECONDS
          });
        } catch {
          // Reported through the returned state.
        }

        return {
          activeBeforeClick,
          activeFileAfterClick: app.workspace.getActiveFile()?.path ?? '',
          // Reported alongside the active file so a failure says WHICH thing went wrong: an empty editor is
          // The open having raced the rename, a populated control note is the click having done nothing.
          editorValueAfterClick: app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor.getValue() ?? '',
          // Every item under this run's root carrying the class the explorer marks a reveal with, so a
          // Failed assertion says WHAT was highlighted instead of merely that the expected thing was not.
          explorerMarks: [...activeDocument.querySelectorAll<HTMLElement>('[data-path]')]
            .filter((el) => (el.dataset['path'] ?? '').startsWith(ROOT) && el.className.includes('has-focus'))
            .map((el) => `${el.dataset['path'] ?? ''} :: ${el.className}`),
          folderNoteExists: app.vault.getFileByPath(NEW_FOLDER_NOTE_PATH) !== null,
          // `getActiveViewOfType` answers `null` once a non-markdown leaf (the file explorer) is the active
          // One, which is the focus question revealing raises.
          isMarkdownViewActive: app.workspace.getActiveViewOfType(obsidianModule.MarkdownView) !== null,
          noticeTexts: [...seenNoticeTexts],
          // `has-focus` is what the explorer marks a REVEAL with, on a file as on a folder — where
          // `is-active` merely marks the open file and would be set by the open alone.
          revealedPaths: [...activeDocument.querySelectorAll<HTMLElement>('.nav-folder-title.has-focus, .nav-file-title.has-focus')]
            .map((el) => el.dataset['path'] ?? ''),
          wasNoticeLinkFound: noticeLinkEl !== null
        };

        function clickMenuItem(menuToSearch: MenuLike, title: string): void {
          // Identified by its rendered text, the way the other folder-menu tests do — `MenuItem` exposes no
          // Title of its own.
          const itemEl = menuToSearch.items.find((candidate) => candidate.dom?.textContent === title)?.dom;
          if (!itemEl) {
            const available = menuToSearch.items.map((candidate) => candidate.dom?.textContent ?? '').join(' | ');
            throw new TypeError(`No menu item "${title}". Available: ${available}`);
          }
          itemEl.click();
        }

        async function removeFolder(path: string): Promise<void> {
          const existing = app.vault.getFolderByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }

        /**
         * Finds the renamed folder's link inside this run's completion notice. Notices render into
         * `activeDocument`, never `document`.
         *
         * @param path - The folder's new path.
         * @returns The anchor to click, or `null` when no such notice appeared.
         */
        async function waitForNoticeLink(path: string): Promise<HTMLElement | null> {
          try {
            await waitUntil({
              message: 'no completion notice named the renamed folder',
              predicate: () => findLink() !== null
            });
          } catch {
            // Give-up wrapper: the caller reports what WAS observed, which a throw out of the closure would
            // Discard.
            return null;
          }
          return findLink();

          function findLink(): HTMLElement | null {
            for (const noticeEl of activeDocument.querySelectorAll('.notice')) {
              // Accumulated across polls: a Notice auto-hides, so reading them only once at the end can
              // Report an empty list for a notice that really did appear.
              seenNoticeTexts.add(noticeEl.textContent);
              // `includes`, not `startsWith`: `PluginNoticeComponent` puts the plugin's name on its own line
              // Above the message.
              if (!noticeEl.textContent.includes('Renamed folder ')) {
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

    // Surfaced first: every later assertion is meaningless if the notice never named the renamed folder, and
    // The accumulated notice texts are what says why.
    expect({ noticeTexts: result.noticeTexts, wasNoticeLinkFound: result.wasNoticeLinkFound })
      .toMatchObject({ wasNoticeLinkFound: true });
    expect(result.folderNoteExists).toBe(true);

    // The click, and only the click, opened the folder note.
    expect(result.activeBeforeClick).toBe('Folder notice link/control.md');
    expect({ activeFileAfterClick: result.activeFileAfterClick, editorValueAfterClick: result.editorValueAfterClick })
      .toMatchObject({ activeFileAfterClick: 'Folder notice link/1. Beta 234/1. Beta 234.md' });

    // The FOLDER NOTE is what the explorer highlights, not the folder: since `obsidian-dev-utils` 94.2.0 the
    // Reveal follows the thing the click actually opens, and falls back to the folder only when that note is
    // Hidden in the explorer (or the folder has none). Revealing the note expands the folder holding it, so
    // The folder is still on screen — it is simply no longer the marked item.
    expect({ explorerMarks: result.explorerMarks, revealedPaths: result.revealedPaths })
      .toMatchObject({ revealedPaths: expect.arrayContaining(['Folder notice link/1. Beta 234/1. Beta 234.md']) as string[] });

    // And the user is left in the note rather than parked in the file explorer.
    expect(result.isMarkdownViewActive).toBe(true);
  });
});
