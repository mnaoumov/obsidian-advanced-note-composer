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

describe('extract between horizontal rules', () => {
  it('extracts the block between the rules closest to the cursor, leaving the rules in place', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingItem, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        // Two different rule spellings (`---` and `***`) prove Obsidian's parser tags both as thematicBreak
        // Sections, which is what the command keys off. `middle` sits between them.
        const SOURCE = 'intro\n\n---\n\nmiddle\n\n***\n\nouter';
        const MIDDLE_LINE = 4;

        const isOriginalShouldAsk = await didSetAskBeforeSplitting(false);
        try {
          const file = await resetFile('extract-hr.md', SOURCE);
          const editor = await openAndGetEditor(file);
          editor.setCursor({ ch: 0, line: MIDDLE_LINE });

          // The command keys off the metadata cache's `thematicBreak` Sections, so it stays disabled until
          // The cache has indexed the note just written. Executing before that silently does nothing.
          await waitUntil({
            message: 'metadata cache did not index the horizontal rules',
            predicate: () => (app.metadataCache.getFileCache(file)?.sections ?? []).some((section) => section.type === 'thematicBreak')
          });

          const canRun = app.commands.executeCommandById(`${pluginId}:extract-between-horizontal-rules`);
          await waitUntil({ message: 'split picker did not open', predicate: () => document.querySelector('.prompt') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // Extract to the bottom of the same note (Enter on the source note in the picker).
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No split picker input.');
          }
          input.value = file.basename;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: 'target suggestion did not appear',
            predicate: () => [...document.querySelectorAll('.suggestion-title')].some((el) => el.textContent.includes(file.basename))
          });
          // The suggester needs a beat to mark the matching suggestion active; dispatching Enter the
          // Instant the element appears races that and selects nothing.
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Enter', key: 'Enter' }));

          await waitUntil({
            message: 'the block between the rules was not extracted to the bottom of the note',
            predicate: () => editorValueFor('extract-hr.md')?.trimEnd().endsWith('middle') === true
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          return { canRun, note: editorValueFor('extract-hr.md') ?? '' };
        } finally {
          await didSetAskBeforeSplitting(isOriginalShouldAsk);
        }

        async function didSetAskBeforeSplitting(shouldAsk: boolean): Promise<boolean> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const item = await findSettingItem({ app, name: 'Should ask before splitting', settingTab: tab });
          const toggle = item?.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new TypeError('"Should ask before splitting" toggle was not found.');
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
          await waitUntil({ predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor !== undefined });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          return view.editor;
        }

        function editorValueFor(path: string): string | undefined {
          for (const leaf of app.workspace.getLeavesOfType('markdown')) {
            const view = leaf.view;
            if (view instanceof obsidianModule.MarkdownView && view.file?.path === path) {
              return view.editor.getValue();
            }
          }
          return undefined;
        }
      },
      input: { findSettingItem: findSettingItemInObsidian, pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The command was enabled (the note has horizontal rules).
    expect(result.canRun).toBe(true);

    // "middle" was moved to the bottom of the note, exactly once, with no self-link (same-note default).
    expect(result.note.match(/middle/g)?.length).toBe(1);
    expect(result.note.trimEnd().endsWith('middle')).toBe(true);
    expect(result.note).not.toContain('[[extract-hr');

    // Both bounding rules stayed in place; only the content between them was extracted.
    expect(result.note).toContain('---');
    expect(result.note).toContain('***');
    expect(result.note).toContain('intro');
    expect(result.note).toContain('outer');
  });
});
