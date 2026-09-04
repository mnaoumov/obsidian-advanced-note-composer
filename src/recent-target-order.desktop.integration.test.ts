import type {
  TFile,
  TFolder
} from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only: this drives a real folder move and the real folder-picker suggester DOM, matching the
// Plugin's established integration convention (no Android emulator is wired for it). It is the only proof
// That issue #206 works end to end — the unit tests pin the ordering function, not the recording.
// File-move suites can hit the documented headless rename wall (`renameFile`/`metadataCache.onCleanCache`)
// When several run in one aggregate; if this stalls in the aggregate it must still pass alone.
// Isolation: `npx vitest run --project integration-tests:desktop src/recent-target-order.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: OrderingSettings;
}

interface MenuItemLike {
  callback?(): void;
  dom?: HTMLElement;

  /**
   * The menu section, which every command handler sets to the plugin's name. Obsidian core contributes a
   * folder-menu item of its own, so the title alone does not identify ours.
   */
  section?: string;
}

interface MenuLike {
  hide(): void;
  items: MenuItemLike[];
}

interface OrderingSettings {
  shouldAddCommandsToSubmenu: boolean;
  shouldAskBeforeMovingFolder: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: OrderingSettings) => void): Promise<void>;
  settings: OrderingSettings;
}

describe('recent target ordering (issues #206, #256)', () => {
  it('ranks a completed target and the note you opened after it by WHICH CAME LAST', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const MERGE_ITEM_TITLE = 'Merge entire folder with...';
        const pluginName = app.plugins.manifests[pluginId]?.name ?? '';

        const settingsComponent = findSettingsComponent();
        const originalSettings = {
          shouldAddCommandsToSubmenu: settingsComponent.settings.shouldAddCommandsToSubmenu,
          shouldAskBeforeMovingFolder: settingsComponent.settings.shouldAskBeforeMovingFolder
        };
        try {
          await settingsComponent.editAndSave((settings) => {
            // Flat menu items (no submenu) so the folder commands are directly in `menu.items`, and no
            // Confirmation dialog between the picker and the move.
            settings.shouldAddCommandsToSubmenu = false;
            settings.shouldAskBeforeMovingFolder = false;
          });

          for (const name of ['rt-dst', 'rt-src', 'rt-here', 'rt-other']) {
            await trashIfExists(name);
          }

          // `rt-src` is moved into `rt-dst` — which nobody ever opens a note in, so Obsidian's own recency
          // Knows nothing about it. `rt-here` holds the note we end up ON, which is what issue #158 puts
          // First and what a recorded target has to outrank. `rt-other` is only ever the folder the picker
          // Is opened on, so it is the operation's source and never an offered target itself.
          await app.vault.createFolder('rt-src');
          const noteInSrc = await app.vault.create('rt-src/note-in-src.md', 'src body');
          await app.vault.createFolder('rt-dst');
          await app.vault.createFolder('rt-here');
          const noteHere = await app.vault.create('rt-here/note-here.md', 'here body');
          await app.vault.createFolder('rt-other');
          await app.vault.create('rt-other/note-other.md', 'other body');

          await openFile(noteHere);

          // Before the move: `rt-dst` was never opened, so nothing puts it at the top of the picker.
          const suggestionsBeforeMove = await pickerSuggestions();

          // Move `rt-src` into `rt-dst` through the real picker.
          await openFile(noteInSrc);
          app.commands.executeCommandById(`${pluginId}:move-folder`);
          await waitUntil({
            message: 'move-folder picker did not open',
            predicate: () => document.querySelector('.prompt') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No move-folder picker input.');
          }
          input.value = 'rt-dst';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: 'target folder suggestion did not appear',
            predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent === 'rt-dst')
          });
          input.focus();
          await pressKey({ key: 'Enter' });

          await waitUntil({
            message: 'folder was not moved into the destination',
            predicate: () => app.vault.getAbstractFileByPath('rt-dst/rt-src/note-in-src.md') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          /*
           * Wait for the operation to REPORT itself before navigating. The moved file becomes visible when
           * the transaction commits, but the handler records its target only once the whole flow has
           * unwound past that — so opening the next note on the strength of the file alone races the
           * recording, and the log would come out in the opposite order to the one the user caused.
           */
          await waitUntil({
            message: 'the move never reported completion',
            predicate: () => [...activeDocument.querySelectorAll('.notice')].some((el) => el.textContent.includes('Moved folder'))
          });

          // Go back to a note in a THIRD folder, so the folder we are ON is not the one we targeted — the
          // Case the reporter is in, and the only one where #206 and #158 disagree.
          await openFile(noteHere);
          // The view is live before Obsidian has finished dispatching `file-open`, and that event is what
          // Records the visit — reading the picker on the strength of the view alone races the recording.
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const suggestionsAfterMove = await pickerSuggestions();

          return { suggestionsAfterMove, suggestionsBeforeMove };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAddCommandsToSubmenu = originalSettings.shouldAddCommandsToSubmenu;
            settings.shouldAskBeforeMovingFolder = originalSettings.shouldAskBeforeMovingFolder;
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

        function getFolder(path: string): TFolder {
          const folder = app.vault.getFolderByPath(path);
          if (!folder) {
            throw new Error(`${path} was not found.`);
          }
          return folder;
        }

        function isSettingsComponent(node: ComponentTreeNode): node is SettingsCarrier {
          return typeof node.editAndSave === 'function' && typeof node.settings?.shouldAskBeforeMovingFolder === 'boolean';
        }

        async function openFile(file: TFile): Promise<void> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
          });
        }

        /**
         * Opens the folder picker from `rt-other`'s folder menu and reads its suggestions without merging
         * anything. Triggering on a folder OTHER than the active note's is what keeps the active note's own
         * folder in the list — a picker never offers the folder the operation runs on.
         *
         * @returns The suggestion labels, in the order the picker shows them.
         */
        async function pickerSuggestions(): Promise<string[]> {
          const menu = new obsidianModule.Menu();
          app.workspace.trigger('file-menu', menu, getFolder('rt-other'), 'file-explorer-context-menu');
          const menuItem = (menu as MenuLike).items.find((item) => item.section === pluginName && (item.dom?.textContent ?? '').includes(MERGE_ITEM_TITLE));
          (menu as MenuLike).hide();
          if (!menuItem) {
            throw new Error(`"${MERGE_ITEM_TITLE}" was not in the plugin's section of the folder menu.`);
          }

          menuItem.callback?.();
          await waitUntil({
            message: 'the folder picker did not open',
            predicate: () => document.querySelector('.suggestion-item') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const suggestions = [...document.querySelectorAll('.suggestion-item')].map((el) => el.textContent);

          const input = document.querySelector('.prompt-input');
          if (input instanceof HTMLInputElement) {
            input.focus();
            await pressKey({ key: 'Escape' });
          }
          await waitUntil({
            message: 'the folder picker did not close',
            predicate: () => document.querySelector('.prompt') === null
          });
          return suggestions;
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

    // The premise: a folder nobody has opened a note in does not lead the picker on its own. Stated as
    // "not first" rather than as a fixed index — an earlier suite in the aggregate run may have recorded
    // Targets of its own, and the rest of the list is whatever the vault has been through.
    expect(result.suggestionsBeforeMove[0]).not.toBe('rt-dst');

    /*
     * #206 asked that a completed target count as "clicked on"; #256 asked that the head of the list be
     * whichever happened LAST. Both hold here, and this is the exact sequence #256 reports: an operation
     * landed in `rt-dst`, and a note in `rt-here` was opened AFTER it — so `rt-here` leads and `rt-dst`
     * is right behind it, ahead of everything Obsidian's own history has to offer.
     *
     * Before #256 the target led however much navigating had happened since, which is the defect. Both
     * indexes are deterministic whatever else ran in the aggregate: these are the two most recent events
     * in the plugin's own log, and anything an earlier suite recorded is older than both.
     */
    expect(result.suggestionsAfterMove[0]).toBe('rt-here');
    expect(result.suggestionsAfterMove[1]).toBe('rt-dst');
  });
});
