import type {
  Editor,
  TFile
} from 'obsidian';

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
 * Auto-numbering what a split creates (issue #269), against a real Obsidian.
 *
 * Three things only a live vault can answer. The sibling scan reads `parentFolder.children`, so it needs a
 * real folder holding real folders and notes rather than a mock's array. The note side renumbers AFTER the
 * note exists, precisely because the destination is not settled until Obsidian's own new-file resolution
 * and de-duplication have run. And the recursive case is the reporter's actual ask â a tree produced by
 * passes that each create their note inside the folder the pass above just made.
 *
 * The reporter's example is reproduced verbatim, gap included: siblings `1.`, `3.`, `4.` continue at `5.`
 * and then `6.`, and the children of each new folder restart at `1.`.
 *
 * The settings written here are RESTORED in a `finally`: `data.json` is shared by the whole aggregate run,
 * so a leaked numbering template would rename what every later split suite creates.
 *
 * Isolation: `npx vitest run --project integration-tests:desktop src/split-auto-number.desktop.integration.test.ts`.
 */

const PLUGIN_ID = 'advanced-note-composer';

const FOLDER_NAME_TEMPLATE = '{{index}}. {{safeFolderName}}';
const NOTE_NAME_TEMPLATE = '{{index}}. {{safeName}}';

interface AutoNumberSettings {
  defaultSplitTargetMode: string;
  numberedSplitFolderNameTemplate: string;
  numberedSplitNoteNameTemplate: string;
  shouldAllowOnlyCurrentFolderByDefault: boolean;
  shouldAskBeforeSplitting: boolean;
  shouldAskForTargetFolderWhenSplitting: boolean;
  shouldSplitIntoFolder: boolean;
  shouldSplitRecursivelyIntoDefaultNewNoteFolder: boolean;
}

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: AutoNumberSettings;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: AutoNumberSettings) => void): Promise<void>;
  settings: AutoNumberSettings;
}

