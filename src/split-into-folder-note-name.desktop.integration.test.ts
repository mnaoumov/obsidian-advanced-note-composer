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

import type { PluginSettingsTab } from './plugin-settings-tab.ts';

import { findSettingItemInObsidian } from './settings-tab-navigation.ts';

const PLUGIN_ID = 'advanced-note-composer';

describe('split into folder note name', () => {
  it('should name the extracted note after the template and keep the folder name as an alias', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingItem, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const SAVE_DELAY_IN_MILLISECONDS = 300;
        const NEW_NOTE_NAME = 'Named split';
        const NOTE_NAME_IN_FOLDER = 'Overview';
        const NEW_NOTE_PATH = `${NEW_NOTE_NAME}/${NOTE_NAME_IN_FOLDER}.md`;
        const SOURCE_PATH = 'split-into-folder-note-name-source.md';

        const isOriginalShouldAsk = await didSetToggle('Should ask before splitting', false);
        const isOriginalShouldSplitIntoFolder = await didSetToggle('Should split into folder', true);
        const originalNoteName = await setNoteName(NOTE_NAME_IN_FOLDER);
        try {
          // Clean up any leftover from a previous run so the folder name is not de-duplicated.
          await removeIfExists(NEW_NOTE_PATH);
          await removeIfExists(NEW_NOTE_NAME);

          const sourceFile = await resetFile(SOURCE_PATH, 'keep this fragment here');
          const editor = await openAndGetEditor(sourceFile);
          // Select "fragment".
          editor.setSelection(editor.offsetToPos(10), editor.offsetToPos(18));
          app.commands.executeCommandById(`${pluginId}:extract-current-selection`);
          await waitUntil({ message: 'split picker did not open', predicate: () => document.querySelector('.prompt') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No split picker input.');
          }
          input.value = NEW_NOTE_NAME;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          // Forced rather than waited for: the `Enter to create` row is absent whenever ANYTHING fuzzy-matches
          // The typed name, so waiting for it made this suite depend on the shared vault's contents
          // ([[T880-P12]]).
          input.focus();
          pressKey({ key: 'Enter', modifiers: ['Mod'] });

          await waitUntil({
            message: 'extracted note was not created under the configured note name',
            predicate: () => app.vault.getAbstractFileByPath(NEW_NOTE_PATH) instanceof obsidianModule.TFile
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const newFile = app.vault.getAbstractFileByPath(NEW_NOTE_PATH);
          const newFileContent = newFile instanceof obsidianModule.TFile ? await app.vault.read(newFile) : '';
          // The note the template renamed away from is still recorded, so links by that name resolve.
          const frontmatter = newFile instanceof obsidianModule.TFile
            ? app.metadataCache.getFileCache(newFile)?.frontmatter ?? {}
            : {};

          // The note is named after the template, NOT after its folder.
          const isNamedAfterFolder = app.vault.getAbstractFileByPath(`${NEW_NOTE_NAME}/${NEW_NOTE_NAME}.md`) !== null;
          const isFolder = app.vault.getAbstractFileByPath(NEW_NOTE_NAME) instanceof obsidianModule.TFolder;

          await waitUntil({
            message: 'source link to the extracted note did not resolve',
            predicate: () => Object.keys(app.metadataCache.resolvedLinks[SOURCE_PATH] ?? {}).includes(NEW_NOTE_PATH)
          });
          const isLinkResolves = Object.keys(app.metadataCache.resolvedLinks[SOURCE_PATH] ?? {}).includes(NEW_NOTE_PATH);

          return { frontmatter, isFolder, isNamedAfterFolder, linkResolves: isLinkResolves, newFileContent };
        } finally {
          await setNoteName(originalNoteName);
          await didSetToggle('Should ask before splitting', isOriginalShouldAsk);
          await didSetToggle('Should split into folder', isOriginalShouldSplitIntoFolder);
        }

        async function removeIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }

        async function resetFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          return app.vault.create(path, content);
        }

        async function openAndGetEditor(file: TFile): Promise<Editor> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: 'markdown editor did not open',
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor !== undefined
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          return view.editor;
        }

        function openSettingsTab(): PluginSettingsTab {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          const pluginSettingsTab = tab as PluginSettingsTab;
          return pluginSettingsTab;
        }

        async function requireSettingItem(tab: PluginSettingsTab, name: string): Promise<HTMLElement> {
          const item = await findSettingItem({ app, name, settingTab: tab });
          if (!item) {
            throw new Error(`"${name}" setting was not found.`);
          }
          return item;
        }

        async function setNoteName(value: string): Promise<string> {
          const tab = openSettingsTab();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const noteNameItem = await requireSettingItem(tab, 'Split into folder note name');
          const textAreaEl = noteNameItem.querySelector('textarea');
          if (!(textAreaEl instanceof HTMLTextAreaElement)) {
            throw new TypeError('"Split into folder note name" input was not found.');
          }

          const previousValue = textAreaEl.value;
          textAreaEl.value = value;
          textAreaEl.dispatchEvent(new Event('input'));
          textAreaEl.dispatchEvent(new Event('change'));
          await sleep(SAVE_DELAY_IN_MILLISECONDS);

          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return previousValue;
        }

        async function didSetToggle(name: string, shouldEnable: boolean): Promise<boolean> {
          const tab = openSettingsTab();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const toggleItem = await requireSettingItem(tab, name);
          const toggle = toggleItem.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new TypeError(`"${name}" toggle was not found.`);
          }
          const wasEnabled = toggle.classList.contains('is-enabled');
          if (wasEnabled !== shouldEnable) {
            toggle.click();
            await sleep(RENDER_DELAY_IN_MILLISECONDS);
          }
          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return wasEnabled;
        }
      },
      input: { findSettingItem: findSettingItemInObsidian, pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The extracted note is named after the configured note name, inside a folder named after the typed name.
    expect(result.isFolder).toBe(true);
    expect(result.isNamedAfterFolder).toBe(false);
    expect(result.newFileContent).toContain('fragment');
    // The name the note would have had is preserved, so links by that name still resolve.
    expect(result.frontmatter['title']).toBe('Named split');
    expect(result.frontmatter['aliases']).toContain('Named split');
    // The residual link left in the source resolves to the renamed note inside its folder.
    expect(result.linkResolves).toBe(true);
  });
});
