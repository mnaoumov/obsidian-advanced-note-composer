import type { TFolder } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

/*
 * End-to-end coverage for issue #248 (G97): `pickerRecencyOrder` decides whether a folder picker leads
 * with the destination of a completed operation or with the folder the user is currently in.
 *
 * The report is not a bug. Issue #206 — the same reporter — asked that a folder used as a destination be
 * "always the top one on the list" for the operations that follow, so recorded targets were deliberately
 * put ahead of even the active file (see the comment in `recent-suggestions.ts`). #248 is the consequence
 * of that, noticed later. Both orderings are reasonable, so this asserts that the setting really swaps
 * them in the RENDERED picker, with the shipped default unchanged.
 *
 * A target is recorded by completing a real move rather than by poking the store, because the store is
 * module-level state inside the plugin's bundle and the point is that the pickers read what real
 * operations wrote.
 *
 * Claims are RELATIVE (`indexOf(x) < indexOf(y)`), never "x is suggestion #0": an earlier suite in the
 * aggregate run may have recorded targets of its own, which says nothing about the ordering under test.
 *
 * Desktop-only, matching `recent-folder-order.desktop.integration.test.ts`, whose picker-driving helpers
 * this mirrors.
 * Isolation: `npx vitest run --project integration-tests:desktop src/picker-recency-order.desktop.integration.test.ts`.
 */

const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: PickerRecencySettings;
}

interface MenuItemLike {
  callback?(): void;
  dom?: HTMLElement;
  section?: string;
}

interface MenuLike {
  hide(): void;
  items: MenuItemLike[];
}

interface PickerRecencySettings {
  pickerRecencyOrder: string;
  shouldAskBeforeMovingFolder: boolean;
}

interface ProbeResult {
  readonly activeFolderName: string;
  readonly defaultOrder: string;
  readonly settingsFound: boolean;
  readonly suggestionsWhenActiveFileFirst: readonly string[];
  readonly suggestionsWhenRecentTargetsFirst: readonly string[];
  readonly targetFolderName: string;
  readonly wasMoveRecorded: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: PickerRecencySettings) => void): Promise<void>;
  settings: PickerRecencySettings;
}

