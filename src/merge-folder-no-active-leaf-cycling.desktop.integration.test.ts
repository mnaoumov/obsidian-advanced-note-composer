import type { EventRef } from 'obsidian';

import {
  ContextId,
  evalInObsidian,
  pollInObsidian
} from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { MergeSuiteStallContext } from './merge-suite-stall.ts';

import {
  chooseFolderInPickerInObsidian,
  startActivationRecorderInObsidian,
  trashIfExistsInObsidian
} from './merge-suite-in-obsidian.ts';
import { describeStall } from './merge-suite-stall.ts';
import { findSettingItemInObsidian } from './settings-tab-navigation.ts';

// Desktop-only: this is a folder-merge (file-move) flow. It runs desktop-only, matching the plugin's
// Established integration convention (no Android emulator wired for it).
// Isolation: `npx vitest run --project integration-tests:desktop src/merge-folder-no-active-leaf-cycling.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';
const NOTE_COUNT = 12;
/*
 * This suite renames more notes than any other in the aggregate (NOTE_COUNT of them, each with links to
 * Rewrite), and it runs FIRST - while Obsidian is still indexing the freshly created temp vault. That is why
 * It was the one that kept dying on the 30 s CDP cap (T446), and why every phase below is now its own short
 * Eval with the waiting done from Node: see `merge-suite-in-obsidian.ts` for the cap, the measurement and
 * The shape. The merge itself was measured at 1.65 s in a healthy aggregate run and at over 15x that on a
 * Loaded machine, so this budget is headroom rather than a performance expectation - the assertion below is
 * About WHETHER merged notes get opened, never about how fast.
 */
const MERGE_TIMEOUT_IN_MILLISECONDS = 90_000;
// The picker is a modal opening in front of the user; it is not the load-sensitive part, so it gets its own
// Much tighter budget and fails saying so.
const PICKER_TIMEOUT_IN_MILLISECONDS = 30_000;
// Above the sum of the budgets above, so a genuine stall reports the NAMED poll timeout rather than losing
// The race to a bare vitest timeout that says only that time ran out.
const TEST_TIMEOUT_IN_MILLISECONDS = 180_000;
const RENDER_DELAY_IN_MILLISECONDS = 300;
// Small enough that a batch of `vault.create` calls cannot approach the CDP cap on its own, even while the
// Vault is still being indexed.
const NOTE_CREATION_BATCH_SIZE = 4;
const SOURCE_FOLDER = 'cyc-src';
const TARGET_FOLDER = 'cyc-tgt';
const NO_FILE = '<no file>';

/**
 * What the suite's evals hand to each other. It lives on `window` in the Obsidian process for as long as the
 * {@link ContextId} does, which is what lets the recorder installed by one eval be read by another.
 */
interface SuiteContext extends MergeSuiteStallContext {
  /**
   * The recorder's registration, so cleanup can take it back off.
   */
  eventRef?: EventRef;
}

