import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

// Issue #199: `Change target` did nothing in the `Create folder with notes...` confirmation. Its parent is
// Decided BEFORE the user is asked (the right-clicked folder, or Obsidian's default new-note location), so
// The dialog is the only place it can be changed. This also pins the half the unit tests cannot: the whole
// Plan is REBUILT for the picked parent, so `{{index}}` counts the NEW parent's children.
// Desktop-only: folder flows, matching the plugin's established integration convention.
// Isolation: `npx vitest run --project integration-tests:desktop src/confirm-dialog-change-target-create-folder.desktop.integration.test.ts`.

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
}

interface SettingsCarrier {
  editAndSave(editor: (settings: CreateFolderSettings) => void): Promise<void>;
  settings: CreateFolderSettings;
}

describe('change target from the create-folder confirmation dialog (issue #199)', () => {
  it('opens the parent picker and rebuilds the plan, numbering against the newly chosen parent', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const ORIGINAL_PARENT = 'ctc-original';
        const PICKED_PARENT = 'ctc-picked';

        const settingsComponent = findSettingsComponent();
        const originalSettings = { ...settingsComponent.settings };
        const originalNewFileLocation = app.vault.getConfig('newFileLocation');
        const originalNewFileFolderPath = app.vault.getConfig('newFileFolderPath');
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.newFolderNameTemplate = '{{index}}. {{safeFolderName}}';
            settings.newFolderContentTemplate = '{{file}} {{safeFolderName}}.md\n# {{folderName}}';
            settings.shouldAskBeforeCreatingFolder = true;
            settings.shouldOpenNoteAfterCreatingFolder = false;
            // Templater is not installed in the test vault; leaving this on would only add a warning notice.
            settings.shouldRunTemplaterOnDestinationFile = false;
          });

          await trashIfExists(ORIGINAL_PARENT);
          await trashIfExists(PICKED_PARENT);
          await app.vault.createFolder(ORIGINAL_PARENT);
          await app.vault.createFolder(PICKED_PARENT);
          /*
           * Different sibling counts on purpose: the original parent would number the new folder `2.`, the
           * picked one `4.`. A plan carried over instead of rebuilt would keep saying `2.`, which is exactly
           * the drift this asserts against.
           */
          await app.vault.createFolder(`${ORIGINAL_PARENT}/1. Existing`);
          await app.vault.createFolder(`${PICKED_PARENT}/1. One`);
          await app.vault.createFolder(`${PICKED_PARENT}/2. Two`);
          await app.vault.createFolder(`${PICKED_PARENT}/3. Three`);

          app.vault.setConfig('newFileLocation', 'folder');
          app.vault.setConfig('newFileFolderPath', ORIGINAL_PARENT);

          app.commands.executeCommandById(`${pluginId}:create-folder-with-notes`);

          await waitUntil({
            message: 'folder name prompt did not open',
            predicate: () => document.querySelector('.prompt-modal .text-box') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          await submitName('Alpha');

          await waitUntil({ message: 'create dialog did not open', predicate: () => findButton('Create') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const isChangeTargetEnabled = !(findButton('Change target')?.disabled ?? true);

          findButton('Change target')?.click();
          await waitUntil({ message: 'parent picker did not open', predicate: () => document.querySelector('.prompt-input') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          await chooseFolderInPicker(PICKED_PARENT);

          // The name is NOT re-asked — renaming from the dialog is a separate feature (#200).
          await waitUntil({ message: 'create dialog did not reopen', predicate: () => findButton('Create') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const wasNamePromptReopened = document.querySelector('.prompt-modal .text-box') !== null;

          findButton('Create')?.click();

          // A throwing wait would discard everything observed so far, so give up quietly and let the
          // Assertions outside Obsidian report what actually happened.
          try {
            await waitUntil({
              message: 'the folder was not created under the picked parent',
              predicate: () => app.vault.getFolderByPath(`${PICKED_PARENT}/4. Alpha`) !== null
            });
          } catch {
            // Diagnostics are returned below.
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const namedNote = app.vault.getFileByPath(`${PICKED_PARENT}/4. Alpha/Alpha.md`);

          return {
            changeTargetEnabled: isChangeTargetEnabled,
            // `{{folderName}}` carries the index, so this proves the TOKENS were rebuilt too, not just the path.
            namedNoteContent: namedNote ? await app.vault.read(namedNote) : null,
            // Nothing at all should have appeared under the parent that was abandoned.
            originalParentChildren: app.vault.getFolderByPath(ORIGINAL_PARENT)?.children.map((child) => child.path).sort() ?? [],
            pickedParentChildren: app.vault.getFolderByPath(PICKED_PARENT)?.children.map((child) => child.path).sort() ?? [],
            wasNamePromptReopened
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            Object.assign(settings, originalSettings);
          });
          app.vault.setConfig('newFileLocation', originalNewFileLocation);
          app.vault.setConfig('newFileFolderPath', originalNewFileFolderPath);
        }

        function findButton(text: string): HTMLButtonElement | null {
          // Two containers now: the confirm/cancel action row, and the `ModalCommandBuilder` strip that
          // Owns `Don't ask again` / `Change target` / `Switch to smart cut & paste`. A strip button's
          // `textContent` runs its purpose straight into its hotkey, so match the first span instead.
          for (const el of document.querySelectorAll('.modal-button-container button, .modal-commands button')) {
            if (el.instanceOf(HTMLButtonElement) && (el.textContent === text || el.querySelector('span')?.textContent === text)) {
              return el;
            }
          }
          return null;
        }

        async function chooseFolderInPicker(folderPath: string): Promise<void> {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No parent picker input.');
          }
          input.value = folderPath;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({ predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(folderPath)) });
          input.focus();
          await pressKey({ key: 'Enter' });
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
          return typeof node.editAndSave === 'function' && typeof node.settings?.newFolderNameTemplate === 'string';
        }

        async function submitName(name: string): Promise<void> {
          const nameInput = document.querySelector('.prompt-modal .text-box');
          if (!(nameInput instanceof HTMLInputElement)) {
            throw new TypeError('No folder name prompt input.');
          }
          nameInput.value = name;
          // The modal tracks its value through the component's change handler, so a bare `value` assignment
          // Would be accepted and then submitted as an empty name.
          nameInput.dispatchEvent(new Event('input', { bubbles: true }));
          // The prompt validates ASYNCHRONOUSLY and starts out invalid, so a click before it settles is
          // Silently ignored.
          await waitUntil({
            message: 'the typed folder name never became valid',
            predicate: () => nameInput.checkValidity()
          });
          const okButton = document.querySelector('.prompt-modal .ok-button');
          if (!(okButton instanceof HTMLElement)) {
            throw new TypeError('No folder name prompt OK button.');
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

    // The button issue #199 reported as doing nothing...
    expect(result.changeTargetEnabled).toBe(true);
    // ...and the name is not re-asked, since renaming from the dialog is issue #200's job.
    expect(result.wasNamePromptReopened).toBe(false);
    // Numbered `4.`, not `2.`: the index was recomputed against the parent that was actually picked.
    expect(result.pickedParentChildren).toEqual([
      'ctc-picked/1. One',
      'ctc-picked/2. Two',
      'ctc-picked/3. Three',
      'ctc-picked/4. Alpha'
    ]);
    // The abandoned parent is untouched — no half-created folder left behind.
    expect(result.originalParentChildren).toEqual(['ctc-original/1. Existing']);
    // The tokens were rebuilt too, not just the path.
    expect(result.namedNoteContent).toBe('# 4. Alpha\n');
  });
});
