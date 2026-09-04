/**
 * @file
 *
 * Empties the shared temp vault before each integration file, so no file inherits another's notes.
 *
 * The whole `integration-tests:desktop` project shares ONE Obsidian instance and ONE vault across all 103
 * files: `globalSetup` runs once and nothing resets it, so by the time a file runs at position ~45 the vault
 * holds every earlier file's notes. That accumulation is T880, and it bit in two separate ways — the
 * split/extract picker's fuzzy-ranked suggestion list stopped containing the row a test waited for, and a
 * merge's link update reached into hundreds of foreign notes and died mid-merge on an unhandled error. Every
 * victim passed in isolation, and the failing set changed every run because vitest sequences files
 * slowest-first from its own duration cache.
 *
 * Registered through `editContext` in `./vitest-config.ts`, alongside the modal cleanup
 * `./integration-test-setup.ts` does, so a new suite cannot forget it. It is a SEPARATE setup file from that
 * one on purpose: `customProjects` filters this one back out of `integration-tests:demo-vault` and
 * `capture-screenshots:desktop`, which own the contents of their vaults and must keep the modal cleanup while
 * never being wiped.
 *
 * **Why this grain (T880-P12).** Per-file cleanup written into each suite is the "101 files must remember it"
 * problem the modal cleanup was centralized to avoid; a vault per file is stronger still, but the harness
 * (`obsidian-integration-testing`) registers one vault per PROJECT, so it is a change there rather than here.
 * Emptying the shared vault centrally caps it at one file's own notes.
 *
 * **What it does NOT fix, so do not expect it to.** `create-new suggestion did not appear` is not a
 * vault-size symptom: `SuggestModalBase.onNoSuggestion()` is the only thing that pushes the `Enter to create`
 * row, so that row exists only when the search matched NOTHING, and four sibling notes in a freshly created
 * vault are enough to suppress it. Those tests force the creation with `Mod+Enter` instead.
 */

import { evalInObsidian } from 'obsidian-integration-testing';
import { beforeAll } from 'vitest';

/**
 * How many delete passes to make before giving up.
 *
 * More than one because a pass can leave work behind for two reasons: a debounced autosave from the previous
 * file's still-open editor can recreate a note just after it was deleted, and a vault large enough to outlast
 * the transport's 30 s cap on a single `evalInObsidian` closure has to be finished by a later call.
 */
const DELETE_PASS_LIMIT = 5;

/**
 * Deletes every child of the vault root in one renderer round-trip.
 *
 * Dot-prefixed folders — `.obsidian` with the plugin's own `data.json` in it, and `.trash` — are not part of
 * Obsidian's file tree, so neither the plugin's settings nor the harness's configuration is touched.
 *
 * @returns How many root children are left afterwards.
 */
async function deleteEveryRootChild(): Promise<number> {
  return await evalInObsidian({
    async callback({ app }) {
      /*
       * A SNAPSHOT, and it has to be one: deleting mutates `children` in place, so iterating the live array
       * skips every second entry. Spread into its OWN CONST rather than inline in the `for…of`, which
       * `unicorn/no-useless-spread` reads as a redundant copy and would autofix back onto the live array —
       * reintroducing exactly that bug. (`slice()` is not the way out either: `unicorn/prefer-spread`
       * rejects it.)
       */
      const rootChildren = [...app.vault.getRoot().children];

      for (const child of rootChildren) {
        try {
          /*
           * `delete` rather than `trashFile`: this is permanent, so nothing accumulates in `.trash` either,
           * and the `force` flag is what lets a folder holding hidden children go with it.
           */
          await app.vault.delete(child, true);
        } catch {
          // Left for the next pass to retry, and ultimately for the emptiness check below to report.
        }
      }

      return app.vault.getRoot().children.length;
    }
  });
}

/**
 * Empties the vault, never throwing.
 *
 * A cleanup that failed a run would mask the result of the test it ran for — and here it would do worse than
 * that, since a file inheriting a few extra notes still mostly works, while a red `beforeAll` fails every test
 * in the file for a reason that has nothing to do with any of them.
 */
async function emptyVault(): Promise<void> {
  try {
    for (let pass = 0; pass < DELETE_PASS_LIMIT; pass++) {
      const remainingCount = await deleteEveryRootChild();
      if (remainingCount === 0) {
        return;
      }
    }
  } catch {
    /*
     * Deliberately swallowed, matching `./integration-test-setup.ts`: a transport hiccup during cleanup must
     * not turn a passing test red, and the next file's `beforeAll` gets another attempt at the same leftovers.
     */
  }
}

/*
 * `beforeAll` rather than `afterAll` for the same reason the modal cleanup uses it: it covers the state a file
 * INHERITS, so a file is clean whether or not the one before it finished tidily — or finished at all.
 */
beforeAll(emptyVault);
