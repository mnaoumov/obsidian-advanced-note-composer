import type { App } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

// Issue #214: the reporter who asked for the `Rename` buttons (issue #200) now wants them turn-off-able, so
// A vault whose note names come from `Create folder content template` cannot deviate from it by accident.
// Two independent flags, so this pins all four combinations against real Obsidian — and, with both off, that
// the dialog still PREVIEWS every note and still creates exactly what it previewed. No unit test can prove it:
// The buttons live in the dialog body, and the flags are read while that body is built.
// Desktop-only: folder flows, matching the plugin's established integration convention.
// Isolation: `npx vitest run --project integration-tests:desktop src/confirm-dialog-rename-buttons-hidden.desktop.integration.test.ts`.

const PLUGIN_ID = 'advanced-note-composer';
const PARENT = 'cfr-hidden-parent';

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

/**
 * What one pass through the confirmation dialog observed.
 */
interface DialogProbeResult {
  /**
   * The paths the dialog created - empty for a pass that cancelled instead of confirming.
   */
  readonly createdPaths: string[];

  /**
   * How many name rows the dialog previewed. Hiding the buttons must not change this.
   */
  readonly nameRowCount: number;

  /**
   * How many rename buttons the dialog rendered.
   */
  readonly renameButtonCount: number;
}

/**
 * The shared-instance state this suite overwrites, so the run can put it back.
 *
 * The settings half is the SEVEN scalar fields this suite writes, read one by one, rather than a spread of
 * the whole settings object. A spread would have to cross the transport to reach the restoring eval, and
 * `PluginSettings` carries a `Map` (`commandCategoryPathSettings`) that serializes to `{}` - assigning that
 * back leaves every later suite in the shared instance failing on `.get is not a function`, which is what
 * this suite's own restore did on the first run after the split.
 */
interface OriginalState {
  readonly newFileFolderPath: string;
  readonly newFileLocation: string;
  readonly settings: RestorableSettings;
}

/**
 * The settings fields this suite writes, and therefore the ones it puts back.
 */
interface RestorableSettings {
  readonly newFolderContentTemplate: string;
  readonly newFolderNameTemplate: string;
  readonly shouldAskBeforeCreatingFolder: boolean;
  readonly shouldOpenNoteAfterCreatingFolder: boolean;
  readonly shouldRunTemplaterOnDestinationFile: boolean;
  readonly shouldShowRenameButtonForCreatedFolder: boolean;
  readonly shouldShowRenameButtonForCreatedNotes: boolean;
}

interface SettingsCarrier {
  editAndSave: (editor: (settings: CreateFolderSettings) => void) => Promise<void>;
  settings: CreateFolderSettings;
}

describe('hiding the rename buttons in the create-folder confirmation (issue #214)', () => {
  it('drops each rename button independently and still creates what it previewed', async () => {
    // The four passes used to share ONE closure, which declared 84 800 ms of waiting against the transport's
    // ~30 s per-closure cap: opening the confirmation dialog costs three ceilings and it was opened four
    // times over, and a helper's ceilings are charged once per CALL SITE. The eval could only ever die as a
    // bare `script timeout` naming the harness rather than the wait that overran. Each pass opens its own
    // dialog and disposes of it, so the sequencing belongs in NODE, where no cap applies to it.
    const original = await configureSuite();
    try {
      // One dialog per combination, each cancelled — so `{{index}}` still sees no sibling and every pass
      // previews the same names.
      const bothShown = await probeConfirmDialog(true, true, false);
      const folderOnly = await probeConfirmDialog(true, false, false);
      const notesOnly = await probeConfirmDialog(false, true, false);
      // The last pass confirms, so the preview can be compared with what was created.
      const bothHidden = await probeConfirmDialog(false, false, true);

      // The issue-#200 layout, unchanged while both flags are on: one for the folder, one per note.
      expect(bothShown.renameButtonCount).toBe(3);
      // Issue #214's literal ask: the `Notes that will be created` buttons gone, the folder's kept.
      expect(folderOnly.renameButtonCount).toBe(1);
      expect(notesOnly.renameButtonCount).toBe(2);
      expect(bothHidden.renameButtonCount).toBe(0);
      // Every name is still previewed — only the buttons went away.
      expect(bothHidden.nameRowCount).toBe(3);
      // And what was previewed is what got created.
      expect(bothHidden.createdPaths).toEqual(['cfr-hidden-parent/1. Alpha/Alpha.md', 'cfr-hidden-parent/1. Alpha/tasks.md']);
    } finally {
      await restoreSuite(original);
    }
  });
});

/**
 * Puts the shared instance into the state this suite needs and reports what it was in before.
 * @returns The settings and vault config the run has to put back.
 */
