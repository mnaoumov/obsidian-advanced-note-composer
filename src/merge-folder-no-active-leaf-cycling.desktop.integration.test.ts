import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsTab } from './plugin-settings-tab.ts';

const PLUGIN_ID = 'advanced-note-composer';
const NOTE_COUNT = 12;

describe('folder merge does not cycle the active leaf (issue #106)', () => {
  it('opens no merged target note even when "Should open note after merge" is on', async () => {
    const result = await evalInObsidian({
      args: { noteCount: NOTE_COUNT, pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, noteCount, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 300;
        const BIG_TIMEOUT_IN_MILLISECONDS = 25_000;
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
        for (let i = 0; i < noteCount; i++) {
          const next = (i + 1) % noteCount;
          const prev = (i + noteCount - 1) % noteCount;
          await app.vault.create(
            `${SOURCE_FOLDER}/note-${String(i)}.md`,
            `# Note ${String(i)}\n\nLinks: [[note-${String(next)}]] and [[note-${String(prev)}]].\n`
          );
        }
        // A target note that backlinks into the source folder, so backlink rewriting runs too.
        await app.vault.create(`${TARGET_FOLDER}/hub.md`, '# Hub\n\nSee [[note-0]].\n');

        // The merge-folder command derives its source folder from the ACTIVE file's parent, so open a note
        // Inside the source folder (the real user flow: trigger merge-folder from a note in the folder).
        const activeSourceNote = app.vault.getAbstractFileByPath(`${SOURCE_FOLDER}/note-0.md`);
        if (!(activeSourceNote instanceof obsidianModule.TFile)) {
          throw new Error('Active source note missing.');
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
          await waitUntil({ message: 'folder picker', predicate: () => document.querySelector('.prompt') !== null, timeoutInMilliseconds: BIG_TIMEOUT_IN_MILLISECONDS });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          await chooseFolderInPicker(TARGET_FOLDER);

          // The ask-before-merging setting is off, so the merge runs directly. Wait for the source to vanish.
          await waitUntil({ message: 'merge complete', predicate: () => app.vault.getAbstractFileByPath(SOURCE_FOLDER) === null, timeoutInMilliseconds: BIG_TIMEOUT_IN_MILLISECONDS });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        } finally {
          app.workspace.offref(eventRef);
        }

        let mergedCount = 0;
        for (let i = 0; i < noteCount; i++) {
          if (app.vault.getAbstractFileByPath(`${TARGET_FOLDER}/note-${String(i)}.md`)) {
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
            throw new Error('No merge-folder picker input.');
          }
          input.value = folderPath;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({ message: 'suggestion', predicate: () => Array.from(document.querySelectorAll('.suggestion-item')).some((el) => el.textContent.includes(folderPath)) });
          input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Enter', key: 'Enter' }));
        }

        async function setToggle(settingName: string, desired: boolean): Promise<void> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          (tab as PluginSettingsTab).displayLegacy();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const item = Array.from(tab.containerEl.querySelectorAll('.setting-item'))
            .find((el) => el.querySelector('.setting-item-name')?.textContent === settingName);
          const toggle = item?.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new Error(`"${settingName}" toggle was not found.`);
          }
          if (toggle.classList.contains('is-enabled') !== desired) {
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
  });
});
