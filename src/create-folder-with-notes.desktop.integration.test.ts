import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only: the flow is driven through two real modals (the folder picker and the name prompt), so it
// Follows the plugin's established integration convention.
// Isolation: `npx vitest run --project integration-tests:desktop src/create-folder-with-notes.desktop.integration.test.ts`.
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
  shouldTitleCaseCreatedFolderName: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: CreateFolderSettings) => void): Promise<void>;
  settings: CreateFolderSettings;
}

describe('create folder with notes... (issue #191)', () => {
  it('normalizes the typed name, numbers it after its siblings, and fills the folder from the template', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const PARENT_PATH = 'create-parent';
        // Exercises every normalization rule at once: the surrounding and repeated whitespace collapse, `api`
        // Is capitalized, the all-caps `TEST` survives as an acronym, and `*` is replaced.
        const TYPED_NAME = '  api   TEST  x*y ';
        // The two spellings the whole design turns on: the folder carries the index, the note named after it
        // Does not.
        const EXPECTED_SAFE_NAME = 'Api TEST X_y';
        const EXPECTED_FOLDER_NAME = `2. ${EXPECTED_SAFE_NAME}`;
        const EXPECTED_FOLDER_PATH = `${PARENT_PATH}/${EXPECTED_FOLDER_NAME}`;

        const settingsComponent = findSettingsComponent();
        const originalSettings = { ...settingsComponent.settings };
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.newFolderNameTemplate = '{{index}}. {{safeFolderName}}';
            settings.newFolderContentTemplate = [
              '{{file}} !.md',
              '---',
              'title: "{{folderName}}"',
              'aliases:',
              '  - {{safeFolderName}}',
              '---',
              '',
              '- [ ] refine',
              '{{file}} {{safeFolderName}}.md',
              '# {{folderName}}'
            ].join('\n');
            settings.shouldAskBeforeCreatingFolder = false;
            settings.shouldOpenNoteAfterCreatingFolder = true;
            settings.shouldTitleCaseCreatedFolderName = true;
            // Templater is not installed in the test vault; leaving this on would only add a warning notice.
            settings.shouldRunTemplaterOnDestinationFile = false;
          });

          await trashIfExists(PARENT_PATH);
          await app.vault.createFolder(PARENT_PATH);
          // The sibling the numbering has to continue from — `1.` means the new folder must become `2.`.
          await app.vault.createFolder(`${PARENT_PATH}/1. Existing`);

          app.commands.executeCommandById(`${pluginId}:create-folder-with-notes`);

          // First modal: the parent-folder picker (the palette has no folder in hand).
          await waitUntil({
            message: 'parent folder picker did not open',
            predicate: () => document.querySelector('.prompt') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const pickerInput = document.querySelector('.prompt-input');
          if (!(pickerInput instanceof HTMLInputElement)) {
            throw new TypeError('No parent folder picker input.');
          }
          pickerInput.value = PARENT_PATH;
          pickerInput.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: 'parent folder suggestion did not appear',
            predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent === PARENT_PATH)
          });
          pickerInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Enter', key: 'Enter' }));

          // Second modal: the name prompt.
          await waitUntil({
            message: 'folder name prompt did not open',
            predicate: () => document.querySelector('.prompt-modal .text-box') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const nameInput = document.querySelector('.prompt-modal .text-box');
          if (!(nameInput instanceof HTMLInputElement)) {
            throw new TypeError('No folder name prompt input.');
          }
          nameInput.value = TYPED_NAME;
          // The modal tracks its value through the component's change handler, so a bare `value` assignment
          // Would be accepted and then submitted as an empty name.
          nameInput.dispatchEvent(new Event('input', { bubbles: true }));

          // The prompt validates ASYNCHRONOUSLY and refuses to submit while the input is invalid. It opens
          // Empty, so it starts out invalid — clicking before the validation settles is silently ignored.
          await waitUntil({
            message: 'the typed folder name never became valid',
            predicate: () => nameInput.checkValidity()
          });

          const okButton = document.querySelector('.prompt-modal .ok-button');
          if (!(okButton instanceof HTMLElement)) {
            throw new TypeError('No folder name prompt OK button.');
          }
          okButton.click();

          // A throwing wait would discard everything observed so far, so give up quietly and let the
          // Assertions outside Obsidian report what actually happened.
          try {
            await waitUntil({
              message: 'the folder and its notes were not created',
              predicate: () => app.vault.getAbstractFileByPath(`${EXPECTED_FOLDER_PATH}/${EXPECTED_SAFE_NAME}.md`) !== null
            });
          } catch {
            // Diagnostics are returned below.
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const folderNoteFile = app.vault.getFileByPath(`${EXPECTED_FOLDER_PATH}/!.md`);
          const namedNoteFile = app.vault.getFileByPath(`${EXPECTED_FOLDER_PATH}/${EXPECTED_SAFE_NAME}.md`);

          return {
            activeFilePath: app.workspace.getActiveFile()?.path ?? null,
            // The parent's whole content: proves the numbering continued rather than colliding, and that
            // Nothing else was created along the way.
            actualChildren: app.vault.getFolderByPath(PARENT_PATH)?.children.map((child) => child.path).sort() ?? [],
            folderExists: app.vault.getFolderByPath(EXPECTED_FOLDER_PATH) !== null,
            folderNoteContent: folderNoteFile ? await app.vault.read(folderNoteFile) : null,
            namedNoteContent: namedNoteFile ? await app.vault.read(namedNoteFile) : null,
            // The `1.` sibling is untouched, so the new folder continued the sequence rather than colliding.
            siblingUntouched: app.vault.getFolderByPath(`${PARENT_PATH}/1. Existing`) !== null
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            Object.assign(settings, originalSettings);
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
          return typeof node.editAndSave === 'function' && typeof node.settings?.newFolderNameTemplate === 'string';
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

    // Asserted first, because it is the assertion that says what happened when the rest fail: the typed
    // `api TEST x*y` became `2. Api TEST X_y` — capitalized, acronym intact, `*` replaced, numbered after
    // The `1.` sibling — and nothing else appeared beside it.
    expect(result.actualChildren).toEqual(['create-parent/1. Existing', 'create-parent/2. Api TEST X_y']);
    expect(result.folderExists).toBe(true);
    expect(result.siblingUntouched).toBe(true);
    // `{{folderName}}` carries the index, `{{safeFolderName}}` does not — the distinction the
    // Reporter's own output depends on.
    expect(result.folderNoteContent).toBe('---\ntitle: "2. Api TEST X_y"\naliases:\n  - Api TEST X_y\n---\n\n- [ ] refine\n');
    expect(result.namedNoteContent).toBe('# 2. Api TEST X_y\n');
    // The FIRST note declared is the one that opens.
    expect(result.activeFilePath).toBe('create-parent/2. Api TEST X_y/!.md');
  });
});
