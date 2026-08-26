import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import { findSettingItemInObsidian } from './settings-tab-navigation.ts';

// Desktop-only: this is a folder-merge (file-move) flow. It runs desktop-only, matching the plugin's
// Established integration convention (no Android emulator wired for it). File-move suites can hit the
// Documented headless rename wall (`renameFile`/`metadataCache.onCleanCache`) when several run in one
// Aggregate; if this stalls in the aggregate, it is `it.skip`-ped and must still pass alone.
// Isolation: `npx vitest run --project integration-tests:desktop src/merge-folder-skips-ignored.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

// Minimal shape of the plugin's settings component reached at runtime to set an ignored path (there is
// No settings-tab UI control for a single ignored path, so the live component's `editAndSave` is used).
interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: ExcludePathsSettings;
}

interface ExcludePathsSettings {
  excludePaths: string[];
  shouldAlwaysMergeExcludedItems: boolean;
  shouldAskBeforeMerging: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: ExcludePathsSettings) => void): Promise<void>;
  settings: ExcludePathsSettings;
}

describe('merge folder skips ignored files (issue #72)', () => {
  it('does not create a stray empty target for an ignored file and reports it in a summary notice', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingItem, ignoredPath, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const settingsComponent = findSettingsComponent();
        const originalExcludePaths = [...settingsComponent.settings.excludePaths];
        const isOriginalShouldAsk = await didSetAskBeforeMerging(true);
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.excludePaths = [ignoredPath];
          });

          await trashIfExists('ign-src');
          await trashIfExists('ign-dst');

          // Source folder holds one ignored file and one normal file; the target folder exists.
          await app.vault.createFolder('ign-src');
          const normalNote = await app.vault.create('ign-src/normal.md', 'normal body');
          await app.vault.create('ign-src/ignored.md', 'ignored body');
          await app.vault.createFolder('ign-dst');
          await app.vault.create('ign-dst/keep.md', 'keep body');

          // Open a note inside `ign-src` so the folder command resolves the active file's parent folder.
          await openFile(normalNote);

          app.commands.executeCommandById(`${pluginId}:merge-folder`);
          await waitUntil({
            message: 'merge-folder picker did not open',
            predicate: () => document.querySelector('.prompt') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          await chooseFolderInPicker('ign-dst');
          await waitUntil({
            message: 'merge confirm button did not appear',
            predicate: () => findButton('Merge') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          findButton('Merge')?.click();

          // The normal file lands in the target; the ignored file never produces a target entry.
          await waitUntil({
            message: 'normal file was not merged into the target',
            predicate: () => app.vault.getAbstractFileByPath('ign-dst/normal.md') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // The summary notice must name the skipped file.
          await waitUntil({
            message: 'ignored-files summary notice did not appear',
            predicate: () => summaryNoticeText() !== null
          });

          const isNormalMerged = app.vault.getAbstractFileByPath('ign-dst/normal.md') !== null;
          const isNoStrayEmptyTarget = app.vault.getAbstractFileByPath('ign-dst/ignored.md') === null;
          const isIgnoredFileRemainsInSource = app.vault.getAbstractFileByPath('ign-src/ignored.md') !== null;
          const noticeText = summaryNoticeText() ?? '';

          return { ignoredFileRemainsInSource: isIgnoredFileRemainsInSource, normalMerged: isNormalMerged, noStrayEmptyTarget: isNoStrayEmptyTarget, noticeText };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.excludePaths = originalExcludePaths;
          });
          await didSetAskBeforeMerging(isOriginalShouldAsk);
        }

        function summaryNoticeText(): null | string {
          for (const el of document.querySelectorAll('.notice')) {
            if (el.textContent.includes('were not merged because they are ignored')) {
              return el.textContent;
            }
          }
          return null;
        }

        function findButton(text: string): HTMLButtonElement | null {
          for (const el of document.querySelectorAll('.modal-button-container button')) {
            if (el.instanceOf(HTMLButtonElement) && el.textContent === text) {
              return el;
            }
          }
          return null;
        }

        function isSettingsComponent(node: ComponentTreeNode): node is SettingsCarrier {
          return typeof node.editAndSave === 'function' && Array.isArray(node.settings?.excludePaths);
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

        async function chooseFolderInPicker(folderPath: string): Promise<void> {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No merge-folder picker input.');
          }
          input.value = folderPath;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: 'target folder suggestion did not appear',
            predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent === folderPath)
          });
          input.focus();
          pressKey({ key: 'Enter' });
        }

        async function didSetAskBeforeMerging(shouldAsk: boolean): Promise<boolean> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const item = await findSettingItem({ app, name: 'Should ask before merging', settingTab: tab });
          const toggle = item?.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new TypeError('"Should ask before merging" toggle was not found.');
          }
          const wasEnabled = toggle.classList.contains('is-enabled');
          if (wasEnabled !== shouldAsk) {
            toggle.click();
            await sleep(RENDER_DELAY_IN_MILLISECONDS);
          }
          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return wasEnabled;
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }

        async function openFile(file: TFile): Promise<void> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
          });
        }
      },
      input: { findSettingItem: findSettingItemInObsidian, ignoredPath: 'ign-src/ignored.md', pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The normal file was merged into the target folder.
    expect(result.normalMerged).toBe(true);
    // No stray empty target file was created for the ignored source file.
    expect(result.noStrayEmptyTarget).toBe(true);
    // The ignored file was left untouched in its source folder.
    expect(result.ignoredFileRemainsInSource).toBe(true);
    // The summary notice reported the skipped file by name.
    expect(result.noticeText).toContain('were not merged because they are ignored');
    expect(result.noticeText).toContain('ignored');
  });

  it('merges an excluded file too when Should always merge excluded items is on (issue #150)', async () => {
    const result = await evalInObsidian({
      async callback({ app, ignoredPath, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const settingsComponent = findSettingsComponent();
        const originalExcludePaths = [...settingsComponent.settings.excludePaths];
        const isOriginalAlways = settingsComponent.settings.shouldAlwaysMergeExcludedItems;
        const isOriginalShouldAsk = settingsComponent.settings.shouldAskBeforeMerging;
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.excludePaths = [ignoredPath];
            settings.shouldAlwaysMergeExcludedItems = true;
            // Skip the confirmation dialog so the merge runs straight from the picker.
            settings.shouldAskBeforeMerging = false;
          });

          await trashIfExists('am-src');
          await trashIfExists('am-dst');

          await app.vault.createFolder('am-src');
          const normalNote = await app.vault.create('am-src/normal.md', 'normal body');
          await app.vault.create('am-src/ignored.md', 'ignored body');
          await app.vault.createFolder('am-dst');
          await app.vault.create('am-dst/keep.md', 'keep body');

          await openFile(normalNote);

          app.commands.executeCommandById(`${pluginId}:merge-folder`);
          await waitUntil({
            message: 'merge-folder picker did not open',
            predicate: () => document.querySelector('.prompt') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          await chooseFolderInPicker('am-dst');

          // The excluded file IS merged into the target when the setting is on.
          await waitUntil({
            message: 'excluded file was not merged into the target',
            predicate: () => app.vault.getAbstractFileByPath('am-dst/ignored.md') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const isExcludedMerged = app.vault.getAbstractFileByPath('am-dst/ignored.md') !== null;
          const isExcludedSourceGone = app.vault.getAbstractFileByPath('am-src/ignored.md') === null;
          const isNormalMerged = app.vault.getAbstractFileByPath('am-dst/normal.md') !== null;
          const hasIgnoredNotice = summaryNoticeText() !== null;

          return { excludedMerged: isExcludedMerged, excludedSourceGone: isExcludedSourceGone, hasIgnoredNotice, normalMerged: isNormalMerged };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.excludePaths = originalExcludePaths;
            settings.shouldAlwaysMergeExcludedItems = isOriginalAlways;
            settings.shouldAskBeforeMerging = isOriginalShouldAsk;
          });
        }

        async function chooseFolderInPicker(folderPath: string): Promise<void> {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No merge-folder picker input.');
          }
          input.value = folderPath;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: 'target folder suggestion did not appear',
            predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent === folderPath)
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
          return typeof node.editAndSave === 'function' && Array.isArray(node.settings?.excludePaths);
        }

        async function openFile(file: TFile): Promise<void> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
          });
        }

        function summaryNoticeText(): null | string {
          for (const el of document.querySelectorAll('.notice')) {
            if (el.textContent.includes('were not merged because they are ignored')) {
              return el.textContent;
            }
          }
          return null;
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }
      },
      input: { ignoredPath: 'am-src/ignored.md', pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The excluded file was merged into the target instead of being skipped.
    expect(result.excludedMerged).toBe(true);
    expect(result.excludedSourceGone).toBe(true);
    // The normal file merged too, and no "ignored" summary notice was shown.
    expect(result.normalMerged).toBe(true);
    expect(result.hasIgnoredNotice).toBe(false);
  });
});
