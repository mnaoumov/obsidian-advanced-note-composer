import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only: this multi-select merge is a file-delete flow driven through the real `files-menu`
// Context-menu item + the target picker. File-delete suites can hit the documented headless rename wall
// When several run in one aggregate; if this stalls in the aggregate, it is `it.skip`-ped and must still
// Pass alone.
// Isolation: `npx vitest run --project integration-tests:desktop src/merge-files.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: MergeSettings;
}

interface MenuItemLike {
  dom?: HTMLElement;
}

interface MenuLike {
  items: MenuItemLike[];
}

interface MergeSettings {
  shouldAddCommandsToSubmenu: boolean;
  shouldAskBeforeMerging: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: MergeSettings) => void): Promise<void>;
  settings: MergeSettings;
}

describe('merge multiple selected files into one file (issue #92)', () => {
  it('merges every file selected in the explorer into the picked target via the files menu', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const settingsComponent = findSettingsComponent();
        const isOriginalShouldAsk = settingsComponent.settings.shouldAskBeforeMerging;
        const isOriginalSubmenu = settingsComponent.settings.shouldAddCommandsToSubmenu;
        try {
          await settingsComponent.editAndSave((settings) => {
            // Skip the confirmation dialog and keep the item flat in `menu.items`.
            settings.shouldAskBeforeMerging = false;
            settings.shouldAddCommandsToSubmenu = false;
          });

          await trashIfExists('multi-merge-a.md');
          await trashIfExists('multi-merge-b.md');
          await trashIfExists('multi-merge-target.md');

          const alpha = await app.vault.create('multi-merge-a.md', 'alpha body');
          const bravo = await app.vault.create('multi-merge-b.md', 'bravo body');
          await app.vault.create('multi-merge-target.md', 'target body');

          // Trigger the real multi-selection (files) context menu with both source files selected.
          const menu = new obsidianModule.Menu();
          app.workspace.trigger('files-menu', menu, [alpha, bravo], 'file-explorer-context-menu');
          const mergeItem = findMergeItem(menu);
          if (!mergeItem?.dom) {
            throw new Error('Merge-files menu item was not found.');
          }
          mergeItem.dom.click();

          // The target picker opens: choose the target note.
          await waitUntil({
            message: 'merge-files target picker did not open',
            predicate: () => document.querySelector('.prompt-input') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          await chooseFileInPicker('multi-merge-target.md');
          menu.hide();

          // Both selected notes are concatenated into the target and deleted.
          await waitUntil({
            message: 'selected files were not merged into the target',
            predicate: () => app.vault.getAbstractFileByPath('multi-merge-a.md') === null && app.vault.getAbstractFileByPath('multi-merge-b.md') === null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const targetFile = app.vault.getAbstractFileByPath('multi-merge-target.md');
          const targetContent = targetFile && targetFile instanceof obsidianModule.TFile
            ? await app.vault.read(targetFile)
            : '';

          return {
            alphaGone: app.vault.getAbstractFileByPath('multi-merge-a.md') === null,
            bravoGone: app.vault.getAbstractFileByPath('multi-merge-b.md') === null,
            hasAlpha: targetContent.includes('alpha body'),
            hasBravo: targetContent.includes('bravo body'),
            hasTarget: targetContent.includes('target body')
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = isOriginalShouldAsk;
            settings.shouldAddCommandsToSubmenu = isOriginalSubmenu;
          });
        }

        function findMergeItem(menu: MenuLike): MenuItemLike | undefined {
          return menu.items.find((item) => (item.dom?.textContent ?? '').includes('Merge these files into one file'));
        }

        async function chooseFileInPicker(filePath: string): Promise<void> {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No merge-files picker input.');
          }
          input.value = filePath;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: 'target file suggestion did not appear',
            predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(filePath))
          });
          input.focus();
          pressKey({ key: 'Enter' });
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
          return typeof node.editAndSave === 'function'
            && typeof node.settings?.shouldAskBeforeMerging === 'boolean'
            && typeof node.settings.shouldAddCommandsToSubmenu === 'boolean';
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

    // Both selected notes were concatenated into the target, whose original body is preserved.
    expect(result.hasTarget).toBe(true);
    expect(result.hasAlpha).toBe(true);
    expect(result.hasBravo).toBe(true);
    // The selected source notes were deleted.
    expect(result.alphaGone).toBe(true);
    expect(result.bravoGone).toBe(true);
  });
});
