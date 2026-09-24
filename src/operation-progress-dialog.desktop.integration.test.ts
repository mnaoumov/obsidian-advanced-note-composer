import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
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

/*
 * Issue #289: the reporter asked for the blocking dialog's X and Cancel to go, because a cancelled
 * operation left half its notes edited. Two things were actually wrong. The X was a dead control: the
 * dialog removed `.modal-close-button`, which Obsidian renamed to `.modal-header-button` in 1.13.0. And
 * Cancel was honored only by operations whose body polled the signal - a folder swap does not, so it ran
 * on and COMMITTED. The swap is therefore the subject here: Cancel must now roll it back whole.
 */
describe('operation progress dialog (issue #289)', () => {
  it('shows no X, and Cancel rolls a whole folder swap back', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        /**
         * Sized so the SUM of every wait this closure declares stays under the transport's ~30 s cap: six
         * waits at this ceiling plus the dialog's own drain wait below. Each step settles in well under a
         * second on a healthy machine.
         */
        const WAIT_TIMEOUT_IN_MILLISECONDS = 3000;
        const DIALOG_GONE_TIMEOUT_IN_MILLISECONDS = 8000;
        const SOURCE_NOTE_PATH = 'issue-289-a/shared/x.md';
        const TARGET_NOTE_PATH = 'issue-289-b/shared/y.md';

        const settingsComponent = findSettingsComponent();
        const originalSettings = {
          shouldAskBeforeSwapping: settingsComponent.settings.shouldAskBeforeSwapping,
          shouldBlockVaultDuringOperations: settingsComponent.settings.shouldBlockVaultDuringOperations,
          shouldShowOperationNotices: settingsComponent.settings.shouldShowOperationNotices
        };

        let closeButtonCount = -1;
        let cancelButtonCount = -1;
        let isDialogSeen = false;
        const observer = new MutationObserver(() => {
          if (isDialogSeen) {
            return;
          }
          const dialog = findProgressDialog();
          if (!dialog) {
            return;
          }
          isDialogSeen = true;
          closeButtonCount = dialog.querySelectorAll(':scope > :is(.modal-close-button, .modal-header-button)').length;
          const cancelButtons = [...dialog.querySelectorAll('button')].filter((button) => button.textContent === 'Cancel');
          cancelButtonCount = cancelButtons.length;
          // Pressed the moment the dialog appears, while the swap's renames are still in flight.
          cancelButtons[0]?.click();
        });

        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeSwapping = false;
            settings.shouldBlockVaultDuringOperations = true;
            settings.shouldShowOperationNotices = true;
          });

          const sourceNote = await resetFile(SOURCE_NOTE_PATH, 'X body');
          await resetFile(TARGET_NOTE_PATH, 'Y body');

          await app.workspace.getLeaf(false).openFile(sourceNote);
          await waitUntil({ predicate: () => app.workspace.getActiveFile()?.path === SOURCE_NOTE_PATH, timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS });

          observer.observe(document.body, { childList: true, subtree: true });
          app.commands.executeCommandById(`${pluginId}:swap-folder`);
          await waitUntil({ predicate: () => document.querySelector('.prompt-input') !== null, timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS });

          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No swap picker input.');
          }
          input.value = 'issue-289-b/shared';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes('issue-289-b/shared')),
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          input.focus();
          await pressKey({ key: 'Enter' });

          await waitUntil({ predicate: () => isDialogSeen, timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS });
          await waitUntil({ predicate: () => findProgressDialog() === null, timeoutInMilliseconds: DIALOG_GONE_TIMEOUT_IN_MILLISECONDS });

          return {
            cancelButtonCount,
            closeButtonCount,
            isSourceInPlace: app.vault.getAbstractFileByPath(SOURCE_NOTE_PATH) !== null,
            isTargetInPlace: app.vault.getAbstractFileByPath(TARGET_NOTE_PATH) !== null
          };
        } finally {
          observer.disconnect();
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeSwapping = originalSettings.shouldAskBeforeSwapping;
            settings.shouldBlockVaultDuringOperations = originalSettings.shouldBlockVaultDuringOperations;
            settings.shouldShowOperationNotices = originalSettings.shouldShowOperationNotices;
          });
        }

        function findProgressDialog(): HTMLElement | null {
          for (const modalEl of document.querySelectorAll<HTMLElement>('.modal')) {
            if (modalEl.querySelector('.modal-title')?.textContent === 'Working...') {
              return modalEl;
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
          return typeof node.editAndSave === 'function' && typeof node.settings?.shouldBlockVaultDuringOperations === 'boolean';
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
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    expect(result.closeButtonCount).toBe(0);
    expect(result.cancelButtonCount).toBe(1);
    // Rolled back whole: each note is still in the folder it started in.
    expect(result.isSourceInPlace).toBe(true);
    expect(result.isTargetInPlace).toBe(true);
  });
});