describe('auto-numbering what a split creates (issue #269)', () => {
  it('numbers the extracted NOTE, continuing the gapped sequence beside it', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, noteNameTemplate, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        // Distinctive names: the whole aggregate run shares ONE vault.
        const ROOT_FOLDER = 'split-auto-number-note';
        const SOURCE_PATH = `${ROOT_FOLDER}/Flat source.md`;
        const SOURCE_CONTENT = 'keep this fragment here';
        /*
         * Distinctive rather than the issue's bare `D`, and for the reason this feature makes vivid: the
         * vault is shared, the numbered note keeps the typed name as an ALIAS, and a one-letter alias is
         * exactly the row a later suite's picker would be offered and not expect. The recursive test below
         * keeps the issue's own names, being nested and short-lived.
         */
        const NEW_NOTE_NAME = 'AutoNumNote';
        const NUMBERED_PATH = `${ROOT_FOLDER}/5. ${NEW_NOTE_NAME}.md`;

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.numberedSplitNoteNameTemplate = noteNameTemplate;
            // The folder half must be OFF here, or there would be no note left to number.
            settings.numberedSplitFolderNameTemplate = '';
            settings.shouldSplitIntoFolder = false;
            settings.shouldAskBeforeSplitting = false;
            settings.shouldAskForTargetFolderWhenSplitting = false;
            // The new note has to land among the numbered siblings, not in Obsidian's default folder.
            settings.shouldAllowOnlyCurrentFolderByDefault = true;
            // A suite that confirmed a dialog can leave the picker in `Merge`, which creates nothing.
            settings.defaultSplitTargetMode = 'Create';
          });

          // Rebuild the fixture from scratch, so nothing is de-duplicated against a previous run.
          await trashIfExists(ROOT_FOLDER);
          await app.vault.createFolder(ROOT_FOLDER);
          // The reporter's own sequence, gap at `2.` included.
          await app.vault.create(`${ROOT_FOLDER}/1. AutoNumA.md`, 'a');
          await app.vault.create(`${ROOT_FOLDER}/3. AutoNumB.md`, 'b');
          await app.vault.create(`${ROOT_FOLDER}/4. AutoNumC.md`, 'c');
          // A numbered FOLDER beside them, to prove the note sequence does not count it.
          await app.vault.createFolder(`${ROOT_FOLDER}/9. AutoNumFolder`);

          const source = await app.vault.create(SOURCE_PATH, SOURCE_CONTENT);
          const editor = await openAndGetEditor(source);
          // Reset through the EDITOR: an open buffer wins over the file, so an offset-based selection
          // Would otherwise grab the previous run's text.
          editor.setValue(SOURCE_CONTENT);
          await waitUntil({
            message: 'the source editor did not catch up with the reset content',
            predicate: () => editor.getValue() === SOURCE_CONTENT
          });
          // Select "fragment".
          editor.setSelection(editor.offsetToPos(10), editor.offsetToPos(18));

          app.commands.executeCommandById(`${pluginId}:extract-current-selection`);
          await waitUntil({ message: 'the split picker did not open', predicate: () => document.querySelector('.prompt') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          typeIntoPicker(NEW_NOTE_NAME);
          /*
           * `Mod+Enter` rather than waiting for the `Enter to create` row, because that row is added ONLY
           * by `onNoSuggestion()` â i.e. only when the search matches nothing at all. In the shared
           * aggregate vault it usually matches something, and the fixtures here share a prefix with the
           * name on purpose, so waiting for it would be waiting for a row that is correctly absent.
           * `Mod+Enter` creates from what was typed whatever the list holds, which is the vault-independent
           * way to say "create".
           */
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          forceCreateFromTypedName();

          await waitUntil({
            message: 'the extracted note was not created under its numbered name',
            predicate: () => app.vault.getAbstractFileByPath(NUMBERED_PATH) instanceof obsidianModule.TFile
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const numbered = app.vault.getAbstractFileByPath(NUMBERED_PATH);
          const numberedContent = numbered instanceof obsidianModule.TFile ? await app.vault.read(numbered) : 'MISSING';

          /*
           * The one thing numbering AFTER the note exists could break: the residual link is written by the
           * composer from the same `TFile`, which `renameFile` mutated in place, so it has to name the
           * numbered note rather than the name the note was created under a moment earlier.
           */
          await waitUntil({
            message: 'the link left in the source did not resolve to the numbered note',
            predicate: () => Object.keys(app.metadataCache.resolvedLinks[SOURCE_PATH] ?? {}).includes(NUMBERED_PATH)
          });

          return {
            // The typed name is recorded as an alias / title, so a link to THAT still resolves too: the
            // `{{index}}` made the real name differ from what was typed, as a folder-note override does.
            hasTypedNameRecorded: numberedContent.includes(NEW_NOTE_NAME),
            isResidualLinkResolved: Object.keys(app.metadataCache.resolvedLinks[SOURCE_PATH] ?? {}).includes(NUMBERED_PATH),
            // Nothing was created under the unnumbered name.
            isUnnumberedAbsent: app.vault.getAbstractFileByPath(`${ROOT_FOLDER}/${NEW_NOTE_NAME}.md`) === null,
            numberedContent
          };
        } finally {
          // The vault is SHARED by the whole aggregate run, and what this test creates is numbered notes
          // Carrying the typed name as an ALIAS — which is exactly what would make a later suite's picker
          // Offer a row it does not expect. Leave nothing behind.
          await trashIfExists(ROOT_FOLDER);
          await settingsComponent.editAndSave((settings) => {
            settings.defaultSplitTargetMode = original.defaultSplitTargetMode;
            settings.numberedSplitFolderNameTemplate = original.numberedSplitFolderNameTemplate;
            settings.numberedSplitNoteNameTemplate = original.numberedSplitNoteNameTemplate;
            settings.shouldAllowOnlyCurrentFolderByDefault = original.shouldAllowOnlyCurrentFolderByDefault;
            settings.shouldAskBeforeSplitting = original.shouldAskBeforeSplitting;
            settings.shouldAskForTargetFolderWhenSplitting = original.shouldAskForTargetFolderWhenSplitting;
            settings.shouldSplitIntoFolder = original.shouldSplitIntoFolder;
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
            if (typeof node.editAndSave === 'function' && typeof node.settings?.defaultSplitTargetMode === 'string') {
              return node as SettingsCarrier;
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
            throw new TypeError('No split picker input.');
          }
          return input;
        }

        function forceCreateFromTypedName(): void {
          getPickerInput().focus();
          pressKey({ key: 'Enter', modifiers: ['Mod'] });
        }

        function typeIntoPicker(value: string): void {
          const input = getPickerInput();
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        async function openAndGetEditor(file: TFile): Promise<Editor> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `markdown view for ${file.path} did not become active`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          return view.editor;
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }
      },
      input: { noteNameTemplate: NOTE_NAME_TEMPLATE, pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // `1, 3, 4` continues at `5` â `1 + max`, not `count + 1`, and the gap at `2` is not backfilled.
    expect(result.numberedContent).toContain('fragment');
    expect(result.isUnnumberedAbsent).toBe(true);
    expect(result.hasTypedNameRecorded).toBe(true);
  });

  it('numbers the FOLDER instead, leaving the note inside it unnumbered', async () => {
    const result = await evalInObsidian({
      async callback({ app, folderNameTemplate, lib: { pressKey, waitUntil }, noteNameTemplate, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const ROOT_FOLDER = 'split-auto-number-folder';
        const SOURCE_PATH = `${ROOT_FOLDER}/Folder source.md`;
        const SOURCE_CONTENT = 'keep this fragment here';
        // Its own name, distinct from the other two tests': each numbered note keeps the typed name as an
        // ALIAS, so a name reused across tests would be an exact match and the picker would offer no
        // `Enter to create` row at all.
        const NEW_NOTE_NAME = 'AutoNumOwnFolder';
        const NUMBERED_NOTE_PATH = `${ROOT_FOLDER}/5. ${NEW_NOTE_NAME}/${NEW_NOTE_NAME}.md`;

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.numberedSplitFolderNameTemplate = folderNameTemplate;
            // BOTH are set, deliberately: the folder template must win, or the number lands twice.
            settings.numberedSplitNoteNameTemplate = noteNameTemplate;
            settings.shouldSplitIntoFolder = true;
            settings.shouldAskBeforeSplitting = false;
            settings.shouldAskForTargetFolderWhenSplitting = false;
            settings.shouldAllowOnlyCurrentFolderByDefault = true;
            settings.defaultSplitTargetMode = 'Create';
          });

          await trashIfExists(ROOT_FOLDER);
          await app.vault.createFolder(ROOT_FOLDER);
          await app.vault.createFolder(`${ROOT_FOLDER}/1. AutoNumA`);
          await app.vault.createFolder(`${ROOT_FOLDER}/3. AutoNumB`);
          await app.vault.createFolder(`${ROOT_FOLDER}/4. AutoNumC`);
          // A numbered NOTE beside them, to prove the folder sequence does not count it.
          await app.vault.create(`${ROOT_FOLDER}/9. AutoNumNeighbor.md`, 'note');

          const source = await app.vault.create(SOURCE_PATH, SOURCE_CONTENT);
          const editor = await openAndGetEditor(source);
          editor.setValue(SOURCE_CONTENT);
          await waitUntil({
            message: 'the source editor did not catch up with the reset content',
            predicate: () => editor.getValue() === SOURCE_CONTENT
          });
          editor.setSelection(editor.offsetToPos(10), editor.offsetToPos(18));

          app.commands.executeCommandById(`${pluginId}:extract-current-selection`);
          await waitUntil({ message: 'the split picker did not open', predicate: () => document.querySelector('.prompt') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          typeIntoPicker(NEW_NOTE_NAME);
          /*
           * `Mod+Enter` rather than waiting for the `Enter to create` row, because that row is added ONLY
           * by `onNoSuggestion()` â i.e. only when the search matches nothing at all. In the shared
           * aggregate vault it usually matches something, and the fixtures here share a prefix with the
           * name on purpose, so waiting for it would be waiting for a row that is correctly absent.
           * `Mod+Enter` creates from what was typed whatever the list holds, which is the vault-independent
           * way to say "create".
           */
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          forceCreateFromTypedName();

          await waitUntil({
            message: 'the extracted note was not created inside its numbered folder',
            predicate: () => app.vault.getAbstractFileByPath(NUMBERED_NOTE_PATH) instanceof obsidianModule.TFile
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const numbered = app.vault.getAbstractFileByPath(NUMBERED_NOTE_PATH);

          return {
            isFolderNumbered: app.vault.getAbstractFileByPath(`${ROOT_FOLDER}/5. ${NEW_NOTE_NAME}`) instanceof obsidianModule.TFolder,
            // The note kept the typed name â the folder around it carries the number.
            isNoteUnnumbered: numbered instanceof obsidianModule.TFile,
            numberedContent: numbered instanceof obsidianModule.TFile ? await app.vault.read(numbered) : 'MISSING'
          };
        } finally {
          // The vault is SHARED by the whole aggregate run, and what this test creates is numbered notes
          // Carrying the typed name as an ALIAS — which is exactly what would make a later suite's picker
          // Offer a row it does not expect. Leave nothing behind.
          await trashIfExists(ROOT_FOLDER);
          await settingsComponent.editAndSave((settings) => {
            settings.defaultSplitTargetMode = original.defaultSplitTargetMode;
            settings.numberedSplitFolderNameTemplate = original.numberedSplitFolderNameTemplate;
            settings.numberedSplitNoteNameTemplate = original.numberedSplitNoteNameTemplate;
            settings.shouldAllowOnlyCurrentFolderByDefault = original.shouldAllowOnlyCurrentFolderByDefault;
            settings.shouldAskBeforeSplitting = original.shouldAskBeforeSplitting;
            settings.shouldAskForTargetFolderWhenSplitting = original.shouldAskForTargetFolderWhenSplitting;
            settings.shouldSplitIntoFolder = original.shouldSplitIntoFolder;
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
            if (typeof node.editAndSave === 'function' && typeof node.settings?.defaultSplitTargetMode === 'string') {
              return node as SettingsCarrier;
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
            throw new TypeError('No split picker input.');
          }
          return input;
        }

        function forceCreateFromTypedName(): void {
          getPickerInput().focus();
          pressKey({ key: 'Enter', modifiers: ['Mod'] });
        }

        function typeIntoPicker(value: string): void {
          const input = getPickerInput();
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        async function openAndGetEditor(file: TFile): Promise<Editor> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `markdown view for ${file.path} did not become active`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          return view.editor;
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
    expect(result.isNoteUnnumbered).toBe(true);
    expect(result.numberedContent).toContain('fragment');
  });

  it('reproduces the reporter\'s recursive tree, with children restarting at 1 per parent', async () => {
    const result = await evalInObsidian({
      async callback({ app, folderNameTemplate, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const ROOT_FOLDER = 'split-auto-number-recursive';
        const SOURCE_PATH = `${ROOT_FOLDER}/Recursive source.md`;
        const SOURCE_CONTENT = [
          '# D',
          '',
          'body of D',
          '',
          '## DD',
          '',
          'body of DD',
          '',
          '## DD2',
          '',
          'body of DD2',
          '',
          '# F',
          '',
          'body of F',
          '',
          '## FF',
          '',
          'body of FF',
          '',
          '## FF2',
          '',
          'body of FF2',
          ''
        ].join('\n');
        const HEADING_COUNT = 6;
        // The issue's expected hierarchy, verbatim.
        const EXPECTED_PATHS = [
          `${ROOT_FOLDER}/5. D/D.md`,
          `${ROOT_FOLDER}/5. D/1. DD/DD.md`,
          `${ROOT_FOLDER}/5. D/2. DD2/DD2.md`,
          `${ROOT_FOLDER}/6. F/F.md`,
          `${ROOT_FOLDER}/6. F/1. FF/FF.md`,
          `${ROOT_FOLDER}/6. F/2. FF2/FF2.md`
        ];

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.numberedSplitFolderNameTemplate = folderNameTemplate;
            // A recursive split ALWAYS makes folders, whatever `Should split into folder` says, so the
            // Note template must never get a look in â leaving it set is what proves that.
            settings.numberedSplitNoteNameTemplate = '';
            settings.shouldSplitIntoFolder = false;
            settings.shouldAskBeforeSplitting = false;
            // The tree has to be rooted beside the source, among the numbered siblings.
            settings.shouldSplitRecursivelyIntoDefaultNewNoteFolder = false;
            settings.defaultSplitTargetMode = 'Create';
          });

          await trashIfExists(ROOT_FOLDER);
          await app.vault.createFolder(ROOT_FOLDER);
          await app.vault.createFolder(`${ROOT_FOLDER}/1. A`);
          await app.vault.createFolder(`${ROOT_FOLDER}/1. A/1. AA`);
          await app.vault.createFolder(`${ROOT_FOLDER}/3. B`);
          await app.vault.createFolder(`${ROOT_FOLDER}/4. C`);

          const source = await app.vault.create(SOURCE_PATH, SOURCE_CONTENT);
          const editor = await openAndGetEditor(source);
          editor.setValue(SOURCE_CONTENT);
          await waitUntil({
            message: 'the source editor did not catch up with the reset content',
            predicate: () => editor.getValue() === SOURCE_CONTENT
          });
          editor.setCursor({ ch: 0, line: 0 });

          // A cache-gated command silently no-ops if the headings are not indexed yet, and the timeout
          // Then blames the split.
          await waitUntil({
            message: 'the metadata cache did not index the source headings',
            predicate: () => (app.metadataCache.getFileCache(source)?.headings ?? []).length === HEADING_COUNT
          });

          app.commands.executeCommandById(`${pluginId}:split-note-by-headings-recursively`);

          await waitUntil({
            message: 'the recursive split did not produce the whole numbered tree',
            predicate: () => EXPECTED_PATHS.every((path) => app.vault.getAbstractFileByPath(path) instanceof obsidianModule.TFile)
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const rootFolder = app.vault.getAbstractFileByPath(ROOT_FOLDER);
          const rootChildNames = rootFolder instanceof obsidianModule.TFolder
            ? rootFolder.children.filter((child) => child instanceof obsidianModule.TFolder).map((child) => child.name).sort()
            : [];

          return { rootChildNames };
        } finally {
          // The vault is SHARED by the whole aggregate run, and what this test creates is numbered notes
          // Carrying the typed name as an ALIAS — which is exactly what would make a later suite's picker
          // Offer a row it does not expect. Leave nothing behind.
          await trashIfExists(ROOT_FOLDER);
          await settingsComponent.editAndSave((settings) => {
            settings.defaultSplitTargetMode = original.defaultSplitTargetMode;
            settings.numberedSplitFolderNameTemplate = original.numberedSplitFolderNameTemplate;
            settings.numberedSplitNoteNameTemplate = original.numberedSplitNoteNameTemplate;
            settings.shouldAskBeforeSplitting = original.shouldAskBeforeSplitting;
            settings.shouldSplitIntoFolder = original.shouldSplitIntoFolder;
            settings.shouldSplitRecursivelyIntoDefaultNewNoteFolder = original.shouldSplitRecursivelyIntoDefaultNewNoteFolder;
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
            if (typeof node.editAndSave === 'function' && typeof node.settings?.defaultSplitTargetMode === 'string') {
              return node as SettingsCarrier;
            }
            if (node._children) {
              queue.push(...node._children);
            }
          }
          throw new Error('Settings component was not found.');
        }

        async function openAndGetEditor(file: TFile): Promise<Editor> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `markdown view for ${file.path} did not become active`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          return view.editor;
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }
      },
      input: { folderNameTemplate: FOLDER_NAME_TEMPLATE, pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // `1, 3, 4` continues at `5` and then `6`; the gap at `2` stays a gap.
    expect(result.rootChildNames).toEqual(['1. A', '3. B', '4. C', '5. D', '6. F']);
  });
});
