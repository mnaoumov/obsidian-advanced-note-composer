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

describe('split heading recursively', () => {
  it('should mirror only the chosen heading subtree, leaving the other headings in the note', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingItem, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const ROOT_FOLDER = 'ScopedB';
        const SOURCE_PATH = 'split-heading-recursively-source.md';
        /*
         * `ScopedB` is the target; `ScopedA` and `ScopedC` are its siblings at the same (shallowest) level,
         * so a whole-note recursive split would take `ScopedA` FIRST and eventually consume all four
         * headings. They are what proves this command is scoped.
         */
        const SOURCE_CONTENT = [
          'Intro text',
          '',
          '## ScopedA',
          '',
          'body of ScopedA',
          '',
          '## ScopedB',
          '',
          'body of ScopedB',
          '',
          '### ScopedB1',
          '',
          'body of ScopedB1',
          '',
          '## ScopedC',
          '',
          'body of ScopedC',
          ''
        ].join('\n');
        // Inside `ScopedB`'s BODY, not on its `#` line — the enclosing heading is what the command resolves
        // (issue #143).
        const CURSOR_LINE = 8;
        const EXPECTED_HEADING_COUNT = 4;

        /*
         * The same three toggles the whole-note recursive split is driven with: the folder tree is built
         * regardless of `Should split into folder`, the up-front confirmation is part of the flow, and
         * `Should split headings automatically` is off to show the command does not lean on it.
         */
        const isOriginalShouldSplitIntoFolder = await didSetToggle('Should split into folder', false);
        const isOriginalShouldSplitHeadingsAutomatically = await didSetToggle('Should split headings automatically', false);
        const isOriginalShouldAsk = await didSetToggle('Should ask before splitting', true);
        try {
          // Clean up any leftover from a previous run so no folder name is de-duplicated.
          await removeIfExists(ROOT_FOLDER);

          const sourceFile = await resetFile(SOURCE_PATH, SOURCE_CONTENT);
          const editor = await openAndGetEditor(sourceFile);
          editor.setCursor({ ch: 0, line: CURSOR_LINE });

          await waitUntil({
            message: 'metadata cache did not index the source headings',
            predicate: () => (app.metadataCache.getFileCache(sourceFile)?.headings ?? []).length === EXPECTED_HEADING_COUNT
          });

          app.commands.executeCommandById(`${pluginId}:split-heading-recursively`);

          await waitUntil({
            message: 'the scoped split confirmation dialog did not open',
            predicate: () => [...document.querySelectorAll('.modal-title')].some((el) => el.textContent === 'Split heading recursively')
          });
          // Scope to THIS dialog: a fresh vault also shows the plugin's release-notes modal, and reading
          // `.modal-content` document-wide picks that one up instead.
          const confirmationModalEl = [...document.querySelectorAll('.modal')]
            .find((el) => el.querySelector('.modal-title')?.textContent === 'Split heading recursively');
          if (!confirmationModalEl) {
            throw new Error('The scoped split confirmation modal was not found.');
          }
          const confirmationText = confirmationModalEl.querySelector('.modal-content')?.textContent ?? '';
          const confirmButtonEl = [...confirmationModalEl.querySelectorAll(':scope .modal-button-container button')]
            .find((el) => el.textContent === 'Split');
          if (!(confirmButtonEl instanceof HTMLElement)) {
            throw new TypeError('The "Split" button was not found.');
          }
          confirmButtonEl.click();

          const expectedPaths = [
            'ScopedB/ScopedB.md',
            'ScopedB/ScopedB1/ScopedB1.md'
          ];

          await waitUntil({
            message: 'the chosen heading subtree was not mirrored as a folder tree',
            predicate: () => expectedPaths.every((path) => app.vault.getAbstractFileByPath(path) instanceof obsidianModule.TFile)
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const contents: Record<string, string> = {};
          for (const path of expectedPaths) {
            const file = app.vault.getAbstractFileByPath(path);
            contents[path] = file instanceof obsidianModule.TFile ? await app.vault.read(file) : '';
          }

          return {
            confirmationText,
            contents,
            // A note the command must never have created: `ScopedA` is the heading a whole-note run would
            // Have taken first.
            didCreateSiblingNote: app.vault.getAbstractFileByPath('ScopedA/ScopedA.md') !== null,
            sourceContent: await app.vault.read(sourceFile)
          };
        } finally {
          await didSetToggle('Should split into folder', isOriginalShouldSplitIntoFolder);
          await didSetToggle('Should split headings automatically', isOriginalShouldSplitHeadingsAutomatically);
          await didSetToggle('Should ask before splitting', isOriginalShouldAsk);
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

    // The dialog names the heading and promises exactly its own subtree — never the untouched siblings.
    expect(result.confirmationText).toContain('Notes that will be created');
    expect(result.confirmationText).toContain('ScopedB1');
    expect(result.confirmationText).not.toContain('ScopedA');
    expect(result.confirmationText).not.toContain('ScopedC');

    // The chosen heading became a folder tree, nested exactly as a whole-note run would have nested it.
    expect(result.contents['ScopedB/ScopedB.md']).toContain('body of ScopedB');
    expect(result.contents['ScopedB/ScopedB1/ScopedB1.md']).toContain('body of ScopedB1');
    expect(result.contents['ScopedB/ScopedB.md']).not.toContain('body of ScopedB1');
    expect(result.contents['ScopedB/ScopedB.md']).toContain('ScopedB1');

    // What issue #228 is actually about: the note's other headings are still there, with their bodies.
    expect(result.sourceContent).toContain('## ScopedA');
    expect(result.sourceContent).toContain('body of ScopedA');
    expect(result.sourceContent).toContain('## ScopedC');
    expect(result.sourceContent).toContain('body of ScopedC');
    expect(result.sourceContent).toContain('Intro text');
    // Only the chosen heading left, replaced by the usual residual link down into the new tree.
    expect(result.sourceContent).not.toContain('body of ScopedB\n');
    expect(result.sourceContent).toContain('ScopedB');
    expect(result.didCreateSiblingNote).toBe(false);
  });
});
