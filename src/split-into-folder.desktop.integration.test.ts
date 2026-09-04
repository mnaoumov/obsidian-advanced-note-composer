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

import { findSettingItemInObsidian } from './settings-tab-navigation.ts';

const PLUGIN_ID = 'advanced-note-composer';

describe('split into folder', () => {
  it('should create the extracted note inside a new folder named after it, with a resolving link', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingItem, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const NEW_NOTE_NAME = 'Extracted into folder';
        const NEW_NOTE_PATH = `${NEW_NOTE_NAME}/${NEW_NOTE_NAME}.md`;
        const SOURCE_PATH = 'split-into-folder-source.md';

        const isOriginalShouldAsk = await didSetToggle('Should ask before splitting', false);
        const isOriginalShouldSplitIntoFolder = await didSetToggle('Should split into folder', true);
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
          /*
           * `Mod+Enter` creates from what was typed whatever the list holds, rather than waiting for the
           * `Enter to create` row. That row is pushed by `SuggestModalBase.onNoSuggestion()` and nothing
           * else, so it exists ONLY when the search matched nothing at all — one note fuzzy-matching
           * `Extracted into folder` is enough for it to be correctly absent, and the wait then timed out on
           * a row that was never coming ([[T880-P12]]).
           */
          input.focus();
          pressKey({ key: 'Enter', modifiers: ['Mod'] });

          await waitUntil({
            message: 'extracted note was not created inside its own folder',
            predicate: () => app.vault.getAbstractFileByPath(NEW_NOTE_PATH) instanceof obsidianModule.TFile
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const newFile = app.vault.getAbstractFileByPath(NEW_NOTE_PATH);
          const newFileContent = newFile instanceof obsidianModule.TFile ? await app.vault.read(newFile) : '';

          // The link left behind in the source resolves to the newly-created note in its folder.
          await waitUntil({
            message: 'source link to the extracted note did not resolve',
            predicate: () => Object.keys(app.metadataCache.resolvedLinks[SOURCE_PATH] ?? {}).includes(NEW_NOTE_PATH)
          });
          const isLinkResolves = Object.keys(app.metadataCache.resolvedLinks[SOURCE_PATH] ?? {}).includes(NEW_NOTE_PATH);
          const sourceContent = await app.vault.read(sourceFile);

          const isFolder = app.vault.getAbstractFileByPath(NEW_NOTE_NAME) instanceof obsidianModule.TFolder;

          return { isFolder, linkResolves: isLinkResolves, newFileContent, sourceContent };
        } finally {
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
          await waitUntil({ message: 'markdown editor did not open', predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor !== undefined });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          return view.editor;
        }

        async function didSetToggle(name: string, shouldEnable: boolean): Promise<boolean> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const item = await findSettingItem({ app, name, settingTab: tab });
          const toggle = item?.querySelector('.checkbox-container');
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

    // The extracted note lives inside a new folder named after it.
    expect(result.isFolder).toBe(true);
    expect(result.newFileContent).toContain('fragment');
    // The residual link left in the source resolves to the new note inside its folder.
    expect(result.sourceContent).toContain('[[');
    expect(result.linkResolves).toBe(true);
  });
});