describe('folder merge does not cycle the active leaf (issue #106)', () => {
  it('opens no merged target note even when "Should open note after merge" is on', async () => {
    const contextId = new ContextId<SuiteContext>();
    const vaultPath = getTemporaryVault().path;

    try {
      // The bug of issue #106 only manifests with `Should open note after merge` ON: a single-file merge
      // Opens the merged note, but a folder merge used to open EVERY merged note in turn (the "visual
      // Cycling"). Turn it on so the test fails loudly if the per-file open ever comes back. One eval per
      // Toggle: a settings-tab round trip is a page navigation plus render delays, and paying for two of
      // Them in one eval is exactly the kind of accumulation the cap punishes.
      for (const toggle of [{ name: 'Should ask before merging', shouldEnable: false }, { name: 'Should open note after merge', shouldEnable: true }]) {
        await evalInObsidian({
          async callback({ app, findSettingItem, pluginId, renderDelayInMilliseconds, settingName, shouldEnable }) {
            app.setting.open();
            app.setting.openTabById(pluginId);
            const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
            if (!tab) {
              throw new Error('Settings tab was not found.');
            }
            await sleep(renderDelayInMilliseconds);
            const item = await findSettingItem({ app, name: settingName, settingTab: tab });
            const toggleEl = item?.querySelector('.checkbox-container');
            if (!(toggleEl instanceof HTMLElement)) {
              throw new TypeError(`"${settingName}" toggle was not found.`);
            }
            if (toggleEl.classList.contains('is-enabled') !== shouldEnable) {
              toggleEl.click();
              await sleep(renderDelayInMilliseconds);
            }
            app.setting.close();
            await sleep(renderDelayInMilliseconds);
          },
          input: {
            findSettingItem: findSettingItemInObsidian,
            pluginId: PLUGIN_ID,
            renderDelayInMilliseconds: RENDER_DELAY_IN_MILLISECONDS,
            settingName: toggle.name,
            shouldEnable: toggle.shouldEnable
          },
          vaultPath
        });
      }

      // Clean slate.
      await evalInObsidian({
        async callback({ app, sourceFolder, targetFolder, trashIfExists }) {
          await trashIfExists({ app, path: sourceFolder });
          await trashIfExists({ app, path: targetFolder });
          await app.vault.createFolder(sourceFolder);
          await app.vault.createFolder(targetFolder);
        },
        input: { sourceFolder: SOURCE_FOLDER, targetFolder: TARGET_FOLDER, trashIfExists: trashIfExistsInObsidian },
        vaultPath
      });

      // A folder of cross-referencing notes: each links to two siblings, so the merge rewrites links.
      for (let batchStart = 0; batchStart < NOTE_COUNT; batchStart += NOTE_CREATION_BATCH_SIZE) {
        await evalInObsidian({
          async callback({ app, batchSize, firstIndex, noteCount, sourceFolder }) {
            const lastIndex = Math.min(firstIndex + batchSize, noteCount);
            for (let index = firstIndex; index < lastIndex; index++) {
              const next = (index + 1) % noteCount;
              const previous = (index + noteCount - 1) % noteCount;
              await app.vault.create(
                `${sourceFolder}/note-${String(index)}.md`,
                `# Note ${String(index)}\n\nLinks: [[note-${String(next)}]] and [[note-${String(previous)}]].\n`
              );
            }
          },
          input: { batchSize: NOTE_CREATION_BATCH_SIZE, firstIndex: batchStart, noteCount: NOTE_COUNT, sourceFolder: SOURCE_FOLDER },
          vaultPath
        });
      }

      await evalInObsidian({
        async callback({ app, context, lib: { waitUntil }, noFile, obsidianModule, renderDelayInMilliseconds, sourceFolder, startActivationRecorder, targetFolder }) {
          // A target note that backlinks into the source folder, so backlink rewriting runs too.
          await app.vault.create(`${targetFolder}/hub.md`, '# Hub\n\nSee [[note-0]].\n');

          // The merge-folder command derives its source folder from the ACTIVE file's parent, so open a note
          // Inside the source folder (the real user flow: trigger merge-folder from a note in the folder).
          const activeSourceNote = app.vault.getAbstractFileByPath(`${sourceFolder}/note-0.md`);
          if (!(activeSourceNote instanceof obsidianModule.TFile)) {
            throw new TypeError('Active source note missing.');
          }
          await app.workspace.getLeaf(false).openFile(activeSourceNote);
          await waitUntil({ message: 'source note active', predicate: () => app.workspace.getActiveFile()?.path === `${sourceFolder}/note-0.md` });
          await sleep(renderDelayInMilliseconds);

          // Record every note the merge activates. Opening any merged TARGET note is the cycling signal.
          context.recording = [];
          context.eventRef = startActivationRecorder({ app, noFile, recording: context.recording });
        },
        contextId,
        input: {
          noFile: NO_FILE,
          renderDelayInMilliseconds: RENDER_DELAY_IN_MILLISECONDS,
          sourceFolder: SOURCE_FOLDER,
          startActivationRecorder: startActivationRecorderInObsidian,
          targetFolder: TARGET_FOLDER
        },
        vaultPath
      });

      const wasCommandStarted = await evalInObsidian({
        callback: ({ app, pluginId }) => app.commands.executeCommandById(`${pluginId}:merge-folder`),
        input: { pluginId: PLUGIN_ID },
        vaultPath
      });
      // A refused command (a `canExecute` guard turning false) is a SILENT no-op, so without this the waits
      // Below would blame a slow merge for a merge that was never allowed to start.
      expect(wasCommandStarted).toBe(true);

      await pollInObsidian({
        poll: () => ({ hasPicker: document.querySelector('.prompt') !== null }),
        timeoutInMilliseconds: PICKER_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: 'the merge-folder picker never opened',
        until: (pickerStatus) => pickerStatus.hasPicker,
        vaultPath
      });

      await evalInObsidian({
        async callback({ chooseFolderInPicker, lib: { waitUntil }, renderDelayInMilliseconds, targetFolder }) {
          await sleep(renderDelayInMilliseconds);
          await chooseFolderInPicker({ folderPath: targetFolder, waitUntil });
        },
        input: {
          chooseFolderInPicker: chooseFolderInPickerInObsidian,
          renderDelayInMilliseconds: RENDER_DELAY_IN_MILLISECONDS,
          targetFolder: TARGET_FOLDER
        },
        vaultPath
      });

      /*
       * The ask-before-merging setting is off, so the merge runs directly. The source folder vanishing is the
       * Post-commit signal, and this is the phase that used to blow the CDP cap: it is polled from NODE, each
       * Poll its own sub-second eval, so the 90 s budget above is finally the budget that applies.
       */
      const mergeStatus = await pollInObsidian({
        input: { noteCount: NOTE_COUNT, sourceFolder: SOURCE_FOLDER, targetFolder: TARGET_FOLDER },
        poll({ app, noteCount, sourceFolder, targetFolder }) {
          let mergedCount = 0;
          for (let index = 0; index < noteCount; index++) {
            if (app.vault.getAbstractFileByPath(`${targetFolder}/note-${String(index)}.md`)) {
              mergedCount++;
            }
          }

          return { mergedCount, sourceGone: app.vault.getAbstractFileByPath(sourceFolder) === null };
        },
        timeoutInMilliseconds: MERGE_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: 'the folder merge never removed the source folder',
        until: (status) => status.sourceGone,
        vaultPath
      }).catch(async (error: unknown) => {
        throw await describeStall({
          contextId,
          error,
          paths: [SOURCE_FOLDER, TARGET_FOLDER],
          pluginId: PLUGIN_ID,
          vaultPath
        });
      });

      const { recording } = await evalInObsidian({
        async callback({ context, renderDelayInMilliseconds }) {
          // Long enough for a late activation to reach the recorder before it is read.
          await sleep(renderDelayInMilliseconds);
          return { recording: [...context.recording ?? []] };
        },
        contextId,
        input: { renderDelayInMilliseconds: RENDER_DELAY_IN_MILLISECONDS },
        vaultPath
      });

      // The merge actually happened: every source note landed in the target folder and the source is gone.
      expect(mergeStatus.sourceGone).toBe(true);
      expect(mergeStatus.mergedCount).toBe(NOTE_COUNT);
      // ...and it did so WITHOUT opening/cycling through any merged note (issue #106 regression guard). The
      // Recording holds every activation, so a failure names the notes that were walked through, in order;
      // Activations outside this suite's target folder are some other suite's, since the vault is shared.
      expect(recording.filter((activation) => activation.startsWith(`${TARGET_FOLDER}/note-`))).toEqual([]);
    } finally {
      await evalInObsidian({
        callback({ app, context }) {
          if (context.eventRef) {
            app.workspace.offref(context.eventRef);
          }
        },
        contextId,
        vaultPath
      });
      await contextId.dispose(vaultPath);
    }
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
