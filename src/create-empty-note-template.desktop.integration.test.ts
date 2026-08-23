import type {
  Editor,
  TFile,
  TFolder
} from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

/*
 * Coverage for the follow-up to issue #244: a configured `Split template` fills the note the create
 * commands make, and its `{{content}}` — interpolating to nothing, since nothing was extracted — is where
 * the caret lands.
 *
 * Only a real Obsidian can answer the two questions that matter. The written content goes through the
 * template's frontmatter being hoisted out and merged into whatever the naming rules already wrote, which
 * unit tests mock; and the caret is a live editor's, placed after an asynchronous open by a poll that a
 * mock workspace never satisfies.
 *
 * The settings written here are RESTORED in a `finally`: `data.json` is shared by the whole aggregate run,
 * so a leaked `splitTemplate` would apply itself to every later split suite.
 *
 * Isolation: `npx vitest run --project integration-tests:desktop src/create-empty-note-template.desktop.integration.test.ts`.
 */

const PLUGIN_ID = 'advanced-note-composer';

const SPLIT_TEMPLATE = '# {{newTitle}}\n\n{{content}}\n\nfrom [[{{fromTitle}}]]';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: TemplateSettings;
}

interface MenuItemLike {
  callback?(this: void): unknown;
  dom?: HTMLElement;
}

interface MenuLike {
  hide(): unknown;
  items: MenuItemLike[];
}

interface SettingsCarrier {
  editAndSave(editor: (settings: TemplateSettings) => void): Promise<void>;
  settings: TemplateSettings;
}

interface TemplateSettings {
  defaultSplitTargetMode: string;
  shouldAddCommandsToSubmenu: boolean;
  shouldAskBeforeSplitting: boolean;
  shouldAskForTargetFolderWhenSplitting: boolean;
  shouldOpenTargetNoteAfterSplit: boolean;
  shouldSplitIntoFolder: boolean;
  splitTemplate: string;
  textAfterExtractionMode: string;
}

