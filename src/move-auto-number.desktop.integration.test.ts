import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

/**
 * @file
 *
 * Auto-numbering what a MOVE relocates (issue #273), against a real Obsidian.
 *
 * The flatten is the case worth spending a real vault on, and the move's single-item path is the degenerate
 * form of the same sequence — three things here cannot be answered by a mock:
 *
 * - the sibling scan reads `parentFolder.children` of the DESTINATION, which has to be a real folder holding
 *   real folders and notes;
 * - a flatten promotes several items in ONE transaction, renaming them one at a time, so the numbers have to
 *   advance across a vault that is changing under the loop;
 * - numbering a note renames it, and the links to it are only really updated by Obsidian's own rename.
 *
 * Desktop-only, matching the other folder-move suites, and for the same reason: file-move suites can hit the
 * documented headless rename wall (`renameFile` / `metadataCache.onCleanCache`) in a big aggregate.
 *
 * The settings written here are RESTORED in a `finally` and the fixture is trashed: `data.json` and the vault
 * are shared by the whole aggregate run, so a leaked numbering template would rename what every later
 * move/flatten suite promotes.
 *
 * Isolation: `npx vitest run --project integration-tests:desktop src/move-auto-number.desktop.integration.test.ts`.
 */

const PLUGIN_ID = 'advanced-note-composer';

const FOLDER_NAME_TEMPLATE = '{{index}}. {{safeFolderName}}';
const NOTE_NAME_TEMPLATE = '{{index}}. {{safeName}}';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: MoveAutoNumberSettings;
}

interface MoveAutoNumberSettings {
  numberedMovedFolderNameTemplate: string;
  numberedMovedNoteNameTemplate: string;
  shouldAskBeforeFlattening: boolean;
}

interface SettingsCarrier {
  editAndSave: (editor: (settings: MoveAutoNumberSettings) => void) => Promise<void>;
  settings: MoveAutoNumberSettings;
}

