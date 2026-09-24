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

// Issue #201: the minimize button existed only on some confirmation menus. It is now a property of the
// opener (`openConfirmDialogModal`), not of each flow, so this file pins both ends of the rule against a
// real Obsidian: every menu that asks the user to approve an operation carries the button, and the initial
// pickers still do not (issue #125).
// Desktop-only, matching the plugin's established integration convention.
// Isolation: `npx vitest run --project integration-tests:desktop src/minimize-button.desktop.integration.test.ts`.

const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: MinimizeButtonSettings;
}

interface MinimizeButtonSettings {
  newFolderContentTemplate: string;
  newFolderNameTemplate: string;
  shouldAskBeforeCreatingFolder: boolean;
  shouldAskBeforeFlattening: boolean;
  shouldAskBeforeSplitting: boolean;
  shouldOpenNoteAfterCreatingFolder: boolean;
  shouldRunTemplaterOnDestinationFile: boolean;
}

interface MinimizeRoundTripResult {
  readonly barTitle: null | string;
  readonly hasRestoreButton: boolean;
  readonly isDialogHidden: boolean;
  readonly isDialogUsable: boolean;
}

interface ModalProbeResult {
  readonly createFolder: number;
  readonly errors: readonly string[];
  readonly flatten: number;
  readonly pasteOptions: number;
  readonly recursiveSplit: number;
  readonly reorderHeadings: number;
}

interface PickerState {
  hasPromptInput: boolean;
  minimizeButtonCount: number;
}

interface SettingsCarrier {
  editAndSave: (editor: (settings: MinimizeButtonSettings) => void) => Promise<void>;
  settings: MinimizeButtonSettings;
}