describe('picker recency order (issue #248)', () => {
  it('leads with the last operation target or with the folder you are in, as the setting says', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { clickElement, pressKey, waitUntil }, obsidianModule, pluginId }): Promise<ProbeResult> {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const MOVE_ITEM_TITLE = 'Move folder to...';
        const pluginName = app.plugins.manifests[pluginId]?.name ?? '';

        const EMPTY: ProbeResult = {
          activeFolderName: '',
          defaultOrder: '',
          settingsFound: false,
          suggestionsWhenActiveFileFirst: [],
          suggestionsWhenRecentTargetsFirst: [],
          targetFolderName: '',
          wasMoveRecorded: false
        };

        function findSettingsComponent(): null | SettingsCarrier {
          const pluginNode: unknown = app.plugins.getPlugin(pluginId);
          const queue: ComponentTreeNode[] = pluginNode ? [pluginNode] : [];
          while (queue.length > 0) {
            const node = queue.shift();
            if (!node) {
              continue;
            }
            if (typeof node.editAndSave === 'function' && node.settings && typeof node.settings.pickerRecencyOrder === 'string') {
              const carrier: unknown = node;
              return carrier as SettingsCarrier;
            }
            if (node._children) {
              queue.push(...node._children);
            }
          }
          return null;
        }

        const foundSettingsComponent = findSettingsComponent();
        if (!foundSettingsComponent) {
          return EMPTY;
        }
        // A narrowed `const` does not stay narrowed inside a function declaration below it.
        const settingsComponent = foundSettingsComponent;
        const originalOrder = settingsComponent.settings.pickerRecencyOrder;
        const wasAskingBeforeMovingFolder = settingsComponent.settings.shouldAskBeforeMovingFolder;

        const stamp = `${Date.now().toString()}-${Math.floor(performance.now()).toString()}`;
        const movedName = `pro-moved-${stamp}`;
        const targetName = `pro-target-${stamp}`;
        const activeName = `pro-active-${stamp}`;
        const sourceName = `pro-source-${stamp}`;

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }

        function getFolder(path: string): TFolder {
          const folder = app.vault.getFolderByPath(path);
          if (!folder) {
            throw new Error(`${path} was not found.`);
          }
          return folder;
        }

        function openMovePicker(folder: TFolder): void {
          const menu = new obsidianModule.Menu();
          app.workspace.trigger('file-menu', menu, folder, 'file-explorer-context-menu');
          const menuItem = (menu as MenuLike).items.find((item) => item.section === pluginName && (item.dom?.textContent ?? '').includes(MOVE_ITEM_TITLE));
          (menu as MenuLike).hide();
          if (!menuItem) {
            throw new Error(`"${MOVE_ITEM_TITLE}" was not in the plugin's section of the folder menu.`);
          }
          menuItem.callback?.();
        }

        async function waitForPicker(): Promise<void> {
          await waitUntil({
            message: 'the move picker did not open',
            predicate: () => document.querySelector('.suggestion-item') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        }

        async function closePicker(): Promise<void> {
          const input = document.querySelector('.prompt-input');
          if (input instanceof HTMLInputElement) {
            input.focus();
            await pressKey({ key: 'Escape' });
          }
          await waitUntil({
            message: 'the move picker did not close',
            predicate: () => document.querySelector('.prompt') === null
          });
        }

        /**
         * Reads the picker's rendered order for the current setting value, then closes it without
         * choosing anything.
         */
        async function readSuggestions(order: string): Promise<string[]> {
          await settingsComponent.editAndSave((settings) => {
            settings.pickerRecencyOrder = order;
          });
          openMovePicker(getFolder(sourceName));
          await waitForPicker();
          const suggestions = [...document.querySelectorAll('.suggestion-item')].map((el) => el.textContent);
          await closePicker();
          return suggestions;
        }

        try {
          for (const name of [movedName, targetName, activeName, sourceName]) {
            await trashIfExists(name);
            await app.vault.createFolder(name);
          }
          await app.vault.create(`${activeName}/note.md`, 'Body\n');

          // The confirmation dialog would block the move; this probe is about ordering, not confirming.
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMovingFolder = false;
          });

          // A REAL completed move is what records a target — the whole premise of issue #206.
          openMovePicker(getFolder(movedName));
          await waitForPicker();
          // Clicked rather than Enter-ed: the suggester's Enter handling is Obsidian-internal, while a
          // Click on the item is exactly what a user does and is what the modal listens for.
          const targetSuggestion = [...document.querySelectorAll<HTMLElement>('.suggestion-item')]
            .find((el) => el.textContent === targetName);
          if (!targetSuggestion) {
            throw new Error(`"${targetName}" was not offered by the move picker.`);
          }
          await clickElement({ element: targetSuggestion });

          await waitUntil({
            message: 'the move did not land',
            predicate: () => app.vault.getAbstractFileByPath(`${targetName}/${movedName}`) !== null,
            timeoutInMilliseconds: 20_000
          });
          const wasMoveRecorded = app.vault.getAbstractFileByPath(`${targetName}/${movedName}`) !== null;

          // Now stand in the OTHER folder, so the two recencies genuinely disagree.
          const activeNote = app.vault.getFileByPath(`${activeName}/note.md`);
          if (activeNote) {
            await app.workspace.getLeaf(false).openFile(activeNote);
            await waitUntil({
              message: 'the note did not become active',
              predicate: () => app.workspace.getActiveFile()?.path === `${activeName}/note.md`
            });
          }

          const suggestionsWhenRecentTargetsFirst = await readSuggestions('RecentTargetsFirst');
          const suggestionsWhenActiveFileFirst = await readSuggestions('ActiveFileFirst');

          return {
            activeFolderName: activeName,
            defaultOrder: originalOrder,
            settingsFound: true,
            suggestionsWhenActiveFileFirst,
            suggestionsWhenRecentTargetsFirst,
            targetFolderName: targetName,
            wasMoveRecorded
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.pickerRecencyOrder = originalOrder;
            settings.shouldAskBeforeMovingFolder = wasAskingBeforeMovingFolder;
          });
          await trashIfExists(`${activeName}/note.md`);
          await trashIfExists(`${targetName}/${movedName}`);
          for (const name of [movedName, targetName, activeName, sourceName]) {
            await trashIfExists(name);
          }
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    expect(result.settingsFound).toBe(true);
    // The premise: a real move landed, so a target really was recorded.
    expect(result.wasMoveRecorded).toBe(true);

    // The shipped default is unchanged, so nobody who has not asked sees a difference.
    expect(result.defaultOrder).toBe('RecentTargetsFirst');

    const targetIndexWhenTargetsFirst = result.suggestionsWhenRecentTargetsFirst.indexOf(result.targetFolderName);
    const activeIndexWhenTargetsFirst = result.suggestionsWhenRecentTargetsFirst.indexOf(result.activeFolderName);
    expect(targetIndexWhenTargetsFirst).toBeGreaterThan(-1);
    expect(activeIndexWhenTargetsFirst).toBeGreaterThan(-1);
    // Today's behavior, and issue #206's ask.
    expect(targetIndexWhenTargetsFirst).toBeLessThan(activeIndexWhenTargetsFirst);

    const targetIndexWhenActiveFirst = result.suggestionsWhenActiveFileFirst.indexOf(result.targetFolderName);
    const activeIndexWhenActiveFirst = result.suggestionsWhenActiveFileFirst.indexOf(result.activeFolderName);
    expect(targetIndexWhenActiveFirst).toBeGreaterThan(-1);
    expect(activeIndexWhenActiveFirst).toBeGreaterThan(-1);
    // Issue #248's ask: the folder you are standing in wins instead.
    expect(activeIndexWhenActiveFirst).toBeLessThan(targetIndexWhenActiveFirst);
  }, 180_000);
});
