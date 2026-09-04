/**
 * @file
 *
 * Cleanup that keeps one integration file's leftovers out of the next one's app.
 *
 * The whole `integration-tests:desktop` project shares ONE Obsidian instance and ONE vault across all 103
 * files: `globalSetup` runs once, nothing resets between files, and not one test file registers an
 * `afterEach`. A test that throws mid-flow therefore leaves its modal open OVER the app, and every later
 * file needing a modal-free app fails waiting for an operation that can never start.
 *
 * That cascade is the whole of T795, and it is measured, not assumed: in two instrumented runs the first
 * failing file was `split-picker-name-first` both times, and it was followed by **28** and **20**
 * consecutively failing files — every one of which passes in isolation. Raising the wait budgets does not
 * touch it (5s to 15s left the head failure identical, ten seconds later); only the missing cleanup does.
 *
 * A fresh harness vault also opens with the plugin's own release-notes modal already up
 * (`ReleaseNotesComponent` is an `onLayoutReady` component, as
 * `plugin-load-creates-no-leaf.cross-platform.integration.test.ts` notes), which whichever file runs first
 * would otherwise have to absorb. Vitest sequences files slowest-first from its own duration cache, so
 * which file that is changes every run — which is exactly why the failing set looked random.
 *
 * Registered through `editContext` in `./vitest-config.ts`, so it reaches every desktop integration file
 * without 101 near-identical edits.
 */

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  afterEach,
  beforeAll
} from 'vitest';

/**
 * Dismisses anything left covering the app: an open modal, and the bare `.menu` a right click leaves
 * behind. Never throws — cleanup that fails a run would mask the result of the test that just ran.
 */
async function dismissStrayOverlays(): Promise<void> {
  try {
    await evalInObsidian({
      async callback({ lib: { pressKey, waitUntil } }) {
        const DISMISS_ATTEMPT_LIMIT = 5;
        const DISMISS_TIMEOUT_IN_MILLISECONDS = 2000;

        /*
         * A context menu outlives the command it ran, and the leftover `.menu` swallows the next click, so
         * it is cleanup too — `Lib.clickMouse` documents the same obligation for suites driving a right
         * click.
         */
        for (const menuEl of activeDocument.querySelectorAll('.menu')) {
          menuEl.remove();
        }

        for (let attempt = 0; attempt < DISMISS_ATTEMPT_LIMIT; attempt++) {
          const modalEl = activeDocument.querySelector('.modal-container');

          if (!modalEl) {
            return;
          }

          /*
           * Escape is how all fifteen dismissals across this suite close a modal, so a modal that ignores
           * it is one no test here could have driven either. Removing the element is the fallback rather
           * than the method: it leaves the `Modal` believing it is open, which is worse than a clean close
           * but far better than handing the next file a covered app.
           */
          await pressKey({ key: 'Escape' });

          try {
            await waitUntil({
              message: 'the stray modal did not close',
              predicate: () => !modalEl.isConnected,
              timeoutInMilliseconds: DISMISS_TIMEOUT_IN_MILLISECONDS
            });
          } catch {
            modalEl.remove();
          }
        }
      }
    });
  } catch {
    /*
     * Deliberately swallowed. A transport hiccup in cleanup must not turn a passing test red, nor rewrite
     * a failing one's cause — the next file's `beforeAll` gets another chance at the same overlay.
     */
  }
}

/*
 * `beforeAll` covers the state a file INHERITS — above all the release-notes modal standing open before
 * the run's first test. `afterEach` covers the state a file LEAKS, which is the cascade itself. Between
 * them every test starts against an uncovered app, whether or not the test before it succeeded.
 */
beforeAll(dismissStrayOverlays);
afterEach(dismissStrayOverlays);
