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
  findSettingsComponentInObsidian,
  startActivationRecorderInObsidian,
  trashIfExistsInObsidian
} from './merge-suite-in-obsidian.ts';
import { describeStall } from './merge-suite-stall.ts';

// Desktop-only: this is a folder-merge (file-move) flow, matching the plugin's established integration
// Convention.
// Isolation: `npx vitest run --project integration-tests:desktop src/merge-folder-open-first-note.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';
// The assertion is about WHICH note is opened, never about how fast, so a loaded machine must not be able to
// Fail it. Each phase below is its own short eval and the waiting is done from Node, so this budget is the
// One that actually applies - see `merge-suite-in-obsidian.ts` for the 30 s CDP cap it used to hide behind.
const MERGE_TIMEOUT_IN_MILLISECONDS = 90_000;
const PICKER_TIMEOUT_IN_MILLISECONDS = 30_000;
// Above the sum of the budgets above, so a genuine stall reports the NAMED poll timeout rather than losing
// The race to a bare vitest timeout.
const TEST_TIMEOUT_IN_MILLISECONDS = 180_000;
const RENDER_DELAY_IN_MILLISECONDS = 400;
const SOURCE_FOLDER = 'first-note-src';
const TARGET_FOLDER = 'first-note-tgt';
// `5.` before `30.`: text order would put the appendix first, and neither of them is the note the merge
// Itself moved — what is asked for is the first note IN the folder.
const EXPECTED_FIRST_NOTE_PATH = `${TARGET_FOLDER}/5. Middle.md`;
const NO_FILE = '<no file>';

/**
 * The settings this suite drives.
 */
interface MergeSettings {
  /**
   * Off, so the merge runs without a confirmation dialog.
   */
  shouldAskBeforeMerging: boolean;

  /**
   * The feature under test (issue #215).
   */
  shouldOpenFirstNoteAfterMergingFolder: boolean;
}

/**
 * What the suite's evals hand to each other, on `window` in the Obsidian process.
 */
interface SuiteContext extends MergeSuiteStallContext {
  /**
   * The recorder's registration, so cleanup can take it back off.
   */
  eventRef?: EventRef;

  /**
   * The settings as they were, to restore in the shared vault.
   */
  originalSettings?: MergeSettings;
}

