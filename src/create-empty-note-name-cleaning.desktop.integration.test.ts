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
 * Coverage for issue #283: the note name typed into either `Create empty note ...` command is cleaned the
 * way `Create folder with notes...` cleans a typed folder name — trimmed, whitespace runs collapsed, and
 * Title Cased when `shouldTitleCaseCreatedNoteName` is on.
 *
 * The reporter's own input is replayed: mixed casing and a long run of spaces between two words. Both entry
 * points are driven for real — the folder command through the file-explorer menu event and its prompt, the
 * cursor command through the split picker — because the second reaches the cleaning through a parameter
 * threaded across the picker, which no unit test sees end to end.
 *
 * Isolation: `npx vitest run --project integration-tests:desktop src/create-empty-note-name-cleaning.desktop.integration.test.ts`.
 */

const PLUGIN_ID = 'advanced-note-composer';

interface CleaningSettings {
  defaultSplitTargetMode: string;
  shouldAddCommandsToSubmenu: boolean;
  shouldAskBeforeSplitting: boolean;
  shouldAskForTargetFolderWhenSplitting: boolean;
  shouldChooseFolderBeforeNameWhenSplitting: boolean;
  shouldOpenTargetNoteAfterSplit: boolean;
  shouldSplitIntoFolder: boolean;
  shouldTitleCaseCreatedNoteName: boolean;
  splitTemplate: string;
  textAfterExtractionMode: string;
}

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: CleaningSettings;
}

interface MenuItemLike {
  callback?: (this: void) => unknown;
  dom?: HTMLElement;
}

interface MenuLike {
  hide: () => unknown;
  items: MenuItemLike[];
}

interface SettingsCarrier {
  editAndSave: (editor: (settings: CleaningSettings) => void) => Promise<void>;
  settings: CleaningSettings;
}

