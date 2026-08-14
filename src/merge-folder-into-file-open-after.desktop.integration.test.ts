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
  findSettingsComponentInObsidian,
  startActivationRecorderInObsidian,
  trashIfExistsInObsidian
} from './merge-suite-in-obsidian.ts';
import { describeStall } from './merge-suite-stall.ts';

// Desktop-only: this is a folder-contents merge (file-delete) flow, matching the plugin's established
// Integration convention.
// Isolation: `npx vitest run --project integration-tests:desktop src/merge-folder-into-file-open-after.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';
// The assertion is about WHETHER the merged note is opened, never about how fast, so a loaded machine must
// Not be able to fail it. Each phase below is its own short eval and the waiting is done from Node, so this
// Budget is the one that actually applies - see `merge-suite-in-obsidian.ts` for the 30 s CDP cap.
const MERGE_TIMEOUT_IN_MILLISECONDS = 90_000;
// Above the sum of the budgets used below, so a genuine stall reports the NAMED poll timeout rather than
// Losing the race to a bare vitest timeout.
const TEST_TIMEOUT_IN_MILLISECONDS = 180_000;
const RENDER_DELAY_IN_MILLISECONDS = 400;
const SOURCE_FOLDER = 'open-after-src';
const MERGED_NOTE_PATH = 'open-after-src.md';
const NO_FILE = '<no file>';

/**
 * The settings this suite drives.
 */
interface MergeSettings {
  /**
   * `Delete`, so the emptied folder disappearing is the post-commit signal.
   */
  emptyFolderBehaviorAfterMergingFolder: string;

  /**
   * Off, so the merge runs without a confirmation dialog.
   */
  shouldAskBeforeMerging: boolean;

