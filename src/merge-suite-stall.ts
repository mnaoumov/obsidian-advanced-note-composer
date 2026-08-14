/**
 * @file
 *
 * The NODE side of the folder-merge suites' stall reporting - the counterpart to
 * `merge-suite-in-obsidian.ts`'s `captureStallDiagnosticsInObsidian`, which runs inside Obsidian.
 *
 * These suites' remaining failure mode is an aggregate-only stall: the merge simply does not finish inside
 * its budget, in a run that cannot be reproduced on demand (measured: once in three full aggregate runs, and
 * never in isolation across three consecutive runs of the same file). A run like that is spent the moment it
 * ends, so the poll timeout has to carry its own evidence rather than leave the next investigator to try to
 * make it happen again.
 *
 * What the snapshot carries is what has actually explained a stall in this repo before, plus the two things
 * the first version of it could not see (T470):
 *
 * - the plugin's LIVE settings, because a merge waits FOREVER on a confirmation dialog nobody answers, and
 *   `shouldAskBeforeMerging` coming back true is the difference between "the merge is slow" and "the merge
 *   never started merging";
 * - the notice LOG rather than the notices still standing, because notices auto-hide after ~5 s and the one
 *   that explained the stall is gone long before a 90 s wait gives up;
 * - the activation recording so far, since a leaf cascade is one of the candidate causes and the suites only
 *   ever read the recording on their success path.
 */

import type { ContextId } from 'obsidian-integration-testing';

import { evalInObsidian } from 'obsidian-integration-testing';

import type { NoticeLogEntryInObsidian } from './merge-suite-in-obsidian.ts';

import {
  captureStallDiagnosticsInObsidian,
  findSettingsComponentInObsidian
} from './merge-suite-in-obsidian.ts';

/**
 * Params for {@link describeStall}.
 */
export interface DescribeStallParams {
  /**
   * The suite's context, read for whatever its recorders have collected. Required rather than optional: a
   * suite that stalls without its recordings is exactly the run this whole mechanism exists to avoid.
   */
  readonly contextId: ContextId<MergeSuiteStallContext>;

  /**
   * Whatever the poll rejected with.
   */
  readonly error: unknown;

  /**
   * The vault-relative paths the suite was waiting on.
   */
  readonly paths: string[];

  /**
   * The plugin whose live settings are read back.
   */
  readonly pluginId: string;

  /**
   * The vault to read the diagnostics from.
   */
  readonly vaultPath: string;
}

/**
 * The part of a suite's context the stall report reads. Every folder-merge suite's own `SuiteContext`
 * extends it, so a suite cannot install a recorder the report then fails to pick up.
 */
export interface MergeSuiteStallContext {
  /**
   * Every notice that appeared since the notice recorder was installed, when the suite installs one.
   */
  noticeLog?: NoticeLogEntryInObsidian[];

  /**
   * Every path the active leaf visited since the activation recorder was installed.
   */
  recording?: string[];
}

/**
 * The settings a stalled folder merge is read back through. All four are settings that decide whether the
 * merge waits for a human: a confirmation dialog, or an open-after step that is itself a candidate for the
 * thing that never finished.
 */
interface MergeStallSettings {
  /**
   * What happens to the emptied folder, which is the post-commit signal two of these suites wait on.
   */
  emptyFolderBehaviorAfterMergingFolder: string;

  /**
   * The one that parks a merge on a dialog forever when it is unexpectedly on.
   */
  shouldAskBeforeMerging: boolean;

  /**
   * Whether a folder merge opens the destination's first note afterwards.
   */
  shouldOpenFirstNoteAfterMergingFolder: boolean;

  /**
   * Whether a folder-contents merge opens the note it produced afterwards.
   */
  shouldOpenNoteAfterMergingFolderIntoFile: boolean;
}

/* v8 ignore start -- Integration-only: it drives a live Obsidian, and is covered by the suites that use it. */

/**
 * Turns a poll timeout into an error that also says what the app looked like when the suite gave up.
 *
 * @param params - The params.
 * @returns The error to throw. The original message is kept verbatim in front of the snapshot, so a stall
 *   still reads as the phase that stalled.
 */
export async function describeStall(params: DescribeStallParams): Promise<Error> {
  const {
    contextId,
    error,
    paths,
    pluginId,
    vaultPath
  } = params;
  const diagnostics = await evalInObsidian({
    callback({ app, captureStallDiagnostics, context, findSettingsComponent, obsidianModule, paths: awaitedPaths, pluginId: targetPluginId }) {
      let settings: unknown;
      try {
        const settingsComponent = findSettingsComponent<MergeStallSettings>({ app, pluginId: targetPluginId, probeSettingName: 'shouldAskBeforeMerging' });
        settings = {
          emptyFolderBehaviorAfterMergingFolder: settingsComponent.settings.emptyFolderBehaviorAfterMergingFolder,
          shouldAskBeforeMerging: settingsComponent.settings.shouldAskBeforeMerging,
          shouldOpenFirstNoteAfterMergingFolder: settingsComponent.settings.shouldOpenFirstNoteAfterMergingFolder,
          shouldOpenNoteAfterMergingFolderIntoFile: settingsComponent.settings.shouldOpenNoteAfterMergingFolderIntoFile
        };
      } catch (settingsError) {
        // Reported rather than thrown: the settings are one line of the evidence, and losing the whole
        // Snapshot because of them would put the run back to reporting only that time ran out.
        settings = `unavailable: ${String(settingsError)}`;
      }

      return {
        ...captureStallDiagnostics({ app, folderClass: obsidianModule.TFolder, paths: awaitedPaths }),
        noticeLog: context.noticeLog ?? null,
        recording: context.recording ?? null,
        settings
      };
    },
    contextId,
    input: {
      captureStallDiagnostics: captureStallDiagnosticsInObsidian,
      findSettingsComponent: findSettingsComponentInObsidian,
      paths,
      pluginId
    },
    vaultPath
  });

  return new Error(`${String(error)} | state when the suite gave up: ${JSON.stringify(diagnostics)}`);
}

/* v8 ignore stop */
