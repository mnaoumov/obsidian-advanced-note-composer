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
 * Coverage for issue #244: creating an EMPTY note from the extract/split flow, and from the file explorer.
 *
 * Everything asserted here is unobservable from a unit test: `SplitFileModal` is `v8 ignore`d, the switch it
 * disables is DOM, and the folder command's whole point is the file-explorer menu entry. The two things that
 * would silently regress are the ones checked most directly — the created note being genuinely EMPTY (the
 * template must not wrap itself around nothing), and the cursor never leaving the source note.
 *
 * Isolation: `npx vitest run --project integration-tests:desktop src/create-empty-note.desktop.integration.test.ts`.
 */

const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: EmptyNoteSettings;
}

interface EmptyNoteSettings {
  defaultSplitTargetMode: string;
  shouldAddCommandsToSubmenu: boolean;
  shouldAskBeforeSplitting: boolean;
  shouldAskForTargetFolderWhenSplitting: boolean;
  shouldOpenTargetNoteAfterSplit: boolean;
  shouldShowModalInstructions: boolean;
  shouldSplitIntoFolder: boolean;
  textAfterExtractionMode: string;
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
  editAndSave(editor: (settings: EmptyNoteSettings) => void): Promise<void>;
  settings: EmptyNoteSettings;
}

