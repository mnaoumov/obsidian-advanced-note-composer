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

/*
 * Coverage for issue #280. `Should choose the folder before the name when splitting` (issue #261) replaces
 * the split/extract picker with a folder prompt and a name box — and the `Create` / `Merge` switch lives in
 * the picker, so with the setting on a split could only ever CREATE. The reporter asked for the switch back,
 * and for the name box to grow a `Change target folder` control and a minimize button while it was at it.
 *
 * What only the real app can show is that the three controls are really ON the box and really do what they
 * say: that `Change target folder` reopens the folder list with the typed name still in hand, and that
 * `Switch to merge` produces a picker that is actually in `Merge`. The unit tests pin the flow's branches
 * around them.
 *
 * Isolation: `npx vitest run --project integration-tests:desktop src/split-name-modal-detours.desktop.integration.test.ts`.
 */

const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: DetourSettings;
}

interface DetourSettings {
  defaultSplitTargetMode: string;
  shouldAskBeforeSplitting: boolean;
  shouldAskForTargetFolderWhenSplitting: boolean;
  shouldChooseFolderBeforeNameWhenSplitting: boolean;
  shouldSplitHeadingsAutomatically: boolean;
  shouldSplitIntoFolder: boolean;
}

interface SettingsCarrier {
  editAndSave: (editor: (settings: DetourSettings) => void) => Promise<void>;
  settings: DetourSettings;
}