describe('auto-numbering what a move relocates (issue #273)', () => {
  it('numbers every item a flatten promotes, on two sequences, advancing across the batch', async () => {
    const result = await evalInObsidian({
      async callback({ app, folderNameTemplate, lib: { waitUntil }, noteNameTemplate, obsidianModule, pluginId }) {
        /*
         * Under the transport's ~30s per-closure cap, not at it. Nothing here declares a ceiling: the three
         * waits take the harness's documented 5_000 default, so the worst case is 15_000 plus two short
         * settles. Each wait reports its own message at five seconds, far short of the cap, so a genuine
         * failure is named rather than arriving as a transport timeout.
         */
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        // Distinctive names: the whole aggregate run shares ONE vault, and these are ROOT-level folders.
        const DESTINATION = 'move-auto-number-dst';
        const SOURCE_FOLDER = `${DESTINATION}/MoveAutoNumSrc`;

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.numberedMovedFolderNameTemplate = folderNameTemplate;
            settings.numberedMovedNoteNameTemplate = noteNameTemplate;
            // The dialog itself is covered by `folder-confirm.desktop.integration.test.ts`.
            settings.shouldAskBeforeFlattening = false;
          });

          // Rebuild from scratch, so nothing is de-duplicated against a previous run's leftovers.
          await trashIfExists(DESTINATION);
          await app.vault.createFolder(DESTINATION);
          /*
           * The destination's two sequences deliberately reach DIFFERENT highs: folders to `3`, notes to
           * `5`. A promoted folder must therefore land on `4` and a promoted note on `6` — which is only
           * possible if the two counters never consult each other.
           */
          await app.vault.createFolder(`${DESTINATION}/1. MoveAutoNumKeepA`);
          await app.vault.createFolder(`${DESTINATION}/3. MoveAutoNumKeepB`);
          await app.vault.create(`${DESTINATION}/2. MoveAutoNumNoteA.md`, 'a');
          await app.vault.create(`${DESTINATION}/5. MoveAutoNumNoteB.md`, 'b');

          await app.vault.createFolder(SOURCE_FOLDER);
          // Already numbered `7.`, so it must be RENUMBERED to `4.` rather than prefixed a second time.
          await app.vault.createFolder(`${SOURCE_FOLDER}/7. MoveAutoNumChild`);
          await app.vault.create(`${SOURCE_FOLDER}/7. MoveAutoNumChild/deep.md`, 'deep body');
          const looseNote = await app.vault.create(`${SOURCE_FOLDER}/MoveAutoNumLoose.md`, 'See [[deep]].');
          // A non-markdown file, which belongs to NO sequence and must come through untouched.
          await app.vault.create(`${SOURCE_FOLDER}/MoveAutoNumAsset.txt`, 'asset body');

          // Open a note inside the source so the folder command resolves the active file's parent folder.
          await openFile(looseNote);
          await waitUntil({
            message: 'link cache not ready',
            predicate: () => app.metadataCache.getFirstLinkpathDest('deep', looseNote.path)?.path === `${SOURCE_FOLDER}/7. MoveAutoNumChild/deep.md`
          });

          app.commands.executeCommandById(`${pluginId}:flatten-folder`);

          await waitUntil({
            message: 'the promoted items did not arrive under their numbered names',
            predicate: () =>
              app.vault.getAbstractFileByPath(`${DESTINATION}/4. MoveAutoNumChild/deep.md`) !== null
              && app.vault.getAbstractFileByPath(`${DESTINATION}/6. MoveAutoNumLoose.md`) !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          return {
            // `7. MoveAutoNumChild` was renumbered, not prefixed twice.
            isDoublePrefixAbsent: app.vault.getAbstractFileByPath(`${DESTINATION}/4. 7. MoveAutoNumChild`) === null,
            // The FOLDER sequence reached `3`, so the promoted folder is `4` — untouched by the notes' `5`.
            isFolderNumbered: app.vault.getAbstractFileByPath(`${DESTINATION}/4. MoveAutoNumChild/deep.md`) !== null,
            /*
             * The link survives the rename of BOTH ends — the note was renamed by the numbering and its
             * target was renamed by the promotion, which is the half a mock cannot answer.
             */
            isLinkResolved: app.metadataCache.getFirstLinkpathDest('deep', `${DESTINATION}/6. MoveAutoNumLoose.md`)?.path
              === `${DESTINATION}/4. MoveAutoNumChild/deep.md`,
            // The NOTE sequence reached `5`, so the promoted note is `6` — it skips past the folders' `3`.
            isNoteNumbered: app.vault.getAbstractFileByPath(`${DESTINATION}/6. MoveAutoNumLoose.md`) !== null,
            // A non-markdown file is in no sequence: never renamed, and it consumed no number either.
            isTextFileUntouched: app.vault.getAbstractFileByPath(`${DESTINATION}/MoveAutoNumAsset.txt`) !== null
          };
        } finally {
          // The vault is SHARED by the whole aggregate run. Leave nothing behind, settings included.
          await trashIfExists(DESTINATION);
          await settingsComponent.editAndSave((settings) => {
            settings.numberedMovedFolderNameTemplate = original.numberedMovedFolderNameTemplate;
            settings.numberedMovedNoteNameTemplate = original.numberedMovedNoteNameTemplate;
            settings.shouldAskBeforeFlattening = original.shouldAskBeforeFlattening;
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
            if (typeof node.editAndSave === 'function' && typeof node.settings?.numberedMovedFolderNameTemplate === 'string') {
              return node as SettingsCarrier;
            }
            if (node._children) {
              queue.push(...node._children);
            }
          }
          throw new Error('Settings component was not found.');
        }

        async function openFile(file: TFile): Promise<void> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `markdown view for ${file.path} did not become active`,
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
      input: { folderNameTemplate: FOLDER_NAME_TEMPLATE, noteNameTemplate: NOTE_NAME_TEMPLATE, pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    expect(result.isFolderNumbered).toBe(true);
    expect(result.isNoteNumbered).toBe(true);
    expect(result.isDoublePrefixAbsent).toBe(true);
    expect(result.isTextFileUntouched).toBe(true);
    expect(result.isLinkResolved).toBe(true);
  });
});
