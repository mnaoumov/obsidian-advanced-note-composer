import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only: this is a folder-contents merge (file-delete) flow, matching the plugin's established
// Integration convention. File-move/delete suites can hit the documented headless rename wall when several
// Run in one aggregate; if this stalls in the aggregate, it is `it.skip`-ped and must still pass alone.
// Isolation: `npx vitest run --project integration-tests:desktop src/merge-folder-into-file-no-active-leaf-cycling.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';
// Same budget as `merge-folder-no-active-leaf-cycling`: the assertion is about WHETHER merged notes get
// Opened, never about how fast, so a loaded machine must not be able to fail it.
const MERGE_TIMEOUT_IN_MILLISECONDS = 90_000;
const TEST_TIMEOUT_IN_MILLISECONDS = 120_000;
// Enough notes that a per-note open would be unmistakable in the recording rather than a single stray
// Activation, and few enough that the merge stays well inside the budget above.
const NOTE_COUNT = 8;
// Notes in the sub-folder, so the recursive walk merges notes the flat listing never sees.
const NESTED_NOTE_COUNT = 2;
// How many of the folder's notes are left open in tabs while it is merged.
const OPEN_TAB_COUNT = 4;
// What the recorder writes when a leaf change carries no file at all - the leaf being emptied rather than
// Pointed at another note. Kept as a value rather than `null`, so the recording reads as an ordered log.
const NO_FILE = '<no file>';
// Unique across the aggregate on purpose: one temp vault is shared by every suite, so a generic basename
// Would make another suite's `[[link]]` ambiguous.
const SOURCE_FOLDER = 'cif-cycle-src';
const MERGED_NOTE_PATH = `${SOURCE_FOLDER}.md`;

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: MergeSettings;
}

