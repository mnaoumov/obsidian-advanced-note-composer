import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

const PLUGIN_ID = 'advanced-note-composer';

// Issue #250: loading the plugin opened a tab and closed it again. `RenderLinkHandlersWarmupComponent`
// Called obsidian-dev-utils' `registerLinkHandlers` at layout ready, and on its first call that derived a
// DOM-events-handlers constructor by driving the real workspace -- create a leaf, open an arbitrary note in
// Preview, wait, detach -- creating `__temp.md` first when the vault held no markdown files at all, which is
// Exactly the case here. On desktop the reporter saw the resulting `file-open` / `active-leaf-change` cascade
// Reach every other plugin; on mobile the same dance failed outright and surfaced as the plugin's
// "An unhandled error occurred" notice, its stack running onLayoutReady -> registerLinkHandlers ->
// GetDomEventsHandlersConstructor. One root cause, two symptoms. obsidian-dev-utils 95.0.0 made
// `registerLinkHandlers` synchronous and leaf-free, so the warm-up component was deleted; this pins that
// Loading the plugin touches no leaf and writes no note.
//
// Cross-platform rather than desktop-only on purpose: `manifest.json` sets `isDesktopOnly: false` and the bug
// Bit both platforms -- mobile worse than desktop, since there it was a hard failure.
describe('plugin load creates no leaf (issue #250)', () => {
  it('re-enables without opening a tab, firing workspace events, or creating a temporary note', async () => {
    const result = await evalInObsidian({
      async callback({ app, pluginId }) {
        const SETTLE_DELAY_IN_MILLISECONDS = 2000;

        // Snapshot AFTER the plugin is down and settled, so only the enable below is measured.
        await app.plugins.disablePlugin(pluginId);
        await sleep(SETTLE_DELAY_IN_MILLISECONDS);
        const leafCountBefore = countLeaves();

        const activeLeafChanges: string[] = [];
        const fileOpens: string[] = [];
        const createdPaths: string[] = [];
        const deletedPaths: string[] = [];

        const workspaceEventRefs = [
          app.workspace.on('active-leaf-change', (leaf) => {
            // The event can arrive before the view has its file, so fall back to the view type rather than
            // Reporting a bare `(none)` that says nothing about what was activated.
            const file = leaf?.view.getState()['file'];
            activeLeafChanges.push(typeof file === 'string' ? file : leaf?.view.getViewType() ?? '(none)');
          }),
          app.workspace.on('file-open', (file) => {
            fileOpens.push(file?.path ?? '(none)');
          })
        ];

        // `__temp.md` was created and deleted again within the dance, so neither a before/after listing nor an
        // `exists` check can see it -- only the events can.
        const vaultEventRefs = [
          app.vault.on('create', (file) => {
            createdPaths.push(file.path);
          }),
          app.vault.on('delete', (file) => {
            deletedPaths.push(file.path);
          })
        ];

        try {
          await app.plugins.enablePlugin(pluginId);
          await sleep(SETTLE_DELAY_IN_MILLISECONDS);

          return {
            activeLeafChanges,
            createdPaths,
            deletedPaths,
            fileOpens,
            leafCountAfter: countLeaves(),
            leafCountBefore
          };
        } finally {
          for (const eventRef of workspaceEventRefs) {
            app.workspace.offref(eventRef);
          }
          for (const eventRef of vaultEventRefs) {
            app.vault.offref(eventRef);
          }
          dismissOpenModals();
        }

        function countLeaves(): number {
          let count = 0;
          app.workspace.iterateAllLeaves(() => {
            count++;
          });
          return count;
        }

        // `ReleaseNotesComponent` is the other `onLayoutReady` component, and in a vault that has never shown
        // Them it opens an alert. That is not a leaf and so cannot fail the assertions, but leaving it up would
        // Leak a modal into whichever suite runs next against this shared vault.
        //
        // Only ever dismissed through its own OK button. Detaching the container instead would tear the element
        // Out without unwinding Obsidian's modal stack, which breaks every later modal -- a far worse failure
        // Than the leak being guarded against, and one that would land on a different suite entirely. A modal
        // With no OK button is not the release-notes alert and is therefore none of this test's business.
        function dismissOpenModals(): void {
          for (const modalEl of document.querySelectorAll('.modal-container')) {
            const okButtonEl = modalEl.querySelector('.mod-cta');
            if (okButtonEl instanceof HTMLElement) {
              okButtonEl.click();
            }
          }
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // Asserted as one object rather than a signal at a time so a regression reports every deviation in a
    // Single diff instead of short-circuiting on whichever `expect` happens to come first.
    //
    // The events carry the weight here, and the leaf-count delta deliberately does not: the old code
    // Detached the leaf it opened, so the count came back to where it started and a before/after
    // Comparison saw nothing. It stays only to catch a leaf that leaks. What the reporter actually felt
    // Is the transient -- "I have plugins that automatically trigger on new note, or focus change. So it
    // Causes a cascade of events" -- and only a subscription that is live across the load can see it.
    expect({
      activeLeafChanges: result.activeLeafChanges,
      createdPaths: result.createdPaths,
      deletedPaths: result.deletedPaths,
      fileOpens: result.fileOpens,
      leafCountDelta: result.leafCountAfter - result.leafCountBefore
    }).toEqual({
      activeLeafChanges: [],
      createdPaths: [],
      deletedPaths: [],
      fileOpens: [],
      leafCountDelta: 0
    });
  });
});