describe('minimize button', () => {
  it('should not render a minimize button on the initial merge picker', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 150;

        const sourceFile = await ensureMarkdownFile('anc-minimize-source.md', '# Source\n\ncontent');
        await ensureMarkdownFile('anc-minimize-other.md', '# Other\n\ncontent');
        await app.workspace.getLeaf(false).openFile(sourceFile);
        await waitUntil({ predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor !== undefined });

        app.commands.executeCommandById(`${pluginId}:merge-file`);
        await waitUntil({ predicate: () => document.querySelector('.prompt') !== null });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        const prompt = document.querySelector('.prompt');
        const pickerState: PickerState = {
          hasPromptInput: prompt?.querySelector('.prompt-input') !== null && prompt?.querySelector('.prompt-input') !== undefined,
          minimizeButtonCount: prompt ? prompt.querySelectorAll('.minimize-button').length : -1
        };

        // Cancel the merge via the plugin's own unlock command. Aborting the setup flow closes the
        // locked modal and releases the source-file lock, leaving no lingering modal or lock behind.
        app.commands.executeCommandById(`${pluginId}:unlock-active-note`);
        await waitUntil({ predicate: () => document.querySelector('.prompt') === null });

        return pickerState;

        async function ensureMarkdownFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            return existing;
          }
          return app.vault.create(path, content);
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The picker really opened (it is the real suggest modal with a search input)...
    expect(result.hasPromptInput).toBe(true);
    // ...and it carries no minimize button.
    expect(result.minimizeButtonCount).toBe(0);
  });

  it('should render a minimize button on every menu that confirms an operation', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }): Promise<ModalProbeResult> {
        /**
         * Sized so the SUM of every wait this closure declares stays under the transport's ~30 s per-closure
         * cap, not at it. Before this shared budget it declared 60 200 ms, so the eval could only ever die
         * as a bare transport timeout - which names the harness rather than the wait that overran. Every step
         * waited for here settles in well under a second on a healthy machine. A helper that waits is charged
         * once per CALL SITE, so adding a call to one adds a whole ceiling: re-divide this budget by the new
         * count, not by the `waitUntil` calls the body shows.
         */
        const WAIT_TIMEOUT_IN_MILLISECONDS = 2000;
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const SELECTION_END_CHARACTER = 6;
        const NOT_PROBED = -1;

        const errors: string[] = [];
        const settingsComponent = findSettingsComponent();
        const originalSettings = { ...settingsComponent.settings };

        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeCreatingFolder = true;
            settings.shouldAskBeforeFlattening = true;
            settings.shouldAskBeforeSplitting = true;
            settings.shouldOpenNoteAfterCreatingFolder = false;
            // Templater is not installed in the test vault; leaving this on would only add a warning notice.
            settings.shouldRunTemplaterOnDestinationFile = false;
          });

          await trashIfExists('mb-flat');
          await trashIfExists('mb-split.md');
          await trashIfExists('mb-reorder.md');
          await trashIfExists('mb-move-source.md');
          await trashIfExists('mb-move-target.md');

          const flattenChild = await resetFile('mb-flat/mb-child.md', 'child body');
          const splitFile = await resetFile('mb-split.md', '# Alpha\n\nalpha body\n\n# Beta\n\nbeta body\n');
          const reorderFile = await resetFile('mb-reorder.md', '# One\n\none body\n\n# Two\n\ntwo body\n\n# Three\n\nthree body\n');
          const moveSource = await resetFile('mb-move-source.md', 'movable text here\n');
          const moveTarget = await resetFile('mb-move-target.md', 'target body\n');

          const flatten = await probe('flatten confirmation', 'Flatten', async () => {
            // The command acts on the folder of the active note.
            await openInEditor(flattenChild);
            app.commands.executeCommandById(`${pluginId}:flatten-folder`);
          });

          const recursiveSplit = await probe('recursive split confirmation', 'Split', async () => {
            await openInEditor(splitFile);
            // A cache-gated command silently no-ops when the headings are not indexed yet.
            await waitUntil({
              message: 'the split note headings were never indexed',
              predicate: () => (app.metadataCache.getFileCache(splitFile)?.headings ?? []).length > 0,
              timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
            });
            app.commands.executeCommandById(`${pluginId}:split-note-by-headings-recursively`);
          });

          const createFolder = await probe('create folder confirmation', 'Create', async () => {
            app.commands.executeCommandById(`${pluginId}:create-folder-with-notes`);
            await waitUntil({
              message: 'folder name prompt did not open',
              predicate: () => document.querySelector('.prompt-modal .text-box') !== null,
              timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
            });
            await sleep(RENDER_DELAY_IN_MILLISECONDS);
            await submitName('mb-created');
          });

          const reorderHeadings = await probe('reorder headings modal', 'Reorder', async () => {
            await openInEditor(reorderFile);
            await waitUntil({
              message: 'the reorder note headings were never indexed',
              predicate: () => (app.metadataCache.getFileCache(reorderFile)?.headings ?? []).length > 0,
              timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
            });
            app.commands.executeCommandById(`${pluginId}:reorder-headings`);
          });

          const pasteOptions = await probe('paste options modal', 'Move', async () => {
            const sourceEditor = await openInEditor(moveSource);
            sourceEditor.setSelection({ ch: 0, line: 0 }, { ch: SELECTION_END_CHARACTER, line: 0 });
            app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
            await waitUntil({
              message: 'the selection was never marked',
              predicate: () => app.workspace.getActiveFile()?.path === 'mb-move-source.md',
              timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
            });
            await sleep(RENDER_DELAY_IN_MILLISECONDS);
            await openInEditor(moveTarget);
            app.commands.executeCommandById(`${pluginId}:move-marked-selection-here-advanced`);
          });
          // The paste-options modal is only the OPTIONS step — cancelling it leaves the mark (and the
          // source-note lock) in place, so the mark has to be dropped explicitly.
          app.commands.executeCommandById(`${pluginId}:cancel-move`);
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          return {
            createFolder,
            errors,
            flatten,
            pasteOptions,
            recursiveSplit,
            reorderHeadings
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            Object.assign(settings, originalSettings);
          });
          await trashIfExists('mb-flat');
          await trashIfExists('mb-split.md');
          await trashIfExists('mb-reorder.md');
          await trashIfExists('mb-move-source.md');
          await trashIfExists('mb-move-target.md');
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

        async function openInEditor(file: TFile): Promise<Editor> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `${file.path} never became the active editor`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          const editor = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor;
          if (!editor) {
            throw new Error(`No editor for ${file.path}.`);
          }
          return editor;
        }

        /**
         * Opens one modal, counts the minimize buttons on screen, and always cancels it again. A throwing
         * wait would discard everything the earlier probes observed, so a failure is recorded and reported
         * from outside Obsidian instead.
         */
        async function probe(modalName: string, confirmButtonText: string, trigger: () => Promise<void>): Promise<number> {
          try {
            await trigger();
            await waitUntil({
              message: `${modalName} did not open`,
              predicate: () => findButton(confirmButtonText) !== null,
              timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
            });
            await sleep(RENDER_DELAY_IN_MILLISECONDS);
            return document.querySelectorAll('.modal-container .minimize-button').length;
          } catch (error) {
            errors.push(`${modalName}: ${String(error)}`);
            return NOT_PROBED;
          } finally {
            findButton('Cancel')?.click();
            await sleep(RENDER_DELAY_IN_MILLISECONDS);
          }
        }

        async function resetFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          const parentPath = path.slice(0, path.lastIndexOf('/'));
          if (parentPath && app.vault.getAbstractFileByPath(parentPath) === null) {
            await app.vault.createFolder(parentPath);
          }
          return app.vault.create(path, content);
        }

        async function submitName(name: string): Promise<void> {
          const nameInput = document.querySelector('.prompt-modal .text-box');
          if (!(nameInput instanceof HTMLInputElement)) {
            throw new TypeError('No folder name prompt input.');
          }
          nameInput.value = name;
          // The modal tracks its value through the component's change handler, so a bare `value` assignment
          // would be accepted and then submitted as an empty name.
          nameInput.dispatchEvent(new Event('input', { bubbles: true }));
          // The prompt validates ASYNCHRONOUSLY and starts out invalid, so a click before it settles is
          // silently ignored.
          await waitUntil({
            message: 'the typed folder name never became valid',
            predicate: () => nameInput.checkValidity(),
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
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
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // Nothing was swallowed on the way — a modal that never opened would leave its reason here.
    expect(result.errors).toEqual([]);
    // The three that shipped without the button (issue #201)...
    expect(result.flatten).toBe(1);
    expect(result.recursiveSplit).toBe(1);
    expect(result.createFolder).toBe(1);
    // ...and the two option modals that ask for the same approval by another name.
    expect(result.reorderHeadings).toBe(1);
    expect(result.pasteOptions).toBe(1);
  });

  it('should park a confirmation on the floating bar and bring it back unchanged', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }): Promise<MinimizeRoundTripResult> {
        /*
         * Under the transport's ~30s per-closure cap, not at it.
         * Nothing in this closure declares a ceiling: every wait in it takes the harness's documented 5_000
         * default, so the 26_200 it adds up to is simply several of those plus a few short settles, and there
         * is no chosen number here to tighten.
         * What keeps that safe is the size of each wait rather than the size of the sum. The first wait to
         * genuinely fail reports its own message after five seconds, far short of the cap, so only a run in
         * which every wait in turn burned its whole default could reach the transport at all - and such a run
         * has already failed on the first one.
         */
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const settingsComponent = findSettingsComponent();
        const wasAskingBeforeFlattening = settingsComponent.settings.shouldAskBeforeFlattening;
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeFlattening = true;
          });

          await trashIfExists('mb-park');
          const child = await resetFile('mb-park/mb-park-child.md', 'child body');
          await app.workspace.getLeaf(false).openFile(child);
          await waitUntil({
            message: 'the flatten source never became active',
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === 'mb-park/mb-park-child.md'
          });

          app.commands.executeCommandById(`${pluginId}:flatten-folder`);
          await waitUntil({ message: 'flatten dialog did not open', predicate: () => findButton('Flatten') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const minimizeButton = document.querySelector('.modal-container .minimize-button');
          if (!(minimizeButton instanceof HTMLElement)) {
            throw new TypeError('No minimize button on the flatten confirmation.');
          }
          minimizeButton.click();
          await waitUntil({ message: 'the floating bar never appeared', predicate: () => document.querySelector('.minimized-modal-bar') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const barEl = document.querySelector('.minimized-modal-bar');
          // The bar reuses the modal's own title, and the source note is readable behind it — the whole
          // point of the feature (issue #201).
          const barTitle = barEl?.querySelector('.minimized-modal-bar-title')?.textContent ?? null;
          const hasRestoreButton = barEl?.querySelector('.restore-button') !== null && barEl?.querySelector('.restore-button') !== undefined;
          // The dialog this bar parked, not merely "a modal container" — the computed display is the
          // ground truth for it being out of the way, backdrop included.
          const dialogEl = minimizeButton.closest('.modal-container');
          const isDialogHidden = dialogEl instanceof HTMLElement && activeWindow.getComputedStyle(dialogEl).display === 'none';

          const restoreButton = barEl?.querySelector('.restore-button');
          if (!(restoreButton instanceof HTMLElement)) {
            throw new TypeError('No restore button on the floating bar.');
          }
          restoreButton.click();
          await waitUntil({ message: 'the floating bar never went away', predicate: () => document.querySelector('.minimized-modal-bar') === null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // The parked operation is still the same one, and still able to run.
          const isDialogUsable = !(findButton('Flatten')?.disabled ?? true);
          findButton('Flatten')?.click();
          await waitUntil({
            message: 'the restored dialog did not flatten',
            predicate: () => app.vault.getAbstractFileByPath('mb-park-child.md') !== null
          });

          return {
            barTitle,
            hasRestoreButton,
            isDialogHidden,
            isDialogUsable
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeFlattening = wasAskingBeforeFlattening;
          });
          await trashIfExists('mb-park');
          await trashIfExists('mb-park-child.md');
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

        async function resetFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          const parentPath = path.slice(0, path.lastIndexOf('/'));
          if (parentPath && app.vault.getAbstractFileByPath(parentPath) === null) {
            await app.vault.createFolder(parentPath);
          }
          return app.vault.create(path, content);
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

    // The bar is labelled with the dialog it parked...
    expect(result.barTitle).toBe('Flatten folder');
    expect(result.hasRestoreButton).toBe(true);
    // ...the dialog really got out of the way while parked...
    expect(result.isDialogHidden).toBe(true);
    // ...and it came back able to finish the operation (the `waitUntil` above is what proves it did).
    expect(result.isDialogUsable).toBe(true);
  });
});
