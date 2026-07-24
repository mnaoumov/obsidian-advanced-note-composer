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

describe('extract between horizontal rules', () => {
  it('extracts the block between the rules closest to the cursor, leaving the rules in place', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        // Two different rule spellings (`---` and `***`) prove Obsidian's parser tags both as thematicBreak
        // Sections, which is what the command keys off. `middle` sits between them.
        const SOURCE = 'intro\n\n---\n\nmiddle\n\n***\n\nouter';
        const MIDDLE_LINE = 4;

        const originalShouldAsk = await setAskBeforeSplitting(false);
        try {
          const file = await resetFile('extract-hr.md', SOURCE);
          const editor = await openAndGetEditor(file);
          editor.setCursor({ ch: 0, line: MIDDLE_LINE });

          const canRun = app.commands.executeCommandById(`${pluginId}:extract-between-horizontal-rules`);
          await waitUntil({ predicate: () => document.querySelector('.prompt') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // Extract to the bottom of the same note (Enter on the source note in the picker).
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new Error('No split picker input.');
          }
          input.value = file.basename;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            predicate: () => Array.from(document.querySelectorAll('.suggestion-title')).some((el) => el.textContent.includes(file.basename))
          });
          input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Enter', key: 'Enter' }));

          await waitUntil({ predicate: () => editorValueFor('extract-hr.md')?.trimEnd().endsWith('middle') === true });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          return { canRun, note: editorValueFor('extract-hr.md') ?? '' };
        } finally {
          await setAskBeforeSplitting(originalShouldAsk);
        }

        async function setAskBeforeSplitting(shouldAsk: boolean): Promise<boolean> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          (tab as PluginSettingsTab).displayLegacy();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const item = Array.from(tab.containerEl.querySelectorAll('.setting-item'))
            .find((el) => el.querySelector('.setting-item-name')?.textContent === 'Should ask before splitting');
          const toggle = item?.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new Error('"Should ask before splitting" toggle was not found.');
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
      vaultPath: getTempVault().path
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
