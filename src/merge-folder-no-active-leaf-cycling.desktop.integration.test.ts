import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only: this is a folder-merge (file-move) flow. It runs desktop-only, matching the plugin's
// Established integration convention (no Android emulator wired for it). File-move suites can hit the
// Documented headless rename wall (`renameFile`/`metadataCache.onCleanCache`) when several run in one
// Aggregate; if this stalls in the aggregate, it is `it.skip`-ped and must still pass alone.
// Isolation: `npx vitest run --project integration-tests:desktop src/merge-folder-no-active-leaf-cycling.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';
const NOTE_COUNT = 12;
/*
 * This suite renames more notes than any other in the aggregate (NOTE_COUNT of them, each with links to
 * Rewrite), so it hits the rename wall above harder than its siblings, and it runs FIRST - while Obsidian
 * Is still indexing the freshly created temp vault. The merge itself is fast (measured at 1.65 s in a
 * Healthy aggregate run), so this budget is not a performance expectation: it is headroom for a run where
 * `onCleanCache` takes its time. It was 25 s and the suite failed two runs in a row on a loaded machine,
 * Where the merge is over 15x its healthy duration. The assertion below is about WHETHER merged notes get
 * Opened, never about how fast - so a load-induced timeout is a false negative, and only a genuine stall
 * Should be able to fail it.
 */
const MERGE_TIMEOUT_IN_MILLISECONDS = 90_000;
// Vitest's own per-test budget for this project is 30 s, which is under the wait above; this test needs
// Its own, so the informative `waitUntil` message wins the race against a bare vitest timeout.
const TEST_TIMEOUT_IN_MILLISECONDS = 120_000;

describe('folder merge does not cycle the active leaf (issue #106)', () => {
  it('opens no merged target note even when "Should open note after merge" is on', async () => {
    const result = await evalInObsidian({
      // eslint-disable-next-line unicorn/name-replacements -- `args` is an `obsidian-integration-testing` parameter name.
      args: { mergeTimeoutInMilliseconds: MERGE_TIMEOUT_IN_MILLISECONDS, noteCount: NOTE_COUNT, pluginId: PLUGIN_ID },
      // eslint-disable-next-line unicorn/name-replacements -- `fn` is an `obsidian-integration-testing` parameter name.
      async fn({ app, lib: { waitUntil }, mergeTimeoutInMilliseconds, noteCount, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 300;
        const SOURCE_FOLDER = 'cyc-src';
        const TARGET_FOLDER = 'cyc-tgt';

        // The bug of issue #106 only manifests with this setting ON: a single-file merge opens the merged
        // Note, but a folder merge used to open EVERY merged note in turn (the "visual cycling"). Turn it on
        // So the test fails loudly if the per-file open ever comes back.
        await setToggle('Should ask before merging', false);
        await setToggle('Should open note after merge', true);

        // Clean slate.
        for (const path of [SOURCE_FOLDER, TARGET_FOLDER]) {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }
        await app.vault.createFolder(SOURCE_FOLDER);
        await app.vault.createFolder(TARGET_FOLDER);

        // A folder of cross-referencing notes: each links to two siblings, so the merge rewrites links.
        for (let index = 0; index < noteCount; index++) {
          const next = (index + 1) % noteCount;
          const previous = (index + noteCount - 1) % noteCount;
          await app.vault.create(
            `${SOURCE_FOLDER}/note-${String(index)}.md`,
            `# Note ${String(index)}\n\nLinks: [[note-${String(next)}]] and [[note-${String(previous)}]].\n`
          );
        }
        // A target note that backlinks into the source folder, so backlink rewriting runs too.
        await app.vault.create(`${TARGET_FOLDER}/hub.md`, '# Hub\n\nSee [[note-0]].\n');

        // The merge-folder command derives its source folder from the ACTIVE file's parent, so open a note
        // Inside the source folder (the real user flow: trigger merge-folder from a note in the folder).
        const activeSourceNote = app.vault.getAbstractFileByPath(`${SOURCE_FOLDER}/note-0.md`);
        if (!(activeSourceNote instanceof obsidianModule.TFile)) {
          throw new TypeError('Active source note missing.');
        }
        await app.workspace.getLeaf(false).openFile(activeSourceNote);
        await waitUntil({ message: 'source note active', predicate: () => app.workspace.getActiveFile()?.path === `${SOURCE_FOLDER}/note-0.md` });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        // Record every note the merge activates. Opening any merged TARGET note is the cycling signal.
        const openedTargetNotes: string[] = [];
        const eventRef = app.workspace.on('active-leaf-change', () => {
          const activePath = app.workspace.getActiveFile()?.path;
          if (activePath?.startsWith(`${TARGET_FOLDER}/note-`)) {
            openedTargetNotes.push(activePath);
          }
        });

        try {
          app.commands.executeCommandById(`${pluginId}:merge-folder`);
          await waitUntil({ message: 'folder picker', predicate: () => document.querySelector('.prompt') !== null, timeoutInMilliseconds: mergeTimeoutInMilliseconds });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          await chooseFolderInPicker(TARGET_FOLDER);

          // The ask-before-merging setting is off, so the merge runs directly. Wait for the source to vanish.
          await waitUntil({ message: 'merge complete', predicate: () => app.vault.getAbstractFileByPath(SOURCE_FOLDER) === null, timeoutInMilliseconds: mergeTimeoutInMilliseconds });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        } finally {
          app.workspace.offref(eventRef);
        }

        let mergedCount = 0;
        for (let index = 0; index < noteCount; index++) {
          if (app.vault.getAbstractFileByPath(`${TARGET_FOLDER}/note-${String(index)}.md`)) {
            mergedCount++;
          }
        }

        return {
          mergedCount,
          openedTargetNotes,
          sourceGone: app.vault.getAbstractFileByPath(SOURCE_FOLDER) === null
        };

        async function chooseFolderInPicker(folderPath: string): Promise<void> {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No merge-folder picker input.');
          }
          input.value = folderPath;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({ message: 'suggestion', predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(folderPath)) });
          input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Enter', key: 'Enter' }));
        }

        async function setToggle(settingName: string, shouldEnable: boolean): Promise<void> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const item = [...tab.containerEl.querySelectorAll('.setting-item')]
            .find((el) => el.querySelector('.setting-item-name')?.textContent === settingName);
          const toggle = item?.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new TypeError(`"${settingName}" toggle was not found.`);
          }
          if (toggle.classList.contains('is-enabled') !== shouldEnable) {
            toggle.click();
            await sleep(RENDER_DELAY_IN_MILLISECONDS);
          }
          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        }
      },
      vaultPath: getTempVault().path
    });

    // The merge actually happened: every source note landed in the target folder and the source is gone.
    expect(result.sourceGone).toBe(true);
    expect(result.mergedCount).toBe(NOTE_COUNT);
    // ...and it did so WITHOUT opening/cycling through any merged note (issue #106 regression guard).
    expect(result.openedTargetNotes).toEqual([]);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