describe('create an empty note (issue #244)', () => {
  it('creates an EMPTY note from the cursor, leaves a link behind and never navigates away', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        // Distinctive names: the whole aggregate run shares ONE vault, so a generic one would make another
        // Suite's link ambiguous.
        const SOURCE_PATH = 'create-empty-note-source.md';
        const GHOST_NAME = 'create-empty-note-ghost';
        const GHOST_PATH = `${GHOST_NAME}.md`;
        const SOURCE_CONTENT = 'alpha bravo';
        // Mid-text on purpose: the link has to land AT the cursor, with the text on both sides untouched.
        const CURSOR_OFFSET = 5;

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeSplitting = false;
            settings.shouldAskForTargetFolderWhenSplitting = false;
            settings.shouldOpenTargetNoteAfterSplit = false;
            settings.shouldSplitIntoFolder = false;
            settings.textAfterExtractionMode = 'link';
            // The switch is only rendered alongside the instructions it belongs to.
            settings.shouldShowModalInstructions = true;
            // Deliberately the WRONG mode: this flow has nothing to merge, so it must open in `Create`
            // Whatever the setting says.
            settings.defaultSplitTargetMode = 'Merge';
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

          const modeToggleEl = document.querySelector('.advanced-note-composer-split-target-mode .checkbox-container');
          const isModeToggleDisabled = modeToggleEl?.classList.contains('is-disabled') ?? false;
          const isModeToggleOn = modeToggleEl?.classList.contains('is-enabled') ?? false;
          const modeDescription = document.querySelector('.advanced-note-composer-split-target-mode .setting-item-description')?.textContent ?? '';

          typeIntoPicker(GHOST_NAME);
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          pressEnter();

          await waitUntil({
            message: 'the empty note was never created',
            predicate: () => app.vault.getAbstractFileByPath(GHOST_PATH) !== null
          });
          await waitUntil({
            message: 'the link was never left at the cursor',
            predicate: () => editor.getValue() !== SOURCE_CONTENT
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const ghost = app.vault.getAbstractFileByPath(GHOST_PATH);
          const ghostContent = ghost instanceof obsidianModule.TFile ? await app.vault.read(ghost) : 'MISSING';

          return {
            activePath: app.workspace.getActiveFile()?.path ?? '',
            ghostContent,
            isModeToggleDisabled,
            isModeToggleOn,
            modeDescription,
            sourceContent: editor.getValue()
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.defaultSplitTargetMode = original.defaultSplitTargetMode;
            settings.shouldAskBeforeSplitting = original.shouldAskBeforeSplitting;
            settings.shouldAskForTargetFolderWhenSplitting = original.shouldAskForTargetFolderWhenSplitting;
            settings.shouldOpenTargetNoteAfterSplit = original.shouldOpenTargetNoteAfterSplit;
            settings.shouldShowModalInstructions = original.shouldShowModalInstructions;
            settings.shouldSplitIntoFolder = original.shouldSplitIntoFolder;
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
          getPickerInput().focus();
          pressKey({ key: 'Enter' });
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
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The switch cannot be flipped to `Merge`, and says why — with `defaultSplitTargetMode` set to `Merge`,
    // Which the flow has to override.
    expect(result.isModeToggleOn).toBe(false);
    expect(result.isModeToggleDisabled).toBe(true);
    expect(result.modeDescription).toContain('nothing to merge');

    // The note is genuinely empty: the template must not have wrapped itself around no content.
    expect(result.ghostContent).toBe('');

    // The link landed AT the cursor, with the text on both sides intact...
    expect(result.sourceContent).toContain('create-empty-note-ghost');
    expect(result.sourceContent.startsWith('alpha')).toBe(true);
    expect(result.sourceContent.endsWith(' bravo')).toBe(true);

    // ...and the cursor never left the source note, which is the workflow the issue asks for.
    expect(result.activePath).toBe('create-empty-note-source.md');
  });

  it('creates an empty note in the folder right-clicked in the file explorer, and a folder note when asked', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const FOLDER_PATH = 'create-empty-note-folder';
        const NOTE_NAME = 'create-empty-note-in-folder-ghost';
        const NOTE_PATH = `${FOLDER_PATH}/${NOTE_NAME}.md`;
        // Issue #255: with `Should split into folder` on, the same command wraps the note in a folder of
        // Its own — which is a folder note, in one step.
        const FOLDER_NOTE_NAME = 'create-empty-note-folder-note';
        const FOLDER_NOTE_PATH = `${FOLDER_PATH}/${FOLDER_NOTE_NAME}/${FOLDER_NOTE_NAME}.md`;
        const MENU_ITEM_TITLE = 'Create empty note in folder...';

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        try {
          // Flat menu items (no submenu) so the command's item is directly in `menu.items`.
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAddCommandsToSubmenu = false;
          });

          await trashIfExists(NOTE_PATH);
          await trashIfExists(`${FOLDER_PATH}/${FOLDER_NOTE_NAME}`);
          await ensureFolder(FOLDER_PATH);

          const isMenuItemPresent = await didFolderMenuOfferCreate(NOTE_NAME, NOTE_PATH);
          const note = app.vault.getAbstractFileByPath(NOTE_PATH);

          await settingsComponent.editAndSave((settings) => {
            settings.shouldSplitIntoFolder = true;
          });
          await didFolderMenuOfferCreate(FOLDER_NOTE_NAME, FOLDER_NOTE_PATH);

          return {
            isFolderNoteCreated: app.vault.getAbstractFileByPath(FOLDER_NOTE_PATH) !== null,
            // Nothing was left at the un-wrapped path, so the note really MOVED rather than being copied.
            isFolderNoteLeftUnwrapped: app.vault.getAbstractFileByPath(`${FOLDER_PATH}/${FOLDER_NOTE_NAME}.md`) !== null,
            isMenuItemPresent,
            noteContent: note instanceof obsidianModule.TFile ? await app.vault.read(note) : 'MISSING'
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAddCommandsToSubmenu = original.shouldAddCommandsToSubmenu;
            settings.shouldSplitIntoFolder = original.shouldSplitIntoFolder;
          });
        }

        /**
         * Drives the real file-explorer entry point — the workspace event the plugin registers its item
         * on — and waits for the note to exist and be opened.
         *
         * @param name - The name to type into the prompt.
         * @param expectedPath - Where the note is expected to land.
         * @returns Whether the folder menu carried the command's item.
         */
        async function didFolderMenuOfferCreate(name: string, expectedPath: string): Promise<boolean> {
          const folder = await ensureFolder(FOLDER_PATH);
          const menu = new obsidianModule.Menu();
          app.workspace.trigger('file-menu', menu, folder, 'file-explorer-context-menu');
          const menuItem = findMenuItem(menu, MENU_ITEM_TITLE);
          const isMenuItemPresent = menuItem !== undefined;
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
          await submitName(name);

          await waitUntil({
            message: `the empty note was never created at ${expectedPath}`,
            predicate: () => app.vault.getAbstractFileByPath(expectedPath) !== null
          });
          await waitUntil({
            message: 'the created note was never opened',
            predicate: () => app.workspace.getActiveFile()?.path === expectedPath
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return isMenuItemPresent;
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
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The command really is on the file explorer's folder menu, which is where the issue asks for it.
    expect(result.isMenuItemPresent).toBe(true);
    expect(result.noteContent).toBe('');

    // Issue #255: the same command, with `Should split into folder` on, makes a folder note.
    expect(result.isFolderNoteCreated).toBe(true);
    expect(result.isFolderNoteLeftUnwrapped).toBe(false);
  });
});
