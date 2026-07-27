import type {
  Editor,
  TFile
} from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsTab } from './plugin-settings-tab.ts';

const PLUGIN_ID = 'advanced-note-composer';

describe('split headings recursively', () => {
  it('should mirror the heading hierarchy as a folder tree', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const ROOT_FOLDER = 'RecA';
        const SOURCE_PATH = 'split-headings-recursively-source.md';
        const SOURCE_CONTENT = [
          'Intro text',
          '',
          '# RecA',
          '',
          'body of RecA',
          '',
          '## RecB',
          '',
          'body of RecB',
          '',
          '### RecC',
          '',
          'body of RecC',
          '',
          '## RecD',
          '',
          'body of RecD',
          ''
        ].join('\n');

        /*
         * `Should split into folder` stays OFF on purpose: the recursive split builds the folder tree
         * itself, because a recursive split without folders cannot express a hierarchy. This is the
         * load-bearing setting of the whole test.
         *
         * `Should ask before splitting` stays ON so the up-front confirmation dialog is part of the flow
         * being driven, and `Should split headings automatically` stays OFF to show the recursive command
         * does not lean on it.
         */
        const originalShouldSplitIntoFolder = await setToggle('Should split into folder', false);
        const originalShouldSplitHeadingsAutomatically = await setToggle('Should split headings automatically', false);
        const originalShouldAsk = await setToggle('Should ask before splitting', true);
        try {
          // Clean up any leftover from a previous run so no folder name is de-duplicated.
          await removeIfExists(ROOT_FOLDER);

          const sourceFile = await resetFile(SOURCE_PATH, SOURCE_CONTENT);
          const editor = await openAndGetEditor(sourceFile);
          editor.setCursor({ ch: 0, line: 0 });

          await waitUntil({
            message: 'metadata cache did not index the source headings',
            predicate: () => (app.metadataCache.getFileCache(sourceFile)?.headings ?? []).length === 4
          });

          app.commands.executeCommandById(`${pluginId}:split-note-by-headings-recursively`);

          // The whole restructure is confirmed once, up front — drive that real dialog.
          await waitUntil({
            message: 'the recursive split confirmation dialog did not open',
            predicate: () => Array.from(document.querySelectorAll('.modal-title')).some((el) => el.textContent === 'Split note recursively')
          });
          // Scope to THIS dialog: a fresh vault also shows the plugin's release-notes modal, and reading
          // `.modal-content` document-wide picks that one up instead.
          const confirmationModalEl = Array.from(document.querySelectorAll('.modal'))
            .find((el) => el.querySelector('.modal-title')?.textContent === 'Split note recursively');
          if (!confirmationModalEl) {
            throw new Error('The recursive split confirmation modal was not found.');
          }
          const confirmationText = confirmationModalEl.querySelector('.modal-content')?.textContent ?? '';
          const confirmButtonEl = Array.from(confirmationModalEl.querySelectorAll('.modal-button-container button'))
            .find((el) => el.textContent === 'Split');
          if (!(confirmButtonEl instanceof HTMLElement)) {
            throw new Error('The "Split" button was not found.');
          }
          confirmButtonEl.click();

          const expectedPaths = [
            'RecA/RecA.md',
            'RecA/RecB/RecB.md',
            'RecA/RecB/RecC/RecC.md',
            'RecA/RecD/RecD.md'
          ];

          let wasPerNoteConfirmationShown = false;
          await waitUntil({
            message: 'the heading hierarchy was not mirrored as a folder tree',
            predicate: () => {
              wasPerNoteConfirmationShown ||= Array.from(document.querySelectorAll('.modal-title')).some((el) => el.textContent === 'Split file');
              return expectedPaths.every((path) => app.vault.getAbstractFileByPath(path) instanceof obsidianModule.TFile);
            }
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const contents: Record<string, string> = {};
          for (const path of expectedPaths) {
            const file = app.vault.getAbstractFileByPath(path);
            contents[path] = file instanceof obsidianModule.TFile ? await app.vault.read(file) : '';
          }

          const activePath = app.workspace.getActiveFile()?.path ?? '';

          return {
            activePath,
            confirmationText,
            contents,
            wasPerNoteConfirmationShown
          };
        } finally {
          await setToggle('Should split into folder', originalShouldSplitIntoFolder);
          await setToggle('Should split headings automatically', originalShouldSplitHeadingsAutomatically);
          await setToggle('Should ask before splitting', originalShouldAsk);
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

        async function setToggle(name: string, value: boolean): Promise<boolean> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          (tab as PluginSettingsTab).displayLegacy();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const item = Array.from(tab.containerEl.querySelectorAll('.setting-item'))
            .find((el) => el.querySelector('.setting-item-name')?.textContent === name);
          const toggle = item?.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new Error(`"${name}" toggle was not found.`);
          }
          const wasEnabled = toggle.classList.contains('is-enabled');
          if (wasEnabled !== value) {
            toggle.click();
            await sleep(RENDER_DELAY_IN_MILLISECONDS);
          }
          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return wasEnabled;
        }
      },
      vaultPath: getTempVault().path
    });

    // The confirmation listed every note it was about to create, indented by nesting depth.
    expect(result.confirmationText).toContain('Notes that will be created');
    expect(result.confirmationText).toContain('RecC');

    // The heading hierarchy became a folder hierarchy, with `Should split into folder` OFF throughout.
    expect(result.contents['RecA/RecA.md']).toContain('body of RecA');
    expect(result.contents['RecA/RecB/RecB.md']).toContain('body of RecB');
    expect(result.contents['RecA/RecB/RecC/RecC.md']).toContain('body of RecC');
    expect(result.contents['RecA/RecD/RecD.md']).toContain('body of RecD');

    // Each note owns only its own body — its sub-headings moved into their own notes below it.
    expect(result.contents['RecA/RecA.md']).not.toContain('body of RecB');
    expect(result.contents['RecA/RecB/RecB.md']).not.toContain('body of RecC');

    // A parent links to its children, so the tree stays navigable.
    expect(result.contents['RecA/RecA.md']).toContain('RecB');

    // The confirmation is asked once, not once per note.
    expect(result.wasPerNoteConfirmationShown).toBe(false);

    // The run walks the leaf through every note it creates, then hands it back to the source note.
    expect(result.activePath).toBe('split-headings-recursively-source.md');
  });
});