describe('folder merge opens the first note of the destination folder (issue #215)', () => {
  it('opens the naturally-first note of the destination exactly once when the setting is on', async () => {
    const contextId = new ContextId<SuiteContext>();
    const vaultPath = getTemporaryVault().path;

    try {
      await evalInObsidian({
        async callback({ app, context, findSettingsComponent, pluginId }) {
          const settingsComponent = findSettingsComponent<MergeSettings>({ app, pluginId, probeSettingName: 'shouldAskBeforeMerging' });
          context.originalSettings = {
            shouldAskBeforeMerging: settingsComponent.settings.shouldAskBeforeMerging,
            shouldOpenFirstNoteAfterMergingFolder: settingsComponent.settings.shouldOpenFirstNoteAfterMergingFolder
          };
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = false;
            settings.shouldOpenFirstNoteAfterMergingFolder = true;
          });
        },
        contextId,
        input: { findSettingsComponent: findSettingsComponentInObsidian, pluginId: PLUGIN_ID },
        vaultPath
      });

      await evalInObsidian({
        async callback({ app, sourceFolder, targetFolder, trashIfExists }) {
          await trashIfExists({ app, path: sourceFolder });
          await trashIfExists({ app, path: targetFolder });

          await app.vault.createFolder(sourceFolder);
          await app.vault.createFolder(targetFolder);
          // Already in the destination, so the winner is a note the merge never touched.
          await app.vault.create(`${targetFolder}/30. Appendix.md`, 'appendix body');
          await app.vault.create(`${targetFolder}/5. Middle.md`, 'middle body');
          await app.vault.create(`${sourceFolder}/gamma.md`, 'gamma body');
        },
        input: { sourceFolder: SOURCE_FOLDER, targetFolder: TARGET_FOLDER, trashIfExists: trashIfExistsInObsidian },
        vaultPath
      });

      await evalInObsidian({
        async callback({ app, context, lib: { waitUntil }, noFile, obsidianModule, sourceFolder, startActivationRecorder }) {
          // The folder command resolves its source folder from the ACTIVE file's parent.
          const gamma = app.vault.getAbstractFileByPath(`${sourceFolder}/gamma.md`);
          if (!(gamma instanceof obsidianModule.TFile)) {
            throw new TypeError('The source note was not created.');
          }
          await app.workspace.getLeaf(false).openFile(gamma);
          await waitUntil({
            message: `editor for ${gamma.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === gamma.path
          });

          context.recording = [];
          context.eventRef = startActivationRecorder({ app, noFile, recording: context.recording });
        },
        contextId,
        input: { noFile: NO_FILE, sourceFolder: SOURCE_FOLDER, startActivationRecorder: startActivationRecorderInObsidian },
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

      // `Should ask before merging` is off, so the merge runs directly. The source folder vanishing is the
      // Post-commit signal; the open runs after it. Both waits are polled from NODE, each poll its own
      // Sub-second eval, so neither can be cut short by the CDP cap.
      const mergeStatus = await pollInObsidian({
        input: { sourceFolder: SOURCE_FOLDER, targetFolder: TARGET_FOLDER },
        poll: ({ app, sourceFolder, targetFolder }) => ({
          mergedNoteLanded: app.vault.getAbstractFileByPath(`${targetFolder}/gamma.md`) !== null,
          sourceGone: app.vault.getAbstractFileByPath(sourceFolder) === null
        }),
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

      await pollInObsidian({
        poll: ({ app }) => ({ activePath: app.workspace.getActiveFile()?.path ?? null }),
        timeoutInMilliseconds: MERGE_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: 'the first note of the destination was never opened',
        until: (status) => status.activePath === EXPECTED_FIRST_NOTE_PATH,
        vaultPath
      }).catch(async (error: unknown) => {
        throw await describeStall({
          contextId,
          error,
          paths: [EXPECTED_FIRST_NOTE_PATH, TARGET_FOLDER],
          pluginId: PLUGIN_ID,
          vaultPath
        });
      });

      const { activePath, recording } = await evalInObsidian({
        async callback({ app, context, renderDelayInMilliseconds }) {
          // Long enough for a second, unwanted open to show up in the recorder before it is read.
          await sleep(renderDelayInMilliseconds);
          return { activePath: app.workspace.getActiveFile()?.path ?? null, recording: [...context.recording ?? []] };
        },
        contextId,
        input: { renderDelayInMilliseconds: RENDER_DELAY_IN_MILLISECONDS },
        vaultPath
      });

      // The merge actually happened...
      expect(mergeStatus.mergedNoteLanded).toBe(true);
      // ...and it ended in the destination folder's naturally-first note, which is one that was already there
      // Rather than the note the merge moved.
      expect(activePath).toBe(EXPECTED_FIRST_NOTE_PATH);
      // ...having been taken there exactly once. The recording holds EVERY activation, so a second, unwanted
      // Open is not just a count but a named entry in the failure message.
      expect(recording.filter((activation) => activation === EXPECTED_FIRST_NOTE_PATH)).toHaveLength(1);
    } finally {
      await evalInObsidian({
        async callback({ app, context, findSettingsComponent, pluginId, sourceFolder, targetFolder, trashIfExists }) {
          if (context.eventRef) {
            app.workspace.offref(context.eventRef);
          }
          await trashIfExists({ app, path: sourceFolder });
          await trashIfExists({ app, path: targetFolder });
          const { originalSettings } = context;
          if (originalSettings) {
            const settingsComponent = findSettingsComponent<MergeSettings>({ app, pluginId, probeSettingName: 'shouldAskBeforeMerging' });
            await settingsComponent.editAndSave((settings) => {
              settings.shouldAskBeforeMerging = originalSettings.shouldAskBeforeMerging;
              settings.shouldOpenFirstNoteAfterMergingFolder = originalSettings.shouldOpenFirstNoteAfterMergingFolder;
            });
          }
        },
        contextId,
        input: {
          findSettingsComponent: findSettingsComponentInObsidian,
          pluginId: PLUGIN_ID,
          sourceFolder: SOURCE_FOLDER,
          targetFolder: TARGET_FOLDER,
          trashIfExists: trashIfExistsInObsidian
        },
        vaultPath
      });
      await contextId.dispose(vaultPath);
    }
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
