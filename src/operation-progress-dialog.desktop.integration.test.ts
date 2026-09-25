import type {
  App,
  TFile
} from 'obsidian';

import {
  ContextId,
  evalInObsidian,
  pollInObsidian
} from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only: it watches the rendered dialog and clicks its Cancel, which the Android transport does not
// cover.
// Isolation: `npx vitest run --project integration-tests:desktop src/operation-progress-dialog.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';
const SOURCE_NOTE_PATH = 'issue-289-a/shared/x.md';
const TARGET_NOTE_PATH = 'issue-289-b/shared/y.md';
/*
 * The two waits done from NODE. Neither is a closure's budget, so neither is bound by the transport's
 * ~30 s cap: a slow aggregate gets real headroom, and a genuine stall reports the phase that stalled.
 */
const DIALOG_SEEN_TIMEOUT_IN_MILLISECONDS = 15_000;
const DIALOG_GONE_TIMEOUT_IN_MILLISECONDS = 20_000;

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: ProgressDialogSettings;
}

interface ProgressDialogSettings {
  shouldAskBeforeSwapping: boolean;
  shouldBlockVaultDuringOperations: boolean;
  shouldShowOperationNotices: boolean;
}

interface SettingsCarrier {
  editAndSave: (editor: (settings: ProgressDialogSettings) => void) => Promise<void>;
  settings: ProgressDialogSettings;
}

/**
 * What the phases hand to each other, on `window` in the Obsidian process.
 */
interface SuiteContext {
  cancelButtonCount?: number;
  closeButtonCount?: number;
  isDialogSeen?: boolean;
  observer?: MutationObserver;
  originalSettings?: ProgressDialogSettings;

  /**
   * When setup started, as `performance.now()`, which every step is timed from.
   */
  startTime?: number;

  /**
   * Each step as it completes, with its time since setup, so a stall names the step it stopped after.
   */
  steps?: string[];
}

/*
 * Issue #289: the reporter asked for the blocking dialog's X and Cancel to go, because a cancelled
 * operation left half its notes edited. Two things were actually wrong. The X was a dead control: the
 * dialog removed `.modal-close-button`, which Obsidian renamed to `.modal-header-button` in 1.13.0. And
 * Cancel was honored only by operations whose body polled the signal - a folder swap does not, so it ran
 * on and COMMITTED. The swap is therefore the subject here: Cancel must now roll it back whole.
 *
 * The test runs in PHASES, each its own short eval, with the waiting done from Node. It used to be one
 * closure, and in one aggregate run in four it died as a bare `EvalCapExceededError` - which names the
 * transport, not the step that hung, and threw away everything the closure had observed.
 */