describe('clean the typed name of a created empty note (issue #283)', () => {
  it('title-cases and collapses the name typed into Create empty note in folder...', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        // Four waits share this, so the sum stays well under the transport's ~30 s per-closure cap.
        const WAIT_TIMEOUT_IN_MILLISECONDS = 5000;
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const FOLDER_PATH = 'create-empty-note-cleaning-folder';
        // The reporter's shape: mixed casing and a long run of spaces.
        const TYPED_NAME = '  cLeAnInG      gHoSt nOtE  ';
        const EXPECTED_PATH = `${FOLDER_PATH}/Cleaning Ghost Note.md`;
        const MENU_ITEM_TITLE = 'Create empty note in folder...';

        const settingsComponent = findSettingsComponent();
        const original = {
          shouldAddCommandsToSubmenu: settingsComponent.settings.shouldAddCommandsToSubmenu,
          shouldSplitIntoFolder: settingsComponent.settings.shouldSplitIntoFolder,
          shouldTitleCaseCreatedNoteName: settingsComponent.settings.shouldTitleCaseCreatedNoteName,
          splitTemplate: settingsComponent.settings.splitTemplate
        };
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAddCommandsToSubmenu = false;
            settings.shouldSplitIntoFolder = false;
            settings.shouldTitleCaseCreatedNoteName = true;
            settings.splitTemplate = '';
          });

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
            predicate: () => document.querySelector('.prompt-modal .text-box') !== null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const nameInput = document.querySelector('.prompt-modal .text-box');
          if (!(nameInput instanceof HTMLInputElement)) {
            throw new TypeError('No note name prompt input.');
          }
          nameInput.value = TYPED_NAME;
          nameInput.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: 'the typed note name never became valid',
            predicate: () => nameInput.checkValidity(),
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          const okButton = document.querySelector('.prompt-modal .ok-button');
          if (!(okButton instanceof HTMLElement)) {
            throw new TypeError('No note name prompt OK button.');
          }
          okButton.click();

          let createdPaths: string[] = [];
          await waitUntil({
            message: 'no note was created in the folder',
            predicate: () => {
              createdPaths = (app.vault.getFolderByPath(FOLDER_PATH)?.children ?? []).map((child) => child.path);
              return createdPaths.length > 0;
            },
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          return { createdPaths, expectedPath: EXPECTED_PATH };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAddCommandsToSubmenu = original.shouldAddCommandsToSubmenu;
            settings.shouldSplitIntoFolder = original.shouldSplitIntoFolder;
            settings.shouldTitleCaseCreatedNoteName = original.shouldTitleCaseCreatedNoteName;
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
            if (typeof node.editAndSave === 'function' && typeof node.settings?.defaultSplitTargetMode === 'string') {
              return node as SettingsCarrier;
            }
            if (node._children) {
              queue.push(...node._children);
            }
          }
          throw new Error('Settings component was not found.');
        }

        function findMenuItem(menuLike: MenuLike, title: string): MenuItemLike | undefined {
          return menuLike.items.find((item) => (item.dom?.textContent ?? '').includes(title));
        }

        async function ensureFolder(path: string): Promise<TFolder> {
          return app.vault.getFolderByPath(path) ?? await app.vault.createFolder(path);
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    expect(result.createdPaths).toEqual([result.expectedPath]);
  });

  it('collapses the name typed into Create empty note at cursor... and keeps its casing with title-casing off', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        // Four waits share this, so the sum stays well under the transport's ~30 s per-closure cap.
        const WAIT_TIMEOUT_IN_MILLISECONDS = 4500;
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const SOURCE_PATH = 'create-empty-note-cleaning-source.md';
        const SOURCE_CONTENT = 'alpha bravo';
        const TYPED_NAME = '  cUrSoR      cLeAnInG gHoSt  ';
        const EXPECTED_PATH = 'cUrSoR cLeAnInG gHoSt.md';
        const RAW_PATH = `${TYPED_NAME}.md`;

        const settingsComponent = findSettingsComponent();
        const original = {
          defaultSplitTargetMode: settingsComponent.settings.defaultSplitTargetMode,
          shouldAskBeforeSplitting: settingsComponent.settings.shouldAskBeforeSplitting,
          shouldAskForTargetFolderWhenSplitting: settingsComponent.settings.shouldAskForTargetFolderWhenSplitting,
          shouldChooseFolderBeforeNameWhenSplitting: settingsComponent.settings.shouldChooseFolderBeforeNameWhenSplitting,
          shouldOpenTargetNoteAfterSplit: settingsComponent.settings.shouldOpenTargetNoteAfterSplit,
          shouldSplitIntoFolder: settingsComponent.settings.shouldSplitIntoFolder,
          shouldTitleCaseCreatedNoteName: settingsComponent.settings.shouldTitleCaseCreatedNoteName,
          splitTemplate: settingsComponent.settings.splitTemplate,
          textAfterExtractionMode: settingsComponent.settings.textAfterExtractionMode
        };
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.defaultSplitTargetMode = 'Create';
            settings.shouldAskBeforeSplitting = false;
            settings.shouldAskForTargetFolderWhenSplitting = false;
            settings.shouldChooseFolderBeforeNameWhenSplitting = false;
            settings.shouldOpenTargetNoteAfterSplit = false;
            settings.shouldSplitIntoFolder = false;
            // Off, so the casing the user typed must survive while the spacing does not.
            settings.shouldTitleCaseCreatedNoteName = false;
            settings.splitTemplate = '';
            settings.textAfterExtractionMode = 'link';
          });

          const source = await resetFile(SOURCE_PATH, SOURCE_CONTENT);
          const editor = await openAndGetEditor(source);
          editor.setValue(SOURCE_CONTENT);
          editor.setCursor(editor.offsetToPos(SOURCE_CONTENT.length));

          // The vault is shared by every test in this file, so "a new note" means one that was not here before.
          const existingPaths = new Set(app.vault.getMarkdownFiles().map((file) => file.path));
          app.commands.executeCommandById(`${pluginId}:create-empty-note-at-cursor`);
          await waitUntil({
            message: 'the split picker did not open',
            predicate: () => document.querySelector('.prompt-input') !== null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No split picker input.');
          }
          input.value = TYPED_NAME;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          input.focus();
          // Forces a creation whatever the fuzzy list holds; the `Enter to create` row exists only on zero matches.
          await pressKey({ key: 'Enter', modifiers: ['Mod'] });

          // Waits on ANY new note rather than the expected one, so a wrong name is reported by the assertions
          // Outside rather than as a timeout here.
          await waitUntil({
            message: 'no note was created',
            predicate: () => app.vault.getMarkdownFiles().some((file) => !existingPaths.has(file.path)),
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await waitUntil({
            message: 'the link was never left at the cursor',
            predicate: () => editor.getValue() !== SOURCE_CONTENT,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          return {
            isCleanedCreated: app.vault.getAbstractFileByPath(EXPECTED_PATH) !== null,
            isRawCreated: app.vault.getAbstractFileByPath(RAW_PATH) !== null,
            sourceContent: editor.getValue()
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.defaultSplitTargetMode = original.defaultSplitTargetMode;
            settings.shouldAskBeforeSplitting = original.shouldAskBeforeSplitting;
            settings.shouldAskForTargetFolderWhenSplitting = original.shouldAskForTargetFolderWhenSplitting;
            settings.shouldChooseFolderBeforeNameWhenSplitting = original.shouldChooseFolderBeforeNameWhenSplitting;
            settings.shouldOpenTargetNoteAfterSplit = original.shouldOpenTargetNoteAfterSplit;
            settings.shouldSplitIntoFolder = original.shouldSplitIntoFolder;
            settings.shouldTitleCaseCreatedNoteName = original.shouldTitleCaseCreatedNoteName;
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
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
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
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    expect(result.isRawCreated).toBe(false);
    expect(result.isCleanedCreated).toBe(true);
    expect(result.sourceContent).toContain('cUrSoR cLeAnInG gHoSt');
  });
});
