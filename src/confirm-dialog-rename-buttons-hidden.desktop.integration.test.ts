import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

// Issue #214: the reporter who asked for the `Rename` buttons (issue #200) now wants them turn-off-able, so
// A vault whose note names come from `Create folder content template` cannot deviate from it by accident.
// Two independent flags, so this pins all four combinations against real Obsidian — and, with both off, that
// The dialog still PREVIEWS every note and still creates exactly what it previewed. No unit test can prove it:
// The buttons live in the dialog body, and the flags are read while that body is built.
// Desktop-only: folder flows, matching the plugin's established integration convention.
// Isolation: `npx vitest run --project integration-tests:desktop src/confirm-dialog-rename-buttons-hidden.desktop.integration.test.ts`.

const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: CreateFolderSettings;
}

interface CreateFolderSettings {
  newFolderContentTemplate: string;
  newFolderNameTemplate: string;
  shouldAskBeforeCreatingFolder: boolean;
  shouldOpenNoteAfterCreatingFolder: boolean;
  shouldRunTemplaterOnDestinationFile: boolean;
  shouldShowRenameButtonForCreatedFolder: boolean;
  shouldShowRenameButtonForCreatedNotes: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: CreateFolderSettings) => void): Promise<void>;
  settings: CreateFolderSettings;
}

