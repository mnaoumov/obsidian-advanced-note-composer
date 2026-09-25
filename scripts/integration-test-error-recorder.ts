/**
 * @file
 *
 * Records every error Obsidian reports while a desktop integration test runs, and attaches them to the report
 * of any test that FAILS.
 *
 * The aggregate's remaining failures are one-offs that pass when their file is run alone, so each run that
 * shows one is spent the moment it ends. The folder-merge stall reported only `An unhandled error occurred.
 * Please check the console for more information.` - and the console it pointed at belonged to an Obsidian
 * the harness had already closed. Recording `console.error` (where obsidian-dev-utils' `printError` writes
 * the full stack), uncaught `error` events and unhandled rejections for the length of each test turns that
 * notice into its stack in the very report that shows the failure.
 *
 * A PASSING test is never touched, however many errors it logged: several suites provoke refusals on
 * purpose, and turning those red would be a regression of its own. On a failing test the errors are added as
 * one extra error AFTER the test's own, which vitest reports beside it rather than instead of it.
 *
 * Registered through `editContext` in `./vitest-config.ts`, beside the other two per-file setup files.
 */

import type { TestContext } from 'vitest';

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  afterEach,
  beforeEach
} from 'vitest';

/**
 * What the recorder keeps on `window` inside Obsidian.
 */
interface ErrorRecorder {
  /**
   * The errors recorded since the current test started.
   */
  entries: string[];

  /**
   * When the current test started, as `performance.now()`, so each entry says how far into the test it came.
   */
  startTime: number;
}

/**
 * The `window` the recorder lives on.
 */
interface ErrorRecorderHost {
  /**
   * Absent until the first test of the run installs it; the instance outlives every file after that.
   */
  __advancedNoteComposerErrorRecorder?: ErrorRecorder;
}

/**
 * Adds what the recorder collected to a failed test's report.
 *
 * @param context - The finished test's context. Its result state is final by the time `afterEach` runs.
 */
async function reportRecordedErrors(context: TestContext): Promise<void> {
  if (context.task.result?.state !== 'fail') {
    return;
  }

  let entries: string[];
  try {
    entries = await evalInObsidian({
      callback() {
        const host = window as ErrorRecorderHost;
        return [...host.__advancedNoteComposerErrorRecorder?.entries ?? []];
      }
    });
  } catch {
    // The transport may be what failed the test, and the test's own error already says so.
    return;
  }

  if (entries.length === 0) {
    return;
  }

  throw new Error(`Obsidian reported ${String(entries.length)} error(s) during this failed test:\n${entries.join('\n')}`);
}

/**
 * Installs the recorder, once per Obsidian instance, and empties its buffer for the test about to start.
 * Never throws: a recorder that fails to install must not fail the test it was meant to explain.
 */
async function startRecordingErrors(): Promise<void> {
  try {
    await evalInObsidian({
      callback() {
        // Bounded, so a test that logs in a loop cannot grow the buffer past what one eval can carry back.
        const MAX_ENTRY_COUNT = 50;
        const MAX_ENTRY_LENGTH = 4000;

        const host = window as ErrorRecorderHost;
        if (host.__advancedNoteComposerErrorRecorder) {
          host.__advancedNoteComposerErrorRecorder.entries = [];
          host.__advancedNoteComposerErrorRecorder.startTime = performance.now();
          return;
        }

        const recorder: ErrorRecorder = { entries: [], startTime: performance.now() };
        host.__advancedNoteComposerErrorRecorder = recorder;

        function record(kind: string, values: unknown[]): void {
          if (recorder.entries.length >= MAX_ENTRY_COUNT) {
            return;
          }
          const text = values.map((value) => {
            if (value instanceof Error) {
              return value.stack ?? `${value.name}: ${value.message}`;
            }
            if (typeof value === 'string') {
              return value;
            }
            try {
              return JSON.stringify(value) ?? String(value);
            } catch {
              return String(value);
            }
          }).join(' ');
          const elapsed = Math.round(performance.now() - recorder.startTime);
          recorder.entries.push(`[${kind} +${String(elapsed)} ms] ${text.slice(0, MAX_ENTRY_LENGTH)}`);
        }

        const originalConsoleError = console.error.bind(console);
        console.error = (...values: unknown[]): void => {
          record('console.error', values);
          originalConsoleError(...values);
        };
        window.addEventListener('error', (event) => {
          record('uncaught', [event.error ?? event.message]);
        });
        window.addEventListener('unhandledrejection', (event) => {
          record('unhandledrejection', [event.reason]);
        });
      }
    });
  } catch {
    // Deliberately swallowed: see the doc comment.
  }
}

beforeEach(startRecordingErrors);
afterEach(reportRecordedErrors);