  /**
   * The feature under test (issue #212).
   */
  shouldOpenNoteAfterMergingFolderIntoFile: boolean;
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

describe('merge folder contents into a single file opens the merged note (issue #212)', () => {
  it('opens the merged note exactly once when the setting is on', async () => {
    const contextId = new ContextId<SuiteContext>();
    const vaultPath = getTemporaryVault().path;

    try {
      await evalInObsidian({
        async callback({ app, context, findSettingsComponent, pluginId }) {
          const settingsComponent = findSettingsComponent<MergeSettings>({ app, pluginId, probeSettingName: 'shouldAskBeforeMerging' });
          context.originalSettings = {
            emptyFolderBehaviorAfterMergingFolder: settingsComponent.settings.emptyFolderBehaviorAfterMergingFolder,
            shouldAskBeforeMerging: settingsComponent.settings.shouldAskBeforeMerging,
            shouldOpenNoteAfterMergingFolderIntoFile: settingsComponent.settings.shouldOpenNoteAfterMergingFolderIntoFile
          };
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = false;
            settings.shouldOpenNoteAfterMergingFolderIntoFile = true;
            // The emptied folder disappearing is the post-commit signal; the open runs after that.
            settings.emptyFolderBehaviorAfterMergingFolder = 'Delete';
          });
        },
        contextId,
        input: { findSettingsComponent: findSettingsComponentInObsidian, pluginId: PLUGIN_ID },
        vaultPath
      });

      await evalInObsidian({
        async callback({ app, mergedNotePath, sourceFolder, trashIfExists }) {
          await trashIfExists({ app, path: sourceFolder });
          await trashIfExists({ app, path: mergedNotePath });

          await app.vault.createFolder(sourceFolder);
          await app.vault.create(`${sourceFolder}/alpha.md`, 'alpha body');
          await app.vault.create(`${sourceFolder}/beta.md`, 'beta body');
        },
        input: { mergedNotePath: MERGED_NOTE_PATH, sourceFolder: SOURCE_FOLDER, trashIfExists: trashIfExistsInObsidian },
        vaultPath
      });

      await evalInObsidian({
        async callback({ app, context, lib: { waitUntil }, noFile, obsidianModule, sourceFolder, startActivationRecorder }) {
          // The folder command resolves its folder from the ACTIVE file's parent, and this is also what
          // Makes the starting point a note OTHER than the merged one.
          const alpha = app.vault.getAbstractFileByPath(`${sourceFolder}/alpha.md`);
          if (!(alpha instanceof obsidianModule.TFile)) {
            throw new TypeError('The source note was not created.');
          }
          await app.workspace.getLeaf(false).openFile(alpha);
          await waitUntil({
            message: `editor for ${alpha.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === alpha.path
          });

          context.recording = [];
          context.eventRef = startActivationRecorder({ app, noFile, recording: context.recording });
        },
        contextId,
        input: { noFile: NO_FILE, sourceFolder: SOURCE_FOLDER, startActivationRecorder: startActivationRecorderInObsidian },
        vaultPath
      });

      // The merge is kicked off and then polled from NODE, each poll its own sub-second eval, so the budget
      // Above is enforceable instead of being cut short by the CDP cap.
      const wasCommandStarted = await evalInObsidian({
        callback: ({ app, pluginId }) => app.commands.executeCommandById(`${pluginId}:merge-folder-into-file`),
        input: { pluginId: PLUGIN_ID },
        vaultPath
      });
      // A refused command (a `canExecute` guard turning false) is a SILENT no-op, so without this the waits
      // Below would blame a slow merge for a merge that was never allowed to start.
      expect(wasCommandStarted).toBe(true);

      const mergeStatus = await pollInObsidian({
        input: { mergedNotePath: MERGED_NOTE_PATH, sourceFolder: SOURCE_FOLDER },
        poll: ({ app, mergedNotePath, sourceFolder }) => ({
          mergedNoteCreated: app.vault.getAbstractFileByPath(mergedNotePath) !== null,
          sourceGone: app.vault.getAbstractFileByPath(sourceFolder) === null
        }),
        timeoutInMilliseconds: MERGE_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: 'the emptied folder was not deleted, so the merge had not committed',
        until: (status) => status.mergedNoteCreated && status.sourceGone,
        vaultPath
      }).catch(async (error: unknown) => {
        throw await describeStall({
          contextId,
          error,
          paths: [MERGED_NOTE_PATH, SOURCE_FOLDER],
          pluginId: PLUGIN_ID,
          vaultPath
        });
      });

      await pollInObsidian({
        poll: ({ app }) => ({ activePath: app.workspace.getActiveFile()?.path ?? null }),
        timeoutInMilliseconds: MERGE_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: 'the merged note was never opened',
        until: (status) => status.activePath === MERGED_NOTE_PATH,
        vaultPath
      }).catch(async (error: unknown) => {
        throw await describeStall({
          contextId,
          error,
          paths: [MERGED_NOTE_PATH],
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

      // The merge actually ran, and the user ends up in the note it produced...
      expect(mergeStatus.mergedNoteCreated).toBe(true);
      expect(activePath).toBe(MERGED_NOTE_PATH);
      // ...having been taken there exactly once. More than one activation would be issue #106 all over again:
      // Both sources merge into this same note, so a per-note open would activate it once per merged note.
      expect(recording.filter((activation) => activation === MERGED_NOTE_PATH)).toHaveLength(1);
    } finally {
      await evalInObsidian({
        async callback({ app, context, findSettingsComponent, mergedNotePath, pluginId, sourceFolder, trashIfExists }) {
          if (context.eventRef) {
            app.workspace.offref(context.eventRef);
          }
          // The merged note lands at the vault root, which the whole aggregate shares.
          await trashIfExists({ app, path: mergedNotePath });
          await trashIfExists({ app, path: sourceFolder });
          const { originalSettings } = context;
          if (originalSettings) {
            const settingsComponent = findSettingsComponent<MergeSettings>({ app, pluginId, probeSettingName: 'shouldAskBeforeMerging' });
            await settingsComponent.editAndSave((settings) => {
              settings.shouldAskBeforeMerging = originalSettings.shouldAskBeforeMerging;
              settings.shouldOpenNoteAfterMergingFolderIntoFile = originalSettings.shouldOpenNoteAfterMergingFolderIntoFile;
              settings.emptyFolderBehaviorAfterMergingFolder = originalSettings.emptyFolderBehaviorAfterMergingFolder;
            });
          }
        },
        contextId,
        input: {
          findSettingsComponent: findSettingsComponentInObsidian,
          mergedNotePath: MERGED_NOTE_PATH,
          pluginId: PLUGIN_ID,
          sourceFolder: SOURCE_FOLDER,
          trashIfExists: trashIfExistsInObsidian
        },
        vaultPath
      });
      await contextId.dispose(vaultPath);
    }
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