async function configureSuite(): Promise<OriginalState> {
  return evalInObsidian({
    async callback({ app, findSettingsComponent, parent, pluginId }): Promise<OriginalState> {
      const settingsComponent = findSettingsComponent(app, pluginId);
      const original: OriginalState = {
        newFileFolderPath: app.vault.getConfig('newFileFolderPath') as string,
        newFileLocation: app.vault.getConfig('newFileLocation') as string,
        settings: {
          newFolderContentTemplate: settingsComponent.settings.newFolderContentTemplate,
          newFolderNameTemplate: settingsComponent.settings.newFolderNameTemplate,
          shouldAskBeforeCreatingFolder: settingsComponent.settings.shouldAskBeforeCreatingFolder,
          shouldOpenNoteAfterCreatingFolder: settingsComponent.settings.shouldOpenNoteAfterCreatingFolder,
          shouldRunTemplaterOnDestinationFile: settingsComponent.settings.shouldRunTemplaterOnDestinationFile,
          shouldShowRenameButtonForCreatedFolder: settingsComponent.settings.shouldShowRenameButtonForCreatedFolder,
          shouldShowRenameButtonForCreatedNotes: settingsComponent.settings.shouldShowRenameButtonForCreatedNotes
        }
      };

      await settingsComponent.editAndSave((settings) => {
        settings.newFolderNameTemplate = '{{index}}. {{safeFolderName}}';
        // Two notes, so "hidden per row" is distinguishable from "hidden altogether".
        settings.newFolderContentTemplate = '{{file}} {{safeFolderName}}.md\n# {{folderName}}\n{{file}} tasks.md\n- [ ] todo';
        settings.shouldAskBeforeCreatingFolder = true;
        settings.shouldOpenNoteAfterCreatingFolder = false;
        // Templater is not installed in the test vault; leaving this on would only add a warning notice.
        settings.shouldRunTemplaterOnDestinationFile = false;
      });

      const existing = app.vault.getAbstractFileByPath(parent);
      if (existing) {
        await app.fileManager.trashFile(existing);
      }
      await app.vault.createFolder(parent);

      app.vault.setConfig('newFileLocation', 'folder');
      app.vault.setConfig('newFileFolderPath', parent);
      return original;
    },
    input: { findSettingsComponent: findSettingsComponentInObsidian, parent: PARENT, pluginId: PLUGIN_ID }
  });
}

/**
 * Walks the plugin's component tree for the settings carrier. Declared out here so every eval below can take
 * it through `input` rather than re-declaring it inside each closure.
 * @param app - The Obsidian app.
 * @param pluginId - This plugin's id.
 * @returns The component that owns the settings.
 */
function findSettingsComponentInObsidian(app: App, pluginId: string): SettingsCarrier {
  const plugin = app.plugins.getPlugin(pluginId) as ComponentTreeNode | null;
  const queue: ComponentTreeNode[] = plugin ? [plugin] : [];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) {
      continue;
    }
    if (typeof node.editAndSave === 'function' && typeof node.settings?.newFolderNameTemplate === 'string') {
      return node as SettingsCarrier;
    }
    if (node._children) {
      queue.push(...node._children);
    }
  }
  throw new Error('Settings component was not found.');
}

/**
 * Opens the create-folder confirmation with one combination of the two rename flags, reads what it rendered,
 * and either cancels it or confirms it.
 * @param isFolderButtonShown - Whether the created FOLDER offers a rename button.
 * @param isNoteButtonShown - Whether each created NOTE offers one.
 * @param isConfirmed - Confirm the dialog instead of cancelling, so what it creates can be read back.
 * @returns The button and row counts, plus the created paths when the dialog was confirmed.
 */