describe('operation progress dialog (issue #289)', () => {
  it('shows no X, and Cancel rolls a whole folder swap back', async () => {
    const contextId = new ContextId<SuiteContext>();
    const vaultPath = getTemporaryVault().path;

    try {
      await evalInObsidian({
        async callback({ app, context, findSettingsComponent, obsidianModule, pluginId, sourceNotePath, targetNotePath }) {
          const WAIT_TIMEOUT_IN_MILLISECONDS = 5000;
          const startTime = performance.now();
          context.startTime = startTime;
          const steps: string[] = [];
          context.steps = steps;
          function step(name: string): void {
            steps.push(`${name} +${String(Math.round(performance.now() - startTime))} ms`);
          }

          const settingsComponent = findSettingsComponent(app, pluginId);
          context.originalSettings = {
            shouldAskBeforeSwapping: settingsComponent.settings.shouldAskBeforeSwapping,
            shouldBlockVaultDuringOperations: settingsComponent.settings.shouldBlockVaultDuringOperations,
            shouldShowOperationNotices: settingsComponent.settings.shouldShowOperationNotices
          };
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeSwapping = false;
            settings.shouldBlockVaultDuringOperations = true;
            settings.shouldShowOperationNotices = true;
          });
          step('settings saved');

          const sourceNote = await resetFile(sourceNotePath, 'X body');
          await resetFile(targetNotePath, 'Y body');
          step('notes written');

          await app.workspace.getLeaf(false).openFile(sourceNote);
          await (async (): Promise<void> => {
            const deadline = performance.now() + WAIT_TIMEOUT_IN_MILLISECONDS;
            while (app.workspace.getActiveFile()?.path !== sourceNotePath) {
              if (performance.now() > deadline) {
                throw new Error('The source note did not become active.');
              }
              await sleep(50);
            }
          })();
          step('source note active');

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
        },
        contextId,
        input: { findSettingsComponent: findSettingsComponentInObsidian, pluginId: PLUGIN_ID, sourceNotePath: SOURCE_NOTE_PATH, targetNotePath: TARGET_NOTE_PATH },
        vaultPath
      });

      await evalInObsidian({
        async callback({ app, context, findProgressDialog, lib: { pressKey, waitUntil }, pluginId }) {
          // Three waits share this ceiling, well inside the transport's ~30 s cap.
          const WAIT_TIMEOUT_IN_MILLISECONDS = 5000;
          const steps = context.steps ?? [];
          const startTime = context.startTime ?? performance.now();
          function step(name: string): void {
            steps.push(`${name} +${String(Math.round(performance.now() - startTime))} ms`);
          }

          context.isDialogSeen = false;
          context.observer = new MutationObserver(() => {
            if (context.isDialogSeen) {
              return;
            }
            const dialog = findProgressDialog();
            if (!dialog) {
              return;
            }
            context.isDialogSeen = true;
            context.closeButtonCount = dialog.querySelectorAll(':scope > :is(.modal-close-button, .modal-header-button)').length;
            const cancelButtons = [...dialog.querySelectorAll('button')].filter((button) => button.textContent === 'Cancel');
            context.cancelButtonCount = cancelButtons.length;
            step('progress dialog seen, Cancel clicked');
            // Pressed the moment the dialog appears, while the swap's renames are still in flight.
            cancelButtons[0]?.click();
          });
          context.observer.observe(document.body, { childList: true, subtree: true });

          app.commands.executeCommandById(`${pluginId}:swap-folder`);
          await waitUntil({
            message: 'the swap folder picker did not open',
            predicate: () => document.querySelector('.prompt-input') !== null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          step('picker open');

          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No swap picker input.');
          }
          input.value = 'issue-289-b/shared';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: 'the swap target was not suggested',
            predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes('issue-289-b/shared')),
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          input.focus();
          await pressKey({ key: 'Enter' });
          step('target chosen');
        },
        contextId,
        input: { findProgressDialog: findProgressDialogInObsidian, pluginId: PLUGIN_ID },
        vaultPath
      });

      await pollInObsidian({
        contextId,
        input: { findProgressDialog: findProgressDialogInObsidian },
        poll: ({ context, findProgressDialog: findDialog }) => ({
          isDialogGone: findDialog() === null,
          isDialogSeen: context.isDialogSeen ?? false
        }),
        timeoutInMilliseconds: DIALOG_SEEN_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: 'the progress dialog never appeared',
        until: (status) => status.isDialogSeen,
        vaultPath
      }).catch(async (error: unknown) => {
        throw await describeStall(contextId, vaultPath, error);
      });

      await pollInObsidian({
        contextId,
        input: { findProgressDialog: findProgressDialogInObsidian },
        poll: ({ findProgressDialog: findDialog }) => findDialog() === null,
        timeoutInMilliseconds: DIALOG_GONE_TIMEOUT_IN_MILLISECONDS,
        timeoutMessage: 'the progress dialog did not close after Cancel',
        until: (isDialogGone) => isDialogGone,
        vaultPath
      }).catch(async (error: unknown) => {
        throw await describeStall(contextId, vaultPath, error);
      });

      const result = await evalInObsidian({
        callback({ app, context, sourceNotePath, targetNotePath }) {
          return {
            cancelButtonCount: context.cancelButtonCount ?? -1,
            closeButtonCount: context.closeButtonCount ?? -1,
            isSourceInPlace: app.vault.getAbstractFileByPath(sourceNotePath) !== null,
            isTargetInPlace: app.vault.getAbstractFileByPath(targetNotePath) !== null
          };
        },
        contextId,
        input: { sourceNotePath: SOURCE_NOTE_PATH, targetNotePath: TARGET_NOTE_PATH },
        vaultPath
      });

      expect(result.closeButtonCount).toBe(0);
      expect(result.cancelButtonCount).toBe(1);
      // Rolled back whole: each note is still in the folder it started in.
      expect(result.isSourceInPlace).toBe(true);
      expect(result.isTargetInPlace).toBe(true);
    } finally {
      await evalInObsidian({
        async callback({ app, context, findSettingsComponent, pluginId }) {
          context.observer?.disconnect();
          const { originalSettings } = context;
          if (!originalSettings) {
            return;
          }
          await findSettingsComponent(app, pluginId).editAndSave((settings) => {
            settings.shouldAskBeforeSwapping = originalSettings.shouldAskBeforeSwapping;
            settings.shouldBlockVaultDuringOperations = originalSettings.shouldBlockVaultDuringOperations;
            settings.shouldShowOperationNotices = originalSettings.shouldShowOperationNotices;
          });
        },
        contextId,
        input: { findSettingsComponent: findSettingsComponentInObsidian, pluginId: PLUGIN_ID },
        vaultPath
      });
      await contextId.dispose(vaultPath);
    }
  });
});