describe('hiding the rename buttons in the create-folder confirmation (issue #214)', () => {
  it('drops each rename button independently and still creates what it previewed', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const PARENT = 'cfr-hidden-parent';
        const RENAME_BUTTON_SELECTOR = '.advanced-note-composer-confirm-rename-button';
        const NAME_ROW_SELECTOR = '.advanced-note-composer-confirm-name-row';

        const settingsComponent = findSettingsComponent();
        const originalSettings = { ...settingsComponent.settings };
        const originalNewFileLocation = app.vault.getConfig('newFileLocation');
        const originalNewFileFolderPath = app.vault.getConfig('newFileFolderPath');
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.newFolderNameTemplate = '{{index}}. {{safeFolderName}}';
            // Two notes, so "hidden per row" is distinguishable from "hidden altogether".
            settings.newFolderContentTemplate = '{{file}} {{safeFolderName}}.md\n# {{folderName}}\n{{file}} tasks.md\n- [ ] todo';
            settings.shouldAskBeforeCreatingFolder = true;
            settings.shouldOpenNoteAfterCreatingFolder = false;
            // Templater is not installed in the test vault; leaving this on would only add a warning notice.
            settings.shouldRunTemplaterOnDestinationFile = false;
          });

          await trashIfExists(PARENT);
          await app.vault.createFolder(PARENT);

          app.vault.setConfig('newFileLocation', 'folder');
          app.vault.setConfig('newFileFolderPath', PARENT);

          // One dialog per combination, each cancelled — so `{{index}}` still sees no sibling and every pass
          // Previews the same names.
          const bothShownCount = await countRenameButtons(true, true);
          const folderOnlyCount = await countRenameButtons(true, false);
          const notesOnlyCount = await countRenameButtons(false, true);

          await setRenameButtonSettings(false, false);
          await openConfirmDialog();
          const bothHiddenCount = document.querySelectorAll(RENAME_BUTTON_SELECTOR).length;
          // The PREVIEW is the reason the dialog exists, so hiding the buttons must not touch it: one row for
          // The folder and one per note.
          const bothHiddenRowCount = document.querySelectorAll(NAME_ROW_SELECTOR).length;

          findButton('Create')?.click();

          // A throwing wait would discard everything observed so far, so give up quietly and let the
          // Assertions outside Obsidian report what actually happened.
          try {
            await waitUntil({
              message: 'the folder was not created with the rename buttons hidden',
              predicate: () => app.vault.getFolderByPath(`${PARENT}/1. Alpha`) !== null
            });
          } catch {
            // Diagnostics are returned below.
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          return {
            bothHiddenCount,
            bothHiddenRowCount,
            bothShownCount,
            createdPaths: app.vault.getFolderByPath(`${PARENT}/1. Alpha`)?.children.map((child) => child.path).sort() ?? [],
            folderOnlyCount,
            notesOnlyCount
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            Object.assign(settings, originalSettings);
          });
          app.vault.setConfig('newFileLocation', originalNewFileLocation);
          app.vault.setConfig('newFileFolderPath', originalNewFileFolderPath);
        }

        async function countRenameButtons(shouldShowForFolder: boolean, shouldShowForNotes: boolean): Promise<number> {
          await setRenameButtonSettings(shouldShowForFolder, shouldShowForNotes);
          await openConfirmDialog();
          const count = document.querySelectorAll(RENAME_BUTTON_SELECTOR).length;
          findButton('Cancel')?.click();
          await waitUntil({
            message: 'the create dialog did not close',
            predicate: () => findButton('Create') === null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return count;
        }

        function findButton(text: string): HTMLButtonElement | null {
          for (const el of document.querySelectorAll('.modal-button-container button')) {
            if (el.instanceOf(HTMLButtonElement) && el.textContent === text) {
              return el;
            }
          }
          return null;
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

        function getPromptInput(): HTMLInputElement {
          const inputEl = document.querySelector('.prompt-modal .text-box');
          if (!(inputEl instanceof HTMLInputElement)) {
            throw new TypeError('No prompt input.');
          }
          return inputEl;
        }

        function isSettingsComponent(node: ComponentTreeNode): node is SettingsCarrier {
          return typeof node.editAndSave === 'function' && typeof node.settings?.newFolderNameTemplate === 'string';
        }

        async function openConfirmDialog(): Promise<void> {
          app.commands.executeCommandById(`${pluginId}:create-folder-with-notes`);

          await waitUntil({
            message: 'folder name prompt did not open',
            predicate: () => document.querySelector('.prompt-modal .text-box') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          await submitName('Alpha');

          await waitUntil({ message: 'create dialog did not open', predicate: () => findButton('Create') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        }

        async function setRenameButtonSettings(shouldShowForFolder: boolean, shouldShowForNotes: boolean): Promise<void> {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldShowRenameButtonForCreatedFolder = shouldShowForFolder;
            settings.shouldShowRenameButtonForCreatedNotes = shouldShowForNotes;
          });
        }

        async function submitName(name: string): Promise<void> {
          const nameInput = getPromptInput();
          nameInput.value = name;
          // The modal tracks its value through the component's change handler, so a bare `value` assignment
          // Would be accepted and then submitted as the seeded name.
          nameInput.dispatchEvent(new Event('input', { bubbles: true }));
          // The prompt validates ASYNCHRONOUSLY, so a click before it settles is silently ignored.
          await waitUntil({
            message: 'the typed name never became valid',
            predicate: () => nameInput.checkValidity()
          });
          const okButton = document.querySelector('.prompt-modal .ok-button');
          if (!(okButton instanceof HTMLElement)) {
            throw new TypeError('No prompt OK button.');
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
      input: { pluginId: PLUGIN_ID }
    });

    // The issue-#200 layout, unchanged while both flags are on: one for the folder, one per note.
    expect(result.bothShownCount).toBe(3);
    // Issue #214's literal ask: the `Notes that will be created` buttons gone, the folder's kept.
    expect(result.folderOnlyCount).toBe(1);
    expect(result.notesOnlyCount).toBe(2);
    expect(result.bothHiddenCount).toBe(0);
    // Every name is still previewed — only the buttons went away.
    expect(result.bothHiddenRowCount).toBe(3);
    // And what was previewed is what got created.
    expect(result.createdPaths).toEqual(['cfr-hidden-parent/1. Alpha/Alpha.md', 'cfr-hidden-parent/1. Alpha/tasks.md']);
  });
});
