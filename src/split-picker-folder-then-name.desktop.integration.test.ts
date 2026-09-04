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
 * Coverage for issue #261: the split/extract picker's box does two jobs at once — what the user types
 * names the new note AND filters a list of notes that already exist, none of which they want. With
 * `Should choose the folder before the name when splitting` on, the picker is replaced by two plain
 * prompts: the folder first, the name second, with no suggestions under it.
 *
 * What only the real app can show is that the PICKER never appears and the two prompts do, in that order,
 * and that the note lands in the folder the first prompt chose. The unit tests pin the four conditions
 * that decide whether the pair runs at all.
 *
 * Isolation: `npx vitest run --project integration-tests:desktop src/split-picker-folder-then-name.desktop.integration.test.ts`.
 */

const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: FolderThenNameSettings;
}

interface FolderThenNameSettings {
  defaultSplitTargetMode: string;
  shouldAskBeforeSplitting: boolean;
  shouldAskForTargetFolderWhenSplitting: boolean;
  shouldChooseFolderBeforeNameWhenSplitting: boolean;
  shouldSplitHeadingsAutomatically: boolean;
  shouldSplitIntoFolder: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: FolderThenNameSettings) => void): Promise<void>;
  settings: FolderThenNameSettings;
}

describe('choosing the folder before the name (issue #261)', () => {
  it('asks for the folder, then the name, and never opens the target picker', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        // Distinctive on purpose: the whole aggregate run shares ONE vault.
        const SOURCE_PATH = 'folder-then-name-source.md';
        const FOLDER_PATH = 'folder-then-name-folder';
        const NEW_NOTE_NAME = 'folder-then-name-created';
        const EXPECTED_PATH = `${FOLDER_PATH}/${NEW_NOTE_NAME}.md`;
        // A note that already exists and whose name SHARES the prefix being typed. In the picker it would
        // Have been offered as a suggestion; the point of #261 is that the name box has no such list.
        const DECOY_PATH = `${FOLDER_PATH}/${NEW_NOTE_NAME}-decoy.md`;
        const SOURCE_CONTENT = 'alpha FOLDER-THEN-NAME-BODY omega\n';
        const SELECTED_TEXT = 'FOLDER-THEN-NAME-BODY';

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldChooseFolderBeforeNameWhenSplitting = true;
            settings.defaultSplitTargetMode = 'Create';
            // Straight through to the split: the confirmation dialog is another suite's subject, and a
            // Confirmed one re-arms `shouldAskBeforeSplitting` in the shared `data.json`.
            settings.shouldAskBeforeSplitting = false;
            // The #238 prompt must not ask a second time for a folder this flow already chose.
            settings.shouldAskForTargetFolderWhenSplitting = true;
            settings.shouldSplitIntoFolder = false;
            settings.shouldSplitHeadingsAutomatically = false;
          });

          await ensureFolder(FOLDER_PATH);
          await resetFile(DECOY_PATH, 'decoy body\n');
          await trashIfExists(EXPECTED_PATH);
          const source = await resetFile(SOURCE_PATH, SOURCE_CONTENT);

          const editor = await openAndGetEditor(source);
          editor.setValue(SOURCE_CONTENT);
          await waitUntil({
            message: 'the source editor did not catch up with the reset content',
            predicate: () => editor.getValue() === SOURCE_CONTENT
          });

          const selectionStart = SOURCE_CONTENT.indexOf(SELECTED_TEXT);
          editor.setSelection(editor.offsetToPos(selectionStart), editor.offsetToPos(selectionStart + SELECTED_TEXT.length));
          app.commands.executeCommandById(`${pluginId}:extract-current-selection`);

          // FIRST prompt: the folder picker. The target picker would have had `.prompt-input` too, so the
          // Placeholder is what tells them apart.
          await waitUntil({
            message: 'the folder prompt did not open',
            predicate: () => getPromptInput() !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const firstPromptPlaceholder = getPromptInput()?.placeholder ?? '';

          typeIntoPrompt(FOLDER_PATH);
          await waitUntil({
            message: 'the folder was not offered',
            predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent === FOLDER_PATH)
          });
          getPromptInput()?.focus();
          await pressKey({ key: 'Enter' });

          // SECOND prompt: the name box, which is a plain text prompt with no suggestion list at all.
          await waitUntil({
            message: 'the note name prompt did not open',
            predicate: () => document.querySelector('.prompt-modal .text-box') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const suggestionCountWhileNaming = document.querySelectorAll('.suggestion-item').length;

          await submitName(NEW_NOTE_NAME);

          await waitUntil({
            message: `the new note was not created at ${EXPECTED_PATH}`,
            predicate: () => app.vault.getAbstractFileByPath(EXPECTED_PATH) !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const createdNote = app.vault.getAbstractFileByPath(EXPECTED_PATH);
          const createdContent = createdNote instanceof obsidianModule.TFile ? await app.vault.read(createdNote) : '';
          const decoyFile = await resetFileHandle(DECOY_PATH);
          const decoyContent = await app.vault.read(decoyFile);
          await trashIfExists(EXPECTED_PATH);

          return {
            createdContent,
            firstPromptPlaceholder,
            suggestionCountWhileNaming,
            // The decoy is untouched: nothing merged into the note whose name the typed one starts with.
            wasDecoyMergedInto: decoyContent.includes(SELECTED_TEXT)
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
            if (isSettingsComponent(node)) {
              return node;
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

        function isSettingsComponent(node: ComponentTreeNode): node is SettingsCarrier {
          return typeof node.editAndSave === 'function' && typeof node.settings?.shouldChooseFolderBeforeNameWhenSplitting === 'boolean';
        }

        async function openAndGetEditor(file: TFile): Promise<Editor> {
          const leaf = app.workspace.getLeaf(false);
          await leaf.openFile(file);
          await waitUntil({
            message: `the editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
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

        async function resetFileHandle(path: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            return existing;
          }
          return app.vault.create(path, '');
        }

        async function submitName(name: string): Promise<void> {
          const nameInput = document.querySelector('.prompt-modal .text-box');
          if (!(nameInput instanceof HTMLInputElement)) {
            throw new TypeError('No note name prompt input.');
          }
          nameInput.value = name;
          // The modal tracks its value through the component's change handler, so a bare `value` assignment
          // Would be accepted and then submitted as an empty name.
          nameInput.dispatchEvent(new Event('input', { bubbles: true }));
          // The prompt validates ASYNCHRONOUSLY and starts out invalid, so a click before it settles is
          // Silently ignored.
          await waitUntil({
            message: 'the typed note name never became valid',
            predicate: () => nameInput.checkValidity()
          });
          const okButton = document.querySelector('.prompt-modal .ok-button');
          if (!(okButton instanceof HTMLElement)) {
            throw new TypeError('No note name prompt OK button.');
          }
          okButton.click();
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }

        function typeIntoPrompt(value: string): void {
          const input = getPromptInput();
          if (!input) {
            throw new TypeError('No prompt input.');
          }
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The FIRST thing on screen is the folder question, not the target picker.
    expect(result.firstPromptPlaceholder).toBe('Select folder to create the new note in...');

    // The whole of the report: while naming the note, nothing is offered underneath.
    expect(result.suggestionCountWhileNaming).toBe(0);

    // The note landed in the chosen folder, holding what was extracted.
    expect(result.createdContent).toContain('FOLDER-THEN-NAME-BODY');
    expect(result.wasDecoyMergedInto).toBe(false);
  });
});
