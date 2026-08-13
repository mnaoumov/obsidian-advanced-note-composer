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

import {
  findSettingsComponentInObsidian,
  startActivationRecorderInObsidian,
  trashIfExistsInObsidian
} from './merge-suite-in-obsidian.ts';
import { describeStall } from './merge-suite-stall.ts';

// Desktop-only: this is a folder-contents merge (file-delete) flow, matching the plugin's established
// Integration convention.
// Isolation: `npx vitest run --project integration-tests:desktop src/merge-folder-into-file-no-active-leaf-cycling.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';
// The assertion is about WHETHER merged notes get opened, never about how fast, so a loaded machine must not
// Be able to fail it. Each phase below is its own short eval and the waiting is done from Node, so this
// Budget is the one that actually applies - see `merge-suite-in-obsidian.ts` for the 30 s CDP cap it used to
// Hide behind.
const MERGE_TIMEOUT_IN_MILLISECONDS = 90_000;
// Above the budget used below, so a genuine stall reports the NAMED poll timeout rather than losing the race
// To a bare vitest timeout.
const TEST_TIMEOUT_IN_MILLISECONDS = 180_000;
const RENDER_DELAY_IN_MILLISECONDS = 400;
// Enough notes that a per-note open would be unmistakable in the recording rather than a single stray
// Activation, and few enough that the merge stays well inside the budget above.
const NOTE_COUNT = 8;
// Notes in the sub-folder, so the recursive walk merges notes the flat listing never sees.
const NESTED_NOTE_COUNT = 2;
// How many of the folder's notes are left open in tabs while it is merged.
const OPEN_TAB_COUNT = 4;
// Small enough that a batch of `vault.create` calls cannot approach the CDP cap on its own.
const NOTE_CREATION_BATCH_SIZE = 4;
// What the recorder writes when a leaf change carries no file at all - the leaf being emptied rather than
// Pointed at another note. Kept as a value rather than `null`, so the recording reads as an ordered log.
const NO_FILE = '<no file>';
// Unique across the aggregate on purpose: one temp vault is shared by every suite, so a generic basename
// Would make another suite's `[[link]]` ambiguous.
const SOURCE_FOLDER = 'cif-cycle-src';
const SUB_FOLDER = `${SOURCE_FOLDER}/nested`;
const MERGED_NOTE_PATH = `${SOURCE_FOLDER}.md`;
const HUB_NOTE_PATH = 'cif-cycle-hub.md';
const FIRST_NOTE_PATH = `${SOURCE_FOLDER}/cif-note-1.md`;

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
   * MUST stay off. This is the plugin's ONE deliberate open (issue #212); with it on the test would be
   * watching that feature instead of the per-note suppression it is here to pin.
   */
  shouldOpenNoteAfterMergingFolderIntoFile: boolean;
}

/**
 * What the suite's evals hand to each other, on `window` in the Obsidian process.
 */
interface SuiteContext {
  /**
   * The recorder's registration, so cleanup can take it back off.
   */
  eventRef?: EventRef;

  /**
   * The settings as they were, to restore in the shared vault.
   */
  originalSettings?: MergeSettings;

  /**
   * Every path the active leaf visited since the recorder was installed.
   */
  recording?: string[];
}

/**
 * Whether a recorded activation names one of the notes THIS suite created - a source being merged away or
 * the note they are merged into.
 *
 * The distinction matters because the vault is shared by the whole aggregate: when the last of this suite's
 * tabs closes, Obsidian lands on whatever tab survives, and in an aggregate run that is some other suite's
 * note. Landing somewhere is not cycling; walking through the notes being merged is, and only those notes
 * can show it.
 *
 * @param activation - A recorded activation path.
 * @returns Whether it is one of this suite's notes.
 */
function isOwnNote(activation: string): boolean {
  return activation.startsWith(`${SOURCE_FOLDER}/`) || activation === MERGED_NOTE_PATH;
}