/**
 * Turns a phase timeout into an error that also says which steps completed and what the app looked like.
 *
 * @param contextId - The suite's context.
 * @param vaultPath - The vault.
 * @param error - What the poll rejected with.
 * @returns The error to throw.
 */
async function describeStall(contextId: ContextId<SuiteContext>, vaultPath: string, error: unknown): Promise<Error> {
  const state = await evalInObsidian({
    callback({ app, context, findProgressDialog: findDialog, sourceNotePath, targetNotePath }) {
      return {
        dialogText: findDialog()?.textContent ?? null,
        isSourceInPlace: app.vault.getAbstractFileByPath(sourceNotePath) !== null,
        isTargetInPlace: app.vault.getAbstractFileByPath(targetNotePath) !== null,
        lockIndicatorCount: document.querySelectorAll('.obsidian-dev-utils-lock-indicator').length,
        modalTitles: [...document.querySelectorAll('.modal')].map((modalEl) => modalEl.querySelector('.modal-title')?.textContent ?? '<untitled>'),
        steps: context.steps ?? []
      };
    },
    contextId,
    input: { findProgressDialog: findProgressDialogInObsidian, sourceNotePath: SOURCE_NOTE_PATH, targetNotePath: TARGET_NOTE_PATH },
    vaultPath
  });
  return new Error(`${String(error)} | state when the suite gave up: ${JSON.stringify(state)}`);
}

/**
 * Finds the plugin's blocking progress dialog. Runs inside Obsidian, passed through `input`.
 *
 * @returns The dialog's element, or `null` when none is open.
 */
function findProgressDialogInObsidian(): HTMLElement | null {
  for (const modalEl of document.querySelectorAll<HTMLElement>('.modal')) {
    if (modalEl.querySelector('.modal-title')?.textContent === 'Working...') {
      return modalEl;
    }
  }
  return null;
}

/**
 * Finds the plugin's settings component by walking its component tree. Runs inside Obsidian, passed through
 * `input`.
 *
 * @param app - The app.
 * @param pluginId - The plugin.
 * @returns The settings component.
 */
function findSettingsComponentInObsidian(app: App, pluginId: string): SettingsCarrier {
  const plugin = app.plugins.getPlugin(pluginId) as ComponentTreeNode | null;
  const queue: ComponentTreeNode[] = plugin ? [plugin] : [];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) {
      continue;
    }
    if (typeof node.editAndSave === 'function' && typeof node.settings?.shouldBlockVaultDuringOperations === 'boolean') {
      return node as SettingsCarrier;
    }
    if (node._children) {
      queue.push(...node._children);
    }
  }
  throw new Error('Settings component was not found.');
}
