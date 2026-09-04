import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Issue #202: a click on the dimmed background behind a confirmation menu cancelled the whole pending
// Operation. A stray click is not a deliberate cancel, so a minimizable modal now parks itself on the
// Floating bar instead. The fix itself lives upstream in `obsidian-dev-utils` (>= 92.0.0,
// `shouldMinimizeOnClickOutside`, default `true`), which is why nothing in `src/` changed — this file is
// What pins the behavior the plugin actually ships.
// All three sides of the rule are covered here, because the value is in the SPLIT: the background click
// Minimizes a wrapped dialog, `Escape` still cancels it, and a plain picker is still dismissed by the
// Same click (issue #125).
// Desktop-only, matching the plugin's established integration convention.
// Isolation: `npx vitest run --project integration-tests:desktop src/modal-background-click-minimizes.desktop.integration.test.ts`.

const PLUGIN_ID = 'advanced-note-composer';

interface BackgroundClickResult {
  readonly didFlatten: boolean;
  readonly errors: readonly string[];
  readonly isBarShown: boolean;
  readonly isDialogHidden: boolean;
  readonly isDialogStillOpen: boolean;
  readonly isDialogUsableAfterRestore: boolean;
}

interface BackgroundClickSettings {
  newFolderNameTemplate: string;
  shouldAskBeforeFlattening: boolean;
}

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: BackgroundClickSettings;
}

interface EscapeCancelResult {
  readonly didFlatten: boolean;
  readonly errors: readonly string[];
  readonly isBarShown: boolean;
  readonly isDialogGone: boolean;
}

interface PickerDismissResult {
  readonly errors: readonly string[];
  readonly isBarShown: boolean;
  readonly isPromptGone: boolean;
  readonly wasPromptOpen: boolean;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: BackgroundClickSettings) => void): Promise<void>;
  settings: BackgroundClickSettings;
}