describe('the split template on the create-empty-note commands (issue #244)', () => {
  it('fills the note created at the cursor and lands the caret at the content token', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId, splitTemplate }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        // Distinctive names: the whole aggregate run shares ONE vault.
        const SOURCE_PATH = 'create-empty-note-template-source.md';
        const GHOST_NAME = 'create-empty-note-template-ghost';
        const GHOST_PATH = `${GHOST_NAME}.md`;
        const SOURCE_CONTENT = 'alpha bravo';
        const CURSOR_OFFSET = 5;

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeSplitting = false;
            settings.shouldAskForTargetFolderWhenSplitting = false;
            settings.shouldSplitIntoFolder = false;
            settings.textAfterExtractionMode = 'link';
            settings.splitTemplate = splitTemplate;
            // The caret is only observable in an editor, and this is the setting that opens one. Left OFF
            // The template is still written — that is the ghost-note workflow — but there is nothing to
            // Put a caret in.
            settings.shouldOpenTargetNoteAfterSplit = true;
          });

          await trashIfExists(GHOST_PATH);
          const source = await resetFile(SOURCE_PATH, SOURCE_CONTENT);
          const editor = await openAndGetEditor(source);
          // Reset through the EDITOR: an open buffer wins over `vault.modify`, so an offset-based cursor
          // Would otherwise land in the previous run's text.
          editor.setValue(SOURCE_CONTENT);
          await waitUntil({
            message: 'the source editor did not catch up with the reset content',
            predicate: () => editor.getValue() === SOURCE_CONTENT
          });
          editor.setCursor(editor.offsetToPos(CURSOR_OFFSET));

          app.commands.executeCommandById(`${pluginId}:create-empty-note-at-cursor`);
          await waitUntil({
            message: 'the split picker did not open',
            predicate: () => document.querySelector('.prompt') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          typeIntoPicker(GHOST_NAME);
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          pressEnter();

          await waitUntil({
            message: 'the templated note was never created',
            predicate: () => app.vault.getAbstractFileByPath(GHOST_PATH) !== null
          });
          const ghost = app.vault.getAbstractFileByPath(GHOST_PATH);
          const ghostContent = ghost instanceof obsidianModule.TFile ? await app.vault.read(ghost) : 'MISSING';

          const ghostEditor = await waitForEditor(GHOST_PATH, ghostContent);
          // The caret is placed once the editor holds the content, so give that step its own beat rather
          // Than waiting on the offset itself — a timed-out wait would throw away the value it observed.
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          return {
            caretOffset: ghostEditor.posToOffset(ghostEditor.getCursor()),
            ghostContent,
            sourceContent: editor.getValue()
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeSplitting = original.shouldAskBeforeSplitting;
            settings.shouldAskForTargetFolderWhenSplitting = original.shouldAskForTargetFolderWhenSplitting;
            settings.shouldOpenTargetNoteAfterSplit = original.shouldOpenTargetNoteAfterSplit;
            settings.shouldSplitIntoFolder = original.shouldSplitIntoFolder;
            settings.splitTemplate = original.splitTemplate;
            settings.textAfterExtractionMode = original.textAfterExtractionMode;
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
          return typeof node.editAndSave === 'function' && typeof node.settings?.defaultSplitTargetMode === 'string';
        }

        function getPickerInput(): HTMLInputElement {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No split picker input.');
          }
          return input;
        }

        function pressEnter(): void {
          getPickerInput().dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Enter', key: 'Enter' }));
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

        async function waitForEditor(path: string, content: string): Promise<Editor> {
          await waitUntil({
            message: `the editor for ${path} never showed the templated content`,
            predicate: () => {
              const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
              return view?.file?.path === path && view.editor.getValue() === content;
            }
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error(`No active markdown view for ${path}.`);
          }
          return view.editor;
        }

        async function resetFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          return await app.vault.create(path, content);
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }
      },
      input: { pluginId: PLUGIN_ID, splitTemplate: SPLIT_TEMPLATE },
      vaultPath: getTemporaryVault().path
    });

    // The note came out holding the template, with `{{content}}` interpolated to nothing.
    expect(result.ghostContent).toBe('# create-empty-note-template-ghost\n\n\n\nfrom [[create-empty-note-template-source]]');

    // ...and the caret sits exactly where `{{content}}` was — everything after it is the resolved tail.
    const tail = '\n\nfrom [[create-empty-note-template-source]]';
    expect(result.caretOffset).toBe(result.ghostContent.length - tail.length);

    // The source note still got its residual link.
    expect(result.sourceContent).toContain('create-empty-note-template-ghost');
  });

  it('fills the note created in a folder and lands the caret at the content token', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId, splitTemplate }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const FOLDER_PATH = 'create-empty-note-template-folder';
        const NOTE_NAME = 'create-empty-note-template-in-folder';
        const NOTE_PATH = `${FOLDER_PATH}/${NOTE_NAME}.md`;
        const MENU_ITEM_TITLE = 'Create empty note in folder...';

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        try {
          await settingsComponent.editAndSave((settings) => {
            // Flat menu items (no submenu) so the command's item is directly in `menu.items`.
            settings.shouldAddCommandsToSubmenu = false;
            settings.splitTemplate = splitTemplate;
          });

          await trashIfExists(NOTE_PATH);
          const folder = await ensureFolder(FOLDER_PATH);

          const menu = new obsidianModule.Menu();
          app.workspace.trigger('file-menu', menu, folder, 'file-explorer-context-menu');
          const menuItem = findMenuItem(menu, MENU_ITEM_TITLE);
          if (menuItem?.callback) {
            menuItem.callback();
          } else {
            menuItem?.dom?.click();
          }
          menu.hide();

          await waitUntil({
            message: 'the note name prompt did not open',
            predicate: () => document.querySelector('.prompt-modal .text-box') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          await submitName(NOTE_NAME);

          await waitUntil({
            message: 'the templated note was never created in the folder',
            predicate: () => app.vault.getAbstractFileByPath(NOTE_PATH) !== null
          });
          const note = app.vault.getAbstractFileByPath(NOTE_PATH);
          // Read AFTER the template has been applied: the note is created first and templated in its own
          // Transaction, so a read racing that write would see the empty note.
          await waitUntil({
            message: 'the created note was never templated',
            predicate: async () => note instanceof obsidianModule.TFile && (await app.vault.read(note)) !== ''
          });
          const noteContent = note instanceof obsidianModule.TFile ? await app.vault.read(note) : 'MISSING';

          const noteEditor = await waitForEditor(NOTE_PATH, noteContent);
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          return {
            caretOffset: noteEditor.posToOffset(noteEditor.getCursor()),
            noteContent
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAddCommandsToSubmenu = original.shouldAddCommandsToSubmenu;
            settings.splitTemplate = original.splitTemplate;
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
          return typeof node.editAndSave === 'function' && typeof node.settings?.defaultSplitTargetMode === 'string';
        }

        function findMenuItem(menuLike: MenuLike, title: string): MenuItemLike | undefined {
          return menuLike.items.find((item) => (item.dom?.textContent ?? '').includes(title));
        }

        async function ensureFolder(path: string): Promise<TFolder> {
          const existing = app.vault.getFolderByPath(path);
          if (existing) {
            return existing;
          }
          return await app.vault.createFolder(path);
        }

        async function waitForEditor(path: string, content: string): Promise<Editor> {
          await waitUntil({
            message: `the editor for ${path} never showed the templated content`,
            predicate: () => {
              const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
              return view?.file?.path === path && view.editor.getValue() === content;
            }
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error(`No active markdown view for ${path}.`);
          }
          return view.editor;
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
      },
      input: { pluginId: PLUGIN_ID, splitTemplate: SPLIT_TEMPLATE },
      vaultPath: getTemporaryVault().path
    });

    // No source note here, so the `from` half of the template resolves empty — which is the whole reason
    // The token resolver had to accept a `null` source.
    expect(result.noteContent).toBe('# create-empty-note-template-in-folder\n\n\n\nfrom [[]]');

    const tail = '\n\nfrom [[]]';
    expect(result.caretOffset).toBe(result.noteContent.length - tail.length);
  });
});