describe('merge folder contents into a single file does not cycle the active leaf (issue #212, issue #106)', () => {
  it('activates no source note and no merged note while merging', async () => {
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
            settings.shouldOpenNoteAfterMergingFolderIntoFile = false;
            // The emptied folder disappearing is the post-commit signal this test waits on.
            settings.emptyFolderBehaviorAfterMergingFolder = 'Delete';
          });
        },
        contextId,
        input: { findSettingsComponent: findSettingsComponentInObsidian, pluginId: PLUGIN_ID },
        vaultPath
      });

      await evalInObsidian({
        async callback({ app, hubNotePath, mergedNotePath, sourceFolder, subFolder, trashIfExists }) {
          await trashIfExists({ app, path: sourceFolder });
          await trashIfExists({ app, path: mergedNotePath });
          await trashIfExists({ app, path: hubNotePath });

          await app.vault.createFolder(sourceFolder);
          await app.vault.createFolder(subFolder);
        },
        input: {
          hubNotePath: HUB_NOTE_PATH,
          mergedNotePath: MERGED_NOTE_PATH,
          sourceFolder: SOURCE_FOLDER,
          subFolder: SUB_FOLDER,
          trashIfExists: trashIfExistsInObsidian
        },
        vaultPath
      });

      // Cross-referencing notes, so the merge rewrites links between them as it goes...
      for (let batchStart = 1; batchStart <= NOTE_COUNT; batchStart += NOTE_CREATION_BATCH_SIZE) {
        await evalInObsidian({
          async callback({ app, batchSize, firstIndex, noteCount, sourceFolder }) {
            const lastIndex = Math.min(firstIndex + batchSize - 1, noteCount);
            for (let index = firstIndex; index <= lastIndex; index++) {
              const next = index === noteCount ? 1 : index + 1;
              await app.vault.create(
                `${sourceFolder}/cif-note-${String(index)}.md`,
                `# Note ${String(index)}\n\nSee [[cif-note-${String(next)}]].\n`
              );
            }
          },
          input: { batchSize: NOTE_CREATION_BATCH_SIZE, firstIndex: batchStart, noteCount: NOTE_COUNT, sourceFolder: SOURCE_FOLDER },
          vaultPath
        });
      }

      await evalInObsidian({
        async callback({ app, hubNotePath, nestedNoteCount, subFolder }) {
          // ...plus a nested pair, so the recursive walk merges notes the folder's own listing never sees...
          for (let index = 1; index <= nestedNoteCount; index++) {
            await app.vault.create(
              `${subFolder}/cif-nested-${String(index)}.md`,
              `# Nested ${String(index)}\n\nSee [[cif-note-1]].\n`
            );
          }
          // ...and a note OUTSIDE the folder linking in, so backlink rewriting runs against a note the merge
          // Is not deleting - the one link-rewrite path that could touch an open, surviving editor.
          await app.vault.create(hubNotePath, '# Hub\n\nSee [[cif-note-1]].\n');
        },
        input: { hubNotePath: HUB_NOTE_PATH, nestedNoteCount: NESTED_NOTE_COUNT, subFolder: SUB_FOLDER },
        vaultPath
      });

      /*
       * The reporter's own setup, as far as it can be reconstructed: several of the folder's notes sitting
       * Open in tabs while it is merged. This is what makes the suite bite - with a single editor open there
       * Is only ever one leaf to lose, and the cascade this guards against has nothing to walk through. They
       * Are opened in descending order so the LOWEST-numbered one ends up active - the command resolves its
       * Folder from the ACTIVE file's parent, which also makes the active note one of the notes merged away.
       */
      for (let index = OPEN_TAB_COUNT; index >= 1; index--) {
        await evalInObsidian({
          async callback({ app, lib: { waitUntil }, notePath, obsidianModule }) {
            const note = app.vault.getAbstractFileByPath(notePath);
            if (!(note instanceof obsidianModule.TFile)) {
              throw new TypeError('A source note was not created.');
            }
            await app.workspace.getLeaf('tab').openFile(note);
            await waitUntil({
              message: `editor for ${notePath} did not open`,
              predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === notePath
            });
          },
          input: { notePath: `${SOURCE_FOLDER}/cif-note-${String(index)}.md` },
          vaultPath
        });
      }

      await evalInObsidian({
        async callback({ app, context, firstNotePath, noFile, renderDelayInMilliseconds, startActivationRecorder }) {
          if (app.workspace.getActiveFile()?.path !== firstNotePath) {
            throw new Error('The merge must be triggered from a note inside the folder.');
          }
          await sleep(renderDelayInMilliseconds);

          // EVERY activation, not only the interesting ones: when this comes back non-empty it is the
          // Recorded order that names the cause, and a filtered recording would have thrown that away.
          context.recording = [];
          context.eventRef = startActivationRecorder({ app, noFile, recording: context.recording });
        },
        contextId,
        input: {
          firstNotePath: FIRST_NOTE_PATH,
          noFile: NO_FILE,
          renderDelayInMilliseconds: RENDER_DELAY_IN_MILLISECONDS,
          startActivationRecorder: startActivationRecorderInObsidian
        },
        vaultPath
      });

      // The merge is kicked off and then polled from NODE, each poll its own sub-second eval, so the budget
      // Above is enforceable instead of being cut short by the CDP cap.
      const wasCommandStarted = await evalInObsidian({
        callback: ({ app, pluginId }) => app.commands.executeCommandById(`${pluginId}:merge-folder-into-file`),
        input: { pluginId: PLUGIN_ID },
        vaultPath
      });
      // A refused command (a `canExecute` guard turning false) is a SILENT no-op, so without this the wait
      // Below would blame a slow merge for a merge that was never allowed to start.
      expect(wasCommandStarted).toBe(true);

      await pollInObsidian({
        input: { mergedNotePath: MERGED_NOTE_PATH, sourceFolder: SOURCE_FOLDER },
        poll: ({ app, mergedNotePath, sourceFolder }) => ({
          mergedNoteCreated: app.vault.getAbstractFileByPath(mergedNotePath) !== null,
          sourceGone: app.vault.getAbstractFileByPath(sourceFolder) === null
        }),
        timeoutInMilliseconds: MERGE_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: 'the merged single file was not created, or the emptied folder was not deleted, so the merge had not committed',
        until: (status) => status.mergedNoteCreated && status.sourceGone,
        vaultPath
      }).catch(async (error: unknown) => {
        throw await describeStall({ error, paths: [MERGED_NOTE_PATH, SOURCE_FOLDER], vaultPath });
      });

      const result = await evalInObsidian({
        async callback({ app, context, mergedNotePath, obsidianModule, renderDelayInMilliseconds, sourceFolder }) {
          // Long enough for a late activation to reach the recorder before it is read.
          await sleep(renderDelayInMilliseconds);

          const mergedNote = app.vault.getAbstractFileByPath(mergedNotePath);
          const mergedContent = mergedNote instanceof obsidianModule.TFile ? await app.vault.read(mergedNote) : '';

          return {
            activePath: app.workspace.getActiveFile()?.path ?? null,
            // Proof the recording above is of a merge that actually happened: every note's heading landed in
            // The merged note. Without this an early bail-out would look like "no cycling" and pass.
            mergedHeadingCount: [...mergedContent.matchAll(/^# (?:Note|Nested) /gm)].length,
            recording: [...context.recording ?? []],
            sourceGone: app.vault.getAbstractFileByPath(sourceFolder) === null
          };
        },
        contextId,
        input: { mergedNotePath: MERGED_NOTE_PATH, renderDelayInMilliseconds: RENDER_DELAY_IN_MILLISECONDS, sourceFolder: SOURCE_FOLDER },
        vaultPath
      });

      // The merge actually ran: every note in the folder and its sub-folder reached the merged note.
      expect(result.sourceGone).toBe(true);
      expect(result.mergedHeadingCount).toBe(NOTE_COUNT + NESTED_NOTE_COUNT);

      /*
       * ...without the active leaf ever visiting one of the notes involved (issue #212's question about issue
       * #106). Two distinct regressions would break this, which is why it asserts on paths and not on a count:
       *
       * - the per-note `shouldOpenAfterMerge: false` (issue #106) coming undone would put the MERGED note in
       *   here, once per source;
       * - `closeLeavesShowingFiles` going away would put the SOURCE notes in here, as the tabs of the notes
       *   being merged away fall one at a time and Obsidian activates the next surviving one. That is what
       *   this setup was built to catch, and it recorded exactly that before the fix landed: notes 2, 3 and 4,
       *   deterministically, across three runs.
       *
       * Activations naming anything ELSE are deliberately allowed: once the last of this suite's tabs closes,
       * Obsidian lands on whatever tab survives, and the aggregate shares one vault - so in a full run that is
       * some other suite's note (it was `rec-src/rec-note.md`), and in isolation it is the emptied leaf.
       * Landing somewhere is not cycling.
       */
      expect(result.recording.filter((activation) => isOwnNote(activation))).toEqual([]);
      // ...and the user is not LEFT in one either. With the open-after setting off nothing takes them to the
      // Merged note; the setting is what changes that, and it has its own suite.
      expect(isOwnNote(result.activePath ?? NO_FILE)).toBe(false);
    } finally {
      await evalInObsidian({
        async callback({ app, context, findSettingsComponent, hubNotePath, mergedNotePath, pluginId, sourceFolder, trashIfExists }) {
          if (context.eventRef) {
            app.workspace.offref(context.eventRef);
          }
          // The merged note and the hub land at the vault root, which the whole aggregate shares.
          await trashIfExists({ app, path: mergedNotePath });
          await trashIfExists({ app, path: sourceFolder });
          await trashIfExists({ app, path: hubNotePath });
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
          hubNotePath: HUB_NOTE_PATH,
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