describe('modal background click', () => {
  it('should park a confirmation on the floating bar instead of cancelling the operation', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { clickMouse, waitUntil }, obsidianModule, pluginId }): Promise<BackgroundClickResult> {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const errors: string[] = [];
        let didFlatten = false;
        let isBarShown = false;
        let isDialogHidden = false;
        let isDialogStillOpen = false;
        let isDialogUsableAfterRestore = false;

        const settingsComponent = findSettingsComponent();
        const wasAskingBeforeFlattening = settingsComponent.settings.shouldAskBeforeFlattening;

        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeFlattening = true;
          });

          await trashIfExists('mbg-park');
          await trashIfExists('mbg-park-child.md');
          const child = await resetFile('mbg-park/mbg-park-child.md', 'child body');
          await app.workspace.getLeaf(false).openFile(child);
          await waitUntil({
            message: 'the flatten source never became active',
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === 'mbg-park/mbg-park-child.md'
          });

          app.commands.executeCommandById(`${pluginId}:flatten-folder`);
          await waitUntil({ message: 'flatten dialog did not open', predicate: () => findButton('Flatten') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const containerEl = findButton('Flatten')?.closest('.modal-container');
          if (!(containerEl instanceof HTMLElement)) {
            throw new TypeError('No modal container around the flatten confirmation.');
          }
          const backgroundEl = containerEl.querySelector<HTMLElement>('.modal-bg');
          if (!backgroundEl) {
            throw new Error('No dimmed background on the flatten confirmation.');
          }

          // Obsidian registers its dismissal on this very element inside the `Modal` constructor, so this
          // Is the gesture the reporter performs. Without the wrapper's capture-phase guard it CLOSES the
          // Dialog, cancelling the flatten.
          const backgroundPoint = findOwnPoint(backgroundEl);
          await clickMouse({ x: backgroundPoint.x, y: backgroundPoint.y });
          await waitUntil({ message: 'the background click did not minimize the dialog', predicate: () => document.querySelector('.minimized-modal-bar') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          isBarShown = document.querySelector('.minimized-modal-bar') !== null;
          // Still open — the click parked the operation rather than throwing it away — and really out of
          // The way, backdrop included.
          isDialogStillOpen = containerEl.isConnected;
          isDialogHidden = activeWindow.getComputedStyle(containerEl).display === 'none';

          const restoreButton = document.querySelector('.minimized-modal-bar .restore-button');
          if (!(restoreButton instanceof HTMLElement)) {
            throw new TypeError('No restore button on the floating bar.');
          }
          restoreButton.click();
          await waitUntil({ message: 'the floating bar never went away', predicate: () => document.querySelector('.minimized-modal-bar') === null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          isDialogUsableAfterRestore = !(findButton('Flatten')?.disabled ?? true);
          findButton('Flatten')?.click();
          await waitUntil({
            message: 'the restored dialog did not flatten',
            predicate: () => app.vault.getAbstractFileByPath('mbg-park-child.md') !== null
          });
          didFlatten = true;
        } catch (error) {
          // A throwing wait would otherwise discard every observation made above, leaving the failure
          // Reported against the wrong step.
          errors.push(String(error));
        } finally {
          findButton('Cancel')?.click();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeFlattening = wasAskingBeforeFlattening;
          });
          await trashIfExists('mbg-park');
          await trashIfExists('mbg-park-child.md');
        }

        return {
          didFlatten,
          errors,
          isBarShown,
          isDialogHidden,
          isDialogStillOpen,
          isDialogUsableAfterRestore
        };

        /*
         * Finds a point inside the element that the element itself owns. The dimmed background stretches
         * behind the dialog, so its centre belongs to the dialog — and a trusted click hit-tests for
         * real, unlike a dispatched one, which the target receives regardless of what covers it.
         *
         * @param element - The element to find an unobstructed point of.
         * @returns The viewport coordinates of that point.
         */
        function findOwnPoint(element: HTMLElement): Point {
          const STEPS = 20;
          const rect = element.getBoundingClientRect();
          for (let stepIndex = 1; stepIndex < STEPS; stepIndex++) {
            const x = rect.left + rect.width * stepIndex / STEPS;
            const y = rect.top + rect.height / 2;
            if (document.elementFromPoint(x, y) === element) {
              return { x, y };
            }
          }
          throw new Error('every point of the dimmed background is covered');
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

    // Nothing was swallowed on the way — a step that never happened leaves its reason here.
    expect(result.errors).toEqual([]);
    // The click minimized the dialog...
    expect(result.isBarShown).toBe(true);
    expect(result.isDialogHidden).toBe(true);
    // ...without cancelling the operation it was guarding...
    expect(result.isDialogStillOpen).toBe(true);
    // ...and the parked operation came back able to finish.
    expect(result.isDialogUsableAfterRestore).toBe(true);
    expect(result.didFlatten).toBe(true);
  });

  it('should still cancel the operation when Escape is pressed', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId }): Promise<EscapeCancelResult> {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const errors: string[] = [];
        let didFlatten = false;
        let isBarShown = false;
        let isDialogGone = false;

        const settingsComponent = findSettingsComponent();
        const wasAskingBeforeFlattening = settingsComponent.settings.shouldAskBeforeFlattening;

        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeFlattening = true;
          });

          await trashIfExists('mbg-esc');
          await trashIfExists('mbg-esc-child.md');
          const child = await resetFile('mbg-esc/mbg-esc-child.md', 'child body');
          await app.workspace.getLeaf(false).openFile(child);
          await waitUntil({
            message: 'the flatten source never became active',
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === 'mbg-esc/mbg-esc-child.md'
          });

          app.commands.executeCommandById(`${pluginId}:flatten-folder`);
          await waitUntil({ message: 'flatten dialog did not open', predicate: () => findButton('Flatten') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // A keypress is deliberate in a way a background click is not, so this half of the behavior is
          // Untouched by issue #202 and must stay that way.
          await pressKey({ key: 'Escape' });
          await waitUntil({ message: 'Escape did not close the flatten dialog', predicate: () => findButton('Flatten') === null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          isDialogGone = findButton('Flatten') === null;
          // Cancelled, not parked: nothing was minimized on the way out.
          isBarShown = document.querySelector('.minimized-modal-bar') !== null;
          didFlatten = app.vault.getAbstractFileByPath('mbg-esc-child.md') !== null;
        } catch (error) {
          errors.push(String(error));
        } finally {
          findButton('Cancel')?.click();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeFlattening = wasAskingBeforeFlattening;
          });
          await trashIfExists('mbg-esc');
          await trashIfExists('mbg-esc-child.md');
        }

        return {
          didFlatten,
          errors,
          isBarShown,
          isDialogGone
        };

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

    expect(result.errors).toEqual([]);
    // Escape closed the dialog...
    expect(result.isDialogGone).toBe(true);
    // ...as a cancel, not as a minimize...
    expect(result.isBarShown).toBe(false);
    // ...so the operation it was guarding never ran.
    expect(result.didFlatten).toBe(false);
  });

  it('should still dismiss an initial picker when its background is clicked', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { clickMouse, waitUntil }, obsidianModule, pluginId }): Promise<PickerDismissResult> {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const errors: string[] = [];
        let isBarShown = false;
        let isPromptGone = false;
        let wasPromptOpen = false;

        try {
          const sourceFile = await ensureMarkdownFile('mbg-picker-source.md', '# Source\n\ncontent');
          await ensureMarkdownFile('mbg-picker-other.md', '# Other\n\ncontent');
          await app.workspace.getLeaf(false).openFile(sourceFile);
          await waitUntil({ predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor !== undefined });

          app.commands.executeCommandById(`${pluginId}:merge-file`);
          await waitUntil({ message: 'the merge picker did not open', predicate: () => document.querySelector('.prompt') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          wasPromptOpen = true;

          // The initial pickers are never wrapped (issue #125), so they keep Obsidian's native
          // Close-on-background-click. This is the boundary that makes the #202 split deliberate rather
          // Than an oversight.
          const containerEl = document.querySelector('.prompt')?.closest('.modal-container');
          const backgroundEl = containerEl?.querySelector<HTMLElement>('.modal-bg');
          if (!backgroundEl) {
            throw new Error('No dimmed background on the merge picker.');
          }
          const backgroundPoint = findOwnPoint(backgroundEl);
          await clickMouse({ x: backgroundPoint.x, y: backgroundPoint.y });
          await waitUntil({ message: 'the background click did not dismiss the merge picker', predicate: () => document.querySelector('.prompt') === null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          isPromptGone = document.querySelector('.prompt') === null;
          isBarShown = document.querySelector('.minimized-modal-bar') !== null;
        } catch (error) {
          errors.push(String(error));
        } finally {
          // Dismissing the picker aborts the setup flow and releases the source lock; the command is the
          // Belt-and-braces path for the case where the click did not dismiss it at all.
          app.commands.executeCommandById(`${pluginId}:unlock-active-note`);
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          await trashIfExists('mbg-picker-source.md');
          await trashIfExists('mbg-picker-other.md');
        }

        return {
          errors,
          isBarShown,
          isPromptGone,
          wasPromptOpen
        };

        /*
         * Finds a point inside the element that the element itself owns. The dimmed background stretches
         * behind the picker, so its centre belongs to the picker — and a trusted click hit-tests for
         * real, unlike a dispatched one, which the target receives regardless of what covers it.
         *
         * @param element - The element to find an unobstructed point of.
         * @returns The viewport coordinates of that point.
         */
        function findOwnPoint(element: HTMLElement): Point {
          const STEPS = 20;
          const rect = element.getBoundingClientRect();
          for (let stepIndex = 1; stepIndex < STEPS; stepIndex++) {
            const x = rect.left + rect.width * stepIndex / STEPS;
            const y = rect.top + rect.height / 2;
            if (document.elementFromPoint(x, y) === element) {
              return { x, y };
            }
          }
          throw new Error('every point of the dimmed background is covered');
        }

        async function ensureMarkdownFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
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

    expect(result.errors).toEqual([]);
    // The picker really opened...
    expect(result.wasPromptOpen).toBe(true);
    // ...and the same click that parks a confirmation still dismisses it outright.
    expect(result.isPromptGone).toBe(true);
    expect(result.isBarShown).toBe(false);
  });
});
