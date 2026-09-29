import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only: the picker's rendering is `v8 ignore`d UI code, so only the real app shows what a row reads.
// Isolation: `npx vitest run --project integration-tests:desktop src/hide-folder-note-name-in-pickers.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: FolderNoteNameSettings;
}

interface FolderNoteNameSettings {
  folderNoteLocation: string;
  folderNoteNameTemplate: string;
  shouldAllowOnlyCurrentFolderByDefault: boolean;
  shouldHideFolderNoteNameInPickers: boolean;
}

interface SettingsCarrier {
  editAndSave: (editor: (settings: FolderNoteNameSettings) => void) => Promise<void>;
  settings: FolderNoteNameSettings;
}

describe('hiding the folder note name in pickers (issue #304)', () => {
  it('shows a folder note by its folder\'s path when on, and by its full path when off', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, pluginId }) {
        /**
         * Sized so the SUM of every wait this closure declares stays well under the transport's ~30 s
         * per-closure cap: two `readTitles` calls at three waits each is six call sites, 18 s at 3 s each.
         * Every one of them settles in well under a second on a healthy machine.
         */
        const WAIT_TIMEOUT_IN_MILLISECONDS = 3000;
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const PARENT_FOLDER = 't2601-projects';
        const FOLDER = `${PARENT_FOLDER}/t2601-alpha`;
        const FOLDER_NOTE_PATH = `${FOLDER}/t2601-alpha.md`;
        const OTHER_NOTE_PATH = `${FOLDER}/t2601-beta.md`;
        const SOURCE_PATH = 't2601-source.md';

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };

        try {
          await app.vault.createFolder(PARENT_FOLDER);
          await app.vault.createFolder(FOLDER);
          await app.vault.create(FOLDER_NOTE_PATH, 'folder note body');
          await app.vault.create(OTHER_NOTE_PATH, 'other note body');
          const source = await app.vault.create(SOURCE_PATH, 'source body');

          await settingsComponent.editAndSave((settings) => {
            // Said outright rather than left at `Auto`, so the answer does not depend on whether the
            // `folder-notes` plugin happens to be installed in the test vault.
            settings.folderNoteLocation = 'InsideFolder';
            settings.folderNoteNameTemplate = '{{folderName}}';
            // The notes sit in another folder than the source, so leaving this on would filter them out.
            settings.shouldAllowOnlyCurrentFolderByDefault = false;
            settings.shouldHideFolderNoteNameInPickers = true;
          });
          const titlesWhenOn = await readTitles(source);

          await settingsComponent.editAndSave((settings) => {
            settings.shouldHideFolderNoteNameInPickers = false;
          });
          const titlesWhenOff = await readTitles(source);

          return { titlesWhenOff, titlesWhenOn };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.folderNoteLocation = original.folderNoteLocation;
            settings.folderNoteNameTemplate = original.folderNoteNameTemplate;
            settings.shouldAllowOnlyCurrentFolderByDefault = original.shouldAllowOnlyCurrentFolderByDefault;
            settings.shouldHideFolderNoteNameInPickers = original.shouldHideFolderNoteNameInPickers;
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
            if (typeof node.editAndSave === 'function' && typeof node.settings?.shouldHideFolderNoteNameInPickers === 'boolean') {
              const carrier: unknown = node;
              return carrier as SettingsCarrier;
            }
            if (node._children) {
              queue.push(...node._children);
            }
          }
          throw new Error('Settings component was not found.');
        }

        function getPickerInput(): HTMLInputElement {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No merge picker input.');
          }
          return input;
        }

        function getTitles(): string[] {
          return [...document.querySelectorAll('.suggestion-title')].map((el) => el.textContent);
        }

        /**
         * Opens the merge picker on the source note, types the shared prefix, and reads every row it shows.
         *
         * Waits for the OTHER note's row, which reads the same either way, so an empty list cannot pass as
         * "the folder note is shown differently".
         *
         * @param sourceFile - The note to run the merge from.
         * @returns The rows' titles.
         */
        async function readTitles(sourceFile: TFile): Promise<string[]> {
          await app.workspace.getLeaf(false).openFile(sourceFile);
          await waitUntil({
            message: `${sourceFile.path} did not become active`,
            predicate: () => app.workspace.getActiveFile()?.path === sourceFile.path,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          app.commands.executeCommandById(`${pluginId}:merge-file`);
          await waitUntil({
            message: 'the merge picker did not open',
            predicate: () => document.querySelector('.prompt') !== null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const input = getPickerInput();
          input.value = 't2601';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: 'the other note did not appear as a suggestion',
            predicate: () => getTitles().includes(OTHER_NOTE_PATH.replace(/\.md$/, '')),
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          const titles = getTitles();
          input.focus();
          await pressKey({ key: 'Escape' });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return titles;
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    expect(result.titlesWhenOn).toContain('t2601-projects/t2601-alpha');
    expect(result.titlesWhenOn).not.toContain('t2601-projects/t2601-alpha/t2601-alpha');
    expect(result.titlesWhenOn).toContain('t2601-projects/t2601-alpha/t2601-beta');

    expect(result.titlesWhenOff).toContain('t2601-projects/t2601-alpha/t2601-alpha');
    expect(result.titlesWhenOff).not.toContain('t2601-projects/t2601-alpha');
    expect(result.titlesWhenOff).toContain('t2601-projects/t2601-alpha/t2601-beta');
  });
});