describe('the name box\'s detours (issue #280)', () => {
  it('carries a minimize button and both detours, and Change target folder keeps the typed name', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        /**
         * Sized so the SUM of every wait this closure declares stays under the transport's ~30 s per-closure
         * cap, not at it: nine ceilings at 2250 ms is 20.3 s, leaving room for the three render delays below.
         * A helper that waits is charged once per CALL SITE and for every `waitUntil` inside it, so
         * `chooseFolder` costs two ceilings each time it is called - re-divide this budget by the new count,
         * not by the `waitUntil` calls the body shows.
         */
        const WAIT_TIMEOUT_IN_MILLISECONDS = 2250;
        const RENDER_DELAY_IN_MILLISECONDS = 300;
        // Distinctive on purpose: the whole aggregate run shares ONE vault.
        const SOURCE_PATH = 'name-detours-source.md';
        const FIRST_FOLDER_PATH = 'name-detours-first';
        const SECOND_FOLDER_PATH = 'name-detours-second';
        const NEW_NOTE_NAME = 'name-detours-created';
        const SOURCE_CONTENT = 'alpha NAME-DETOURS-BODY omega\n';
        const SELECTED_TEXT = 'NAME-DETOURS-BODY';

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        const originalSpellcheck = app.vault.getConfig('spellcheck');
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldChooseFolderBeforeNameWhenSplitting = true;
            settings.defaultSplitTargetMode = 'Create';
            settings.shouldAskBeforeSplitting = false;
            settings.shouldAskForTargetFolderWhenSplitting = true;
            settings.shouldSplitIntoFolder = false;
            settings.shouldSplitHeadingsAutomatically = false;
          });
          // The box names a note the user is INVENTING, so it must follow `Editor > Spellcheck` the way the
          // Dev-utils `prompt()` it replaces did (issue #233). Turned ON here because Obsidian's own
          // `AbstractTextComponent` hardcodes `spellcheck="false"`: with the setting off, a box that had
          // Lost the fix would be indistinguishable from one that still has it.
          app.vault.setConfig('spellcheck', true);

          await ensureFolder(FIRST_FOLDER_PATH);
          await ensureFolder(SECOND_FOLDER_PATH);
          await trashIfExists(`${FIRST_FOLDER_PATH}/${NEW_NOTE_NAME}.md`);
          await trashIfExists(`${SECOND_FOLDER_PATH}/${NEW_NOTE_NAME}.md`);
          const source = await resetFile(SOURCE_PATH, SOURCE_CONTENT);

          const editor = await openAndGetEditor(source);
          editor.setValue(SOURCE_CONTENT);
          const selectionStart = SOURCE_CONTENT.indexOf(SELECTED_TEXT);
          editor.setSelection(editor.offsetToPos(selectionStart), editor.offsetToPos(selectionStart + SELECTED_TEXT.length));
          app.commands.executeCommandById(`${pluginId}:extract-current-selection`);

          await chooseFolder(FIRST_FOLDER_PATH);
          await waitForNameBox();

          // The three things issue #280 asked for, read off the box that is actually on screen.
          const nameBoxEl = getNameBox();
          const minimizeButtonCount = nameBoxEl?.querySelectorAll('.minimize-button').length ?? -1;
          const detourLabels = getDetourButtons().map((button) => button.firstElementChild?.textContent ?? '');
          const isSwitchToMergeEnabled = !getDetourButton('Switch to merge')?.hasAttribute('disabled');
          // The folder already chosen is stated on the box, so `Change target folder` is not asking the user
          // To change something they cannot see.
          const chosenFolderText = nameBoxEl?.querySelector('.advanced-note-composer-split-note-name-folder')?.textContent ?? '';
          const nameBoxSpellcheck = getNameInput()?.getAttribute('spellcheck') ?? '<no name input>';

          typeName(NEW_NOTE_NAME);
          // Taken by SHORTCUT rather than by click, so both routes into the same action are proved: the sibling
          // Case presses the other button. A strip control registers its handler on the modal's scope and its
          // Button separately, and only one of the two is exercised by a click.
          await pressKey({ key: 'c', modifiers: ['Alt'] });

          // Back to the folder list, which is the detour's whole point.
          await waitUntil({
            message: 'the folder prompt did not reopen',
            predicate: () => getNameBox() === null && getPromptInput() !== null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await chooseFolder(SECOND_FOLDER_PATH);
          await waitForNameBox();

          const reopenedName = getNameInput()?.value ?? '';
          const reopenedFolderText = getNameBox()?.querySelector('.advanced-note-composer-split-note-name-folder')?.textContent ?? '';

          clickCreate();

          const expectedPath = `${SECOND_FOLDER_PATH}/${NEW_NOTE_NAME}.md`;
          await waitUntil({
            message: `the new note was not created at ${expectedPath}`,
            predicate: () => app.vault.getAbstractFileByPath(expectedPath) !== null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          const didLandInFirstFolder = app.vault.getAbstractFileByPath(`${FIRST_FOLDER_PATH}/${NEW_NOTE_NAME}.md`) !== null;
          await trashIfExists(expectedPath);

          return {
            chosenFolderText,
            detourLabels,
            didLandInFirstFolder,
            isSwitchToMergeEnabled,
            minimizeButtonCount,
            nameBoxSpellcheck,
            reopenedFolderText,
            reopenedName
          };
        } finally {
          app.vault.setConfig('spellcheck', originalSpellcheck);
          await settingsComponent.editAndSave((settings) => {
            settings.defaultSplitTargetMode = original.defaultSplitTargetMode;
            settings.shouldAskBeforeSplitting = original.shouldAskBeforeSplitting;
            settings.shouldAskForTargetFolderWhenSplitting = original.shouldAskForTargetFolderWhenSplitting;
            settings.shouldChooseFolderBeforeNameWhenSplitting = original.shouldChooseFolderBeforeNameWhenSplitting;
            settings.shouldSplitHeadingsAutomatically = original.shouldSplitHeadingsAutomatically;
            settings.shouldSplitIntoFolder = original.shouldSplitIntoFolder;
          });
        }

        async function chooseFolder(path: string): Promise<void> {
          await waitUntil({
            message: 'the folder prompt did not open',
            predicate: () => getPromptInput() !== null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          const input = getPromptInput();
          if (!input) {
            throw new TypeError('No folder prompt input.');
          }
          input.value = path;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: `the folder ${path} was not offered`,
            predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent === path),
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          input.focus();
          await pressKey({ key: 'Enter' });
        }

        function clickCreate(): void {
          const createButton = [...(getNameBox()?.querySelectorAll(':scope .modal-button-container button') ?? [])]
            .find((el) => el.textContent === 'Create');
          if (!(createButton instanceof HTMLElement)) {
            throw new TypeError('No Create button on the name box.');
          }
          createButton.click();
        }

        async function ensureFolder(path: string): Promise<void> {
          if (!app.vault.getAbstractFileByPath(path)) {
            await app.vault.createFolder(path);
          }
        }

        function findSettingsComponent(): SettingsCarrier {
          const plugin = app.plugins.getPlugin(pluginId) as ComponentTreeNode | null;
          const queue: ComponentTreeNode[] = plugin ? [plugin] : [];
          while (queue.length > 0) {
            const node = queue.shift();
            if (!node) {
              continue;
            }
            if (typeof node.editAndSave === 'function' && typeof node.settings?.shouldChooseFolderBeforeNameWhenSplitting === 'boolean') {
              return node as SettingsCarrier;
            }
            if (node._children) {
              queue.push(...node._children);
            }
          }
          throw new Error('Settings component was not found.');
        }

        function getDetourButton(label: string): HTMLElement | null {
          return getDetourButtons().find((button) => button.firstElementChild?.textContent === label) ?? null;
        }

        function getDetourButtons(): HTMLElement[] {
          return [...(getNameBox()?.querySelectorAll(':scope .modal-command') ?? [])].filter((el): el is HTMLElement => el.instanceOf(HTMLElement));
        }

        function getNameBox(): HTMLElement | null {
          const el = document.querySelector('.advanced-note-composer-split-note-name-modal');
          return el instanceof HTMLElement ? el : null;
        }

        function getNameInput(): HTMLInputElement | null {
          const input = getNameBox()?.querySelector('input[type="text"]');
          return input instanceof HTMLInputElement ? input : null;
        }

        function getPromptInput(): HTMLInputElement | null {
          const input = document.querySelector('.prompt-input');
          return input instanceof HTMLInputElement ? input : null;
        }

        async function openAndGetEditor(file: TFile): Promise<Editor> {
          const leaf = app.workspace.getLeaf(false);
          await leaf.openFile(file);
          await waitUntil({
            message: `the editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          await view.setState({ ...view.getState(), mode: 'source', source: true }, { history: false });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return view.editor;
        }

        async function resetFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          return app.vault.create(path, content);
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }

        function typeName(name: string): void {
          const input = getNameInput();
          if (!input) {
            throw new TypeError('No name input.');
          }
          input.value = name;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        async function waitForNameBox(): Promise<void> {
          await waitUntil({
            message: 'the name box did not open',
            predicate: () => getNameInput() !== null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // Exactly one minimize button, beside the native close button — the ask, and the reason the box is a
    // Modal of this plugin's own rather than a bare dev-utils `prompt()`.
    expect(result.minimizeButtonCount).toBe(1);

    expect(result.detourLabels).toStrictEqual(['Change target folder', 'Switch to merge']);
    expect(result.isSwitchToMergeEnabled).toBe(true);

    // The ATTRIBUTE, not the IDL property: what the fix removes is a hardcoded
    // `setAttribute('spellcheck', 'false')` in Obsidian's own `AbstractTextComponent`.
    expect(result.nameBoxSpellcheck).toBe('true');

    expect(result.chosenFolderText).toBe('The new note goes in name-detours-first.');
    expect(result.reopenedFolderText).toBe('The new note goes in name-detours-second.');

    // The name typed before the detour survives it — losing it turns "let me just change the folder" into a
    // Retype.
    expect(result.reopenedName).toBe('name-detours-created');

    // And the note lands in the SECOND folder: the detour's answer wins over the one it replaced.
    expect(result.didLandInFirstFolder).toBe(false);
  });

  it('hands the pass to a picker that is really in Merge when Switch to merge is pressed', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        /**
         * Seven ceilings at 2750 ms is 19.3 s, under the transport's ~30 s per-closure cap with room for the
         * two render delays. See the sibling case above before adding a call to a waiting helper.
         */
        const WAIT_TIMEOUT_IN_MILLISECONDS = 2750;
        const RENDER_DELAY_IN_MILLISECONDS = 300;
        const SOURCE_PATH = 'name-detours-merge-source.md';
        const FOLDER_PATH = 'name-detours-merge-folder';
        const TARGET_NAME = 'name-detours-merge-target';
        const TARGET_PATH = `${FOLDER_PATH}/${TARGET_NAME}.md`;
        const SOURCE_CONTENT = 'alpha NAME-DETOURS-MERGE-BODY omega\n';
        const SELECTED_TEXT = 'NAME-DETOURS-MERGE-BODY';

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldChooseFolderBeforeNameWhenSplitting = true;
            settings.defaultSplitTargetMode = 'Create';
            settings.shouldAskBeforeSplitting = false;
            settings.shouldAskForTargetFolderWhenSplitting = false;
            settings.shouldSplitIntoFolder = false;
            settings.shouldSplitHeadingsAutomatically = false;
          });

          await ensureFolder(FOLDER_PATH);
          await resetFile(TARGET_PATH, 'existing target body\n');
          const source = await resetFile(SOURCE_PATH, SOURCE_CONTENT);

          const editor = await openAndGetEditor(source);
          editor.setValue(SOURCE_CONTENT);
          const selectionStart = SOURCE_CONTENT.indexOf(SELECTED_TEXT);
          editor.setSelection(editor.offsetToPos(selectionStart), editor.offsetToPos(selectionStart + SELECTED_TEXT.length));
          app.commands.executeCommandById(`${pluginId}:extract-current-selection`);

          await chooseFolder(FOLDER_PATH);
          await waitUntil({
            message: 'the name box did not open',
            predicate: () => document.querySelector('.advanced-note-composer-split-note-name-modal input[type="text"]') !== null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const switchButton = [...document.querySelectorAll('.advanced-note-composer-split-note-name-modal .modal-command')]
            .find((el) => el.firstElementChild?.textContent === 'Switch to merge');
          if (!(switchButton instanceof HTMLElement)) {
            throw new TypeError('No Switch to merge button on the name box.');
          }
          switchButton.click();

          // The picker, and the switch that was unreachable before this issue.
          await waitUntil({
            message: 'the target picker did not open',
            predicate: () => document.querySelector('.advanced-note-composer-split-target-mode') !== null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const switchRowName = document.querySelector('.advanced-note-composer-split-target-mode .setting-item-name')?.textContent ?? '';
          const switchToggle = document.querySelector('.advanced-note-composer-split-target-mode .checkbox-container');
          const isToggleOn = switchToggle?.classList.contains('is-enabled') ?? false;
          // `Merge` opens EMPTY rather than holding the name that was being invented: that name is for a
          // Note which does not exist, and `Merge` searches notes that do (issue #237).
          const pickerInitialValue = getPromptInput()?.value ?? '<no picker input>';

          const pickerInput = getPromptInput();
          if (!pickerInput) {
            throw new TypeError('No picker input.');
          }
          pickerInput.value = TARGET_NAME;
          pickerInput.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: 'the existing target was not offered',
            predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(TARGET_NAME)),
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          pickerInput.focus();
          await pressKey({ key: 'Enter' });

          await waitUntil({
            message: 'the extracted text never reached the existing target',
            predicate: async () => {
              const currentContent = await readTarget();
              return currentContent.includes(SELECTED_TEXT);
            },
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          const targetContent = await readTarget();

          return {
            isToggleOn,
            pickerInitialValue,
            switchRowName,
            // Nothing new was created: the whole point is that this pass MERGED.
            wasNoteCreated: app.vault.getAbstractFileByPath(`${FOLDER_PATH}/${TARGET_NAME} 1.md`) !== null,
            wasTargetMergedInto: targetContent.includes(SELECTED_TEXT)
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.defaultSplitTargetMode = original.defaultSplitTargetMode;
            settings.shouldAskBeforeSplitting = original.shouldAskBeforeSplitting;
            settings.shouldAskForTargetFolderWhenSplitting = original.shouldAskForTargetFolderWhenSplitting;
            settings.shouldChooseFolderBeforeNameWhenSplitting = original.shouldChooseFolderBeforeNameWhenSplitting;
            settings.shouldSplitHeadingsAutomatically = original.shouldSplitHeadingsAutomatically;
            settings.shouldSplitIntoFolder = original.shouldSplitIntoFolder;
          });
        }

        async function chooseFolder(path: string): Promise<void> {
          await waitUntil({
            message: 'the folder prompt did not open',
            predicate: () => getPromptInput() !== null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          const input = getPromptInput();
          if (!input) {
            throw new TypeError('No folder prompt input.');
          }
          input.value = path;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: `the folder ${path} was not offered`,
            predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent === path),
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          input.focus();
          await pressKey({ key: 'Enter' });
        }

        async function ensureFolder(path: string): Promise<void> {
          if (!app.vault.getAbstractFileByPath(path)) {
            await app.vault.createFolder(path);
          }
        }

        function findSettingsComponent(): SettingsCarrier {
          const plugin = app.plugins.getPlugin(pluginId) as ComponentTreeNode | null;
          const queue: ComponentTreeNode[] = plugin ? [plugin] : [];
          while (queue.length > 0) {
            const node = queue.shift();
            if (!node) {
              continue;
            }
            if (typeof node.editAndSave === 'function' && typeof node.settings?.shouldChooseFolderBeforeNameWhenSplitting === 'boolean') {
              return node as SettingsCarrier;
            }
            if (node._children) {
              queue.push(...node._children);
            }
          }
          throw new Error('Settings component was not found.');
        }

        function getPromptInput(): HTMLInputElement | null {
          const input = document.querySelector('.prompt-input');
          return input instanceof HTMLInputElement ? input : null;
        }

        async function openAndGetEditor(file: TFile): Promise<Editor> {
          const leaf = app.workspace.getLeaf(false);
          await leaf.openFile(file);
          await waitUntil({
            message: `the editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          await view.setState({ ...view.getState(), mode: 'source', source: true }, { history: false });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return view.editor;
        }

        async function readTarget(): Promise<string> {
          const target = app.vault.getAbstractFileByPath(TARGET_PATH);
          return target instanceof obsidianModule.TFile ? app.vault.read(target) : '';
        }

        async function resetFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          return app.vault.create(path, content);
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The switch is back, and it is really ON: the picker states what it is about to do, and it says merge.
    expect(result.switchRowName).toBe('Merge into an existing note');
    expect(result.isToggleOn).toBe(true);

    expect(result.pickerInitialValue).toBe('');

    expect(result.wasTargetMergedInto).toBe(true);
    expect(result.wasNoteCreated).toBe(false);
  });
});
