import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

// Issue #200: the `Create folder with notes...` confirmation had no way to change a name. It is the one place
// The difference between what was typed and what gets created is visible, so it is the one place a rename can
// Still matter. This pins both halves against real Obsidian: renaming the FOLDER rebuilds the whole plan (the
// Token-derived note names follow it), while a note renamed earlier keeps its typed name through that
// Rebuild — the half no unit test can prove, because the buttons live in the dialog body and the prompts are
// Real modals.
// Desktop-only: folder flows, matching the plugin's established integration convention.
// Isolation: `npx vitest run --project integration-tests:desktop src/confirm-dialog-rename-create-folder.desktop.integration.test.ts`.

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

describe('rename from the create-folder confirmation dialog (issue #200)', () => {
  it('renames the folder and a single note, keeping the note override across the rebuild', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const PARENT = 'cfr-parent';
        const RENAME_BUTTON_SELECTOR = '.advanced-note-composer-confirm-rename-button';

        const settingsComponent = findSettingsComponent();
        const originalSettings = { ...settingsComponent.settings };
        const originalNewFileLocation = app.vault.getConfig('newFileLocation');
        const originalNewFileFolderPath = app.vault.getConfig('newFileFolderPath');
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.newFolderNameTemplate = '{{index}}. {{safeFolderName}}';
            // Two notes: the first is named from the folder (so it must FOLLOW a folder rename), the second is
            // Named literally (so renaming it must SURVIVE one).
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

          app.commands.executeCommandById(`${pluginId}:create-folder-with-notes`);

          await waitUntil({
            message: 'folder name prompt did not open',
            predicate: () => document.querySelector('.prompt-modal .text-box') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          await submitName('Alpha');

          await waitUntil({ message: 'create dialog did not open', predicate: () => findButton('Create') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          // One beside the folder name and one beside each note, which is the layout the reporter asked for.
          const renameButtonCount = document.querySelectorAll(RENAME_BUTTON_SELECTOR).length;

          // The SECOND note first, so its typed name has to survive the folder rename that follows.
          clickRenameButton(2);
          await waitUntil({ message: 'note rename prompt did not open', predicate: () => document.querySelector('.prompt-modal .text-box') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const seededNoteName = readPromptValue();
          await submitName('Plan');

          await waitUntil({ message: 'create dialog did not reopen after the note rename', predicate: () => findButton('Create') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          clickRenameButton(0);
          await waitUntil({ message: 'folder rename prompt did not open', predicate: () => document.querySelector('.prompt-modal .text-box') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const seededFolderName = readPromptValue();
          await submitName('Beta');

          await waitUntil({ message: 'create dialog did not reopen after the folder rename', predicate: () => findButton('Create') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          findButton('Create')?.click();

          // A throwing wait would discard everything observed so far, so give up quietly and let the
          // Assertions outside Obsidian report what actually happened.
          try {
            await waitUntil({
              message: 'the renamed folder was not created',
              predicate: () => app.vault.getFolderByPath(`${PARENT}/1. Beta`) !== null
            });
          } catch {
            // Diagnostics are returned below.
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const followedNote = app.vault.getFileByPath(`${PARENT}/1. Beta/Beta.md`);

          return {
            createdPaths: app.vault.getFolderByPath(`${PARENT}/1. Beta`)?.children.map((child) => child.path).sort() ?? [],
            // `{{folderName}}` carries the index, so this proves the TOKENS were rebuilt, not just the path.
            followedNoteContent: followedNote ? await app.vault.read(followedNote) : null,
            parentChildren: app.vault.getFolderByPath(PARENT)?.children.map((child) => child.path).sort() ?? [],
            renameButtonCount,
            seededFolderName,
            seededNoteName
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            Object.assign(settings, originalSettings);
          });
          app.vault.setConfig('newFileLocation', originalNewFileLocation);
          app.vault.setConfig('newFileFolderPath', originalNewFileFolderPath);
        }

        function clickRenameButton(index: number): void {
          const buttonEl = document.querySelectorAll(RENAME_BUTTON_SELECTOR)[index];
          if (!(buttonEl instanceof HTMLElement)) {
            throw new TypeError(`No rename button at index ${String(index)}.`);
          }
          buttonEl.click();
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

        function isSettingsComponent(node: ComponentTreeNode): node is SettingsCarrier {
          return typeof node.editAndSave === 'function' && typeof node.settings?.newFolderNameTemplate === 'string';
        }

        function readPromptValue(): string {
          return getPromptInput().value;
        }

        function getPromptInput(): HTMLInputElement {
          const inputEl = document.querySelector('.prompt-modal .text-box');
          if (!(inputEl instanceof HTMLInputElement)) {
            throw new TypeError('No prompt input.');
          }
          return inputEl;
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

    // The buttons issue #200 reported as missing: one for the folder, one per note.
    expect(result.renameButtonCount).toBe(3);
    // Each prompt opens on the name it is about, so a small edit does not mean retyping it.
    expect(result.seededNoteName).toBe('tasks.md');
    expect(result.seededFolderName).toBe('Alpha');
    // `Beta.md` followed the folder rename; `Plan.md` survived it.
    expect(result.createdPaths).toEqual(['cfr-parent/1. Beta/Beta.md', 'cfr-parent/1. Beta/Plan.md']);
    // Nothing was left behind under the name that was abandoned.
    expect(result.parentChildren).toEqual(['cfr-parent/1. Beta']);
    // The tokens were rebuilt too, not just the folder path.
    expect(result.followedNoteContent).toBe('# 1. Beta\n');
  });
});