async function probeConfirmDialog(isFolderButtonShown: boolean, isNoteButtonShown: boolean, isConfirmed: boolean): Promise<DialogProbeResult> {
  return evalInObsidian({
    async callback({
      app,
      findSettingsComponent,
      lib: { waitUntil },
      parent,
      pluginId,
      shouldConfirm,
      shouldShowForFolder,
      shouldShowForNotes
    }): Promise<DialogProbeResult> {
      /**
       * Sized so the SUM of every wait this closure declares stays under the transport's ~30 s per-closure
       * cap, not at it. Four ceilings share it - the name prompt opening, the typed name validating, the
       * confirmation dialog opening, and then the dialog closing or the folder appearing - and each is a
       * modal or a vault write a frame or two after the click that causes it.
       */
      const WAIT_TIMEOUT_IN_MILLISECONDS = 3000;
      const RENDER_DELAY_IN_MILLISECONDS = 400;
      const RENAME_BUTTON_SELECTOR = '.advanced-note-composer-confirm-rename-button';
      const NAME_ROW_SELECTOR = '.advanced-note-composer-confirm-name-row';

      await findSettingsComponent(app, pluginId).editAndSave((settings) => {
        settings.shouldShowRenameButtonForCreatedFolder = shouldShowForFolder;
        settings.shouldShowRenameButtonForCreatedNotes = shouldShowForNotes;
      });
      await openConfirmDialog();

      const renameButtonCount = document.querySelectorAll(RENAME_BUTTON_SELECTOR).length;
      // The PREVIEW is the reason the dialog exists, so hiding the buttons must not touch it: one row for
      // the folder and one per note.
      const nameRowCount = document.querySelectorAll(NAME_ROW_SELECTOR).length;

      if (!shouldConfirm) {
        findButton('Cancel')?.click();
        await waitUntil({
          message: 'the create dialog did not close',
          predicate: () => findButton('Create') === null,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);
        return { createdPaths: [], nameRowCount, renameButtonCount };
      }

      findButton('Create')?.click();
      // A throwing wait would discard everything observed so far, so give up quietly and let the
      // assertions outside Obsidian report what actually happened.
      try {
        await waitUntil({
          message: 'the folder was not created with the rename buttons hidden',
          predicate: () => app.vault.getFolderByPath(`${parent}/1. Alpha`) !== null,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
      } catch {
        // Diagnostics are returned below.
      }
      await sleep(RENDER_DELAY_IN_MILLISECONDS);

      return {
        createdPaths: app.vault.getFolderByPath(`${parent}/1. Alpha`)?.children.map((child) => child.path).sort() ?? [],
        nameRowCount,
        renameButtonCount
      };

      function findButton(text: string): HTMLButtonElement | null {
        for (const el of document.querySelectorAll('.modal-button-container button')) {
          if (el.instanceOf(HTMLButtonElement) && el.textContent === text) {
            return el;
          }
        }
        return null;
      }

      function getPromptInput(): HTMLInputElement {
        const inputEl = document.querySelector('.prompt-modal .text-box');
        if (!(inputEl instanceof HTMLInputElement)) {
          throw new TypeError('No prompt input.');
        }
        return inputEl;
      }

      async function openConfirmDialog(): Promise<void> {
        app.commands.executeCommandById(`${pluginId}:create-folder-with-notes`);

        await waitUntil({
          message: 'folder name prompt did not open',
          predicate: () => document.querySelector('.prompt-modal .text-box') !== null,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);
        await submitName('Alpha');

        await waitUntil({ message: 'create dialog did not open', predicate: () => findButton('Create') !== null, timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);
      }

      async function submitName(name: string): Promise<void> {
        const nameInput = getPromptInput();
        nameInput.value = name;
        // The modal tracks its value through the component's change handler, so a bare `value` assignment
        // would be accepted and then submitted as the seeded name.
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        // The prompt validates ASYNCHRONOUSLY, so a click before it settles is silently ignored.
        await waitUntil({
          message: 'the typed name never became valid',
          predicate: () => nameInput.checkValidity(),
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        const okButton = document.querySelector('.prompt-modal .ok-button');
        if (!(okButton instanceof HTMLElement)) {
          throw new TypeError('No prompt OK button.');
        }
        okButton.click();
      }
    },
    input: {
      findSettingsComponent: findSettingsComponentInObsidian,
      parent: PARENT,
      pluginId: PLUGIN_ID,
      shouldConfirm: isConfirmed,
      shouldShowForFolder: isFolderButtonShown,
      shouldShowForNotes: isNoteButtonShown
    }
  });
}

/**
 * Puts the shared instance back the way `configureSuite` found it.
 * @param originalState - What that call reported.
 */
async function restoreSuite(originalState: OriginalState): Promise<void> {
  await evalInObsidian({
    async callback({ app, findSettingsComponent, original, pluginId }): Promise<void> {
      await findSettingsComponent(app, pluginId).editAndSave((settings) => {
        // Field by field, so nothing this suite never wrote is overwritten with a transport round trip of
        // itself - see `OriginalState` for the `Map` that costs.
        settings.newFolderContentTemplate = original.settings.newFolderContentTemplate;
        settings.newFolderNameTemplate = original.settings.newFolderNameTemplate;
        settings.shouldAskBeforeCreatingFolder = original.settings.shouldAskBeforeCreatingFolder;
        settings.shouldOpenNoteAfterCreatingFolder = original.settings.shouldOpenNoteAfterCreatingFolder;
        settings.shouldRunTemplaterOnDestinationFile = original.settings.shouldRunTemplaterOnDestinationFile;
        settings.shouldShowRenameButtonForCreatedFolder = original.settings.shouldShowRenameButtonForCreatedFolder;
        settings.shouldShowRenameButtonForCreatedNotes = original.settings.shouldShowRenameButtonForCreatedNotes;
      });
      app.vault.setConfig('newFileLocation', original.newFileLocation);
      app.vault.setConfig('newFileFolderPath', original.newFileFolderPath);
    },
    input: { findSettingsComponent: findSettingsComponentInObsidian, original: originalState, pluginId: PLUGIN_ID }
  });
}
