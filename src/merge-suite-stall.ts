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
 */

import { evalInObsidian } from 'obsidian-integration-testing';

import { captureStallDiagnosticsInObsidian } from './merge-suite-in-obsidian.ts';

/**
 * Params for {@link describeStall}.
 */
export interface DescribeStallParams {
  /**
   * Whatever the poll rejected with.
   */
  readonly error: unknown;

  /**
   * The vault-relative paths the suite was waiting on.
   */
  readonly paths: string[];

  /**
   * The vault to read the diagnostics from.
   */
  readonly vaultPath: string;
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
  const { error, paths, vaultPath } = params;
  const diagnostics = await evalInObsidian({
    callback: ({ app, captureStallDiagnostics, obsidianModule, paths: awaitedPaths }) => captureStallDiagnostics({ app, folderClass: obsidianModule.TFolder, paths: awaitedPaths }),
    input: { captureStallDiagnostics: captureStallDiagnosticsInObsidian, paths },
    vaultPath
  });

  return new Error(`${String(error)} | state when the suite gave up: ${JSON.stringify(diagnostics)}`);
}

/* v8 ignore stop */