interface MergeSettings {
  emptyFolderBehaviorAfterMergingFolder: string;
  shouldAskBeforeMerging: boolean;
  shouldOpenNoteAfterMergingFolderIntoFile: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: MergeSettings) => void): Promise<void>;
  settings: MergeSettings;
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
    const result = await evalInObsidian({
      async callback({
        app,
        lib: { waitUntil },
        mergedNotePath,
        mergeTimeoutInMilliseconds,
        nestedNoteCount,
        noFile,
        noteCount,
        obsidianModule,
        openTabCount,
        pluginId,
        sourceFolder
      }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const SUB_FOLDER = `${sourceFolder}/nested`;
        const HUB_NOTE_PATH = 'cif-cycle-hub.md';
        const FIRST_NOTE_PATH = `${sourceFolder}/cif-note-1.md`;

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        // EVERY activation, not only the interesting ones: when this comes back non-empty it is the recorded
        // Order that names the cause, and an assertion on a filtered list would have thrown that away.
        const activations: string[] = [];
        let eventRef: unknown = null;
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = false;
            // MUST stay off. This is the plugin's ONE deliberate open (issue #212); with it on the test
            // Would be watching that feature instead of the per-note suppression it is here to pin.
            settings.shouldOpenNoteAfterMergingFolderIntoFile = false;
            // The emptied folder disappearing is the post-commit signal this test waits on.
            settings.emptyFolderBehaviorAfterMergingFolder = 'Delete';
          });

          await trashIfExists(sourceFolder);
          await trashIfExists(mergedNotePath);
          await trashIfExists(HUB_NOTE_PATH);

          await app.vault.createFolder(sourceFolder);
          await app.vault.createFolder(SUB_FOLDER);
          // Cross-referencing notes, so the merge rewrites links between them as it goes...
          for (let index = 1; index <= noteCount; index++) {
            const next = index === noteCount ? 1 : index + 1;
            await app.vault.create(
              `${sourceFolder}/cif-note-${String(index)}.md`,
              `# Note ${String(index)}\n\nSee [[cif-note-${String(next)}]].\n`
            );
          }
          // ...plus a nested pair, so the recursive walk merges notes the folder's own listing never sees...
          for (let index = 1; index <= nestedNoteCount; index++) {
            await app.vault.create(
              `${SUB_FOLDER}/cif-nested-${String(index)}.md`,
              `# Nested ${String(index)}\n\nSee [[cif-note-1]].\n`
            );
          }
          // ...and a note OUTSIDE the folder linking in, so backlink rewriting runs against a note the merge
          // Is not deleting - the one link-rewrite path that could touch an open, surviving editor.
          await app.vault.create(HUB_NOTE_PATH, '# Hub\n\nSee [[cif-note-1]].\n');

          /*
           * The reporter's own setup, as far as it can be reconstructed: several of the folder's notes
           * sitting open in tabs while it is merged. This is what makes the suite bite - with a single
           * editor open there is only ever one leaf to lose, and the cascade this guards against has
           * nothing to walk through. They are opened in descending order so the LOWEST-numbered one ends up
           * active - the command resolves its folder from the ACTIVE file's parent, which also makes the
           * active note one of the notes merged away.
           */
          for (let index = openTabCount; index >= 1; index--) {
            const note = app.vault.getAbstractFileByPath(`${sourceFolder}/cif-note-${String(index)}.md`);
            if (!(note instanceof obsidianModule.TFile)) {
              throw new TypeError('A source note was not created.');
            }
            await openInNewTab(note);
          }
          if (app.workspace.getActiveFile()?.path !== FIRST_NOTE_PATH) {
            throw new Error('The merge must be triggered from a note inside the folder.');
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          eventRef = app.workspace.on('active-leaf-change', () => {
            activations.push(app.workspace.getActiveFile()?.path ?? noFile);
          });

          app.commands.executeCommandById(`${pluginId}:merge-folder-into-file`);

          await waitUntil({
            message: 'merged single file was not created',
            predicate: () => app.vault.getAbstractFileByPath(mergedNotePath) !== null,
            timeoutInMilliseconds: mergeTimeoutInMilliseconds
          });
          await waitUntil({
            message: 'the emptied folder was not deleted, so the merge had not committed',
            predicate: () => app.vault.getAbstractFileByPath(sourceFolder) === null,
            timeoutInMilliseconds: mergeTimeoutInMilliseconds
          });
          // Long enough for a late activation to reach the recorder before it is read.
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const mergedNote = app.vault.getAbstractFileByPath(mergedNotePath);
          const mergedContent = mergedNote instanceof obsidianModule.TFile ? await app.vault.read(mergedNote) : '';

          return {
            activations: [...activations],
            activePath: app.workspace.getActiveFile()?.path ?? null,
            // Proof the recording above is of a merge that actually happened: every note's heading landed in
            // The merged note. Without this an early bail-out would look like "no cycling" and pass.
            mergedHeadingCount: [...mergedContent.matchAll(/^# (?:Note|Nested) /gm)].length,
            sourceGone: app.vault.getAbstractFileByPath(sourceFolder) === null
          };
        } finally {
          if (eventRef) {
            app.workspace.offref(eventRef as Parameters<typeof app.workspace.offref>[0]);
          }
          // The merged note and the hub land at the vault root, which the whole aggregate shares.
          await trashIfExists(mergedNotePath);
          await trashIfExists(sourceFolder);
          await trashIfExists(HUB_NOTE_PATH);
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = original.shouldAskBeforeMerging;
            settings.shouldOpenNoteAfterMergingFolderIntoFile = original.shouldOpenNoteAfterMergingFolderIntoFile;
            settings.emptyFolderBehaviorAfterMergingFolder = original.emptyFolderBehaviorAfterMergingFolder;
          });
        }

        function findSettingsComponent(): SettingsCarrier {
          const plugin = app.plugins.getPlugin(pluginId) as ComponentTreeNode | null;
          const queue: ComponentTreeNode[] = plugin ? [plugin] : [];
          while (queue.length > 0) {
            const node = queue.shift();
            if (!node) {
              continue;
            }
            if (isSettingsComponent(node)) {
              return node;
            }
            if (node._children) {
              queue.push(...node._children);
            }
          }
          throw new Error('Settings component was not found.');
        }

        function isSettingsComponent(node: ComponentTreeNode): node is SettingsCarrier {
          return typeof node.editAndSave === 'function' && typeof node.settings?.shouldAskBeforeMerging === 'boolean';
        }

        async function openInNewTab(file: TFile): Promise<void> {
          await app.workspace.getLeaf('tab').openFile(file);
          await waitUntil({
            message: `editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
          });
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }
      },
      input: {
        mergedNotePath: MERGED_NOTE_PATH,
        mergeTimeoutInMilliseconds: MERGE_TIMEOUT_IN_MILLISECONDS,
        nestedNoteCount: NESTED_NOTE_COUNT,
        noFile: NO_FILE,
        noteCount: NOTE_COUNT,
        openTabCount: OPEN_TAB_COUNT,
        pluginId: PLUGIN_ID,
        sourceFolder: SOURCE_FOLDER
      },
      vaultPath: getTemporaryVault().path
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
    expect(result.activations.filter((activation) => isOwnNote(activation))).toEqual([]);
    // ...and the user is not LEFT in one either. With the open-after setting off nothing takes them to the
    // Merged note; the setting is what changes that, and it has its own suite.
    expect(isOwnNote(result.activePath ?? NO_FILE)).toBe(false);
  }, TEST_TIMEOUT_IN_MILLISECONDS);
});
