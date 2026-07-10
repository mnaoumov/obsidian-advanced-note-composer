import type {
  Editor,
  TFile
} from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsTab } from './plugin-settings-tab.ts';

const PLUGIN_ID = 'advanced-note-composer';

describe('same-note extract via the split picker', () => {
  it('should offer the source note and extract the selection to its bottom (Enter) or top (Shift+Enter)', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, obsidianModule, pluginId, waitUntil }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const originalShouldAsk = await setAskBeforeSplitting(false);
        try {
          // --- Enter: extract "bravo" to the BOTTOM of the same note. ---
          const bottomFile = await resetFile('extract-same-bottom.md', 'alpha bravo charlie');
          const bottomSuggestions = await openSplitPickerForSelection(bottomFile, 6, 11);
          dispatchSelectSuggestion(false);
          await waitUntil({ predicate: () => editorValueFor('extract-same-bottom.md')?.trimEnd().endsWith('bravo') === true });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const bottomNote = editorValueFor('extract-same-bottom.md') ?? '';

          // --- Shift+Enter: extract "gamma" to the TOP of the same note. ---
          const topFile = await resetFile('extract-same-top.md', 'delta epsilon gamma');
          await openSplitPickerForSelection(topFile, 14, 19);
          dispatchSelectSuggestion(true);
          await waitUntil({ predicate: () => movedBefore('extract-same-top.md', 'gamma', 'delta') });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const topNote = editorValueFor('extract-same-top.md') ?? '';

          return { bottomNote, bottomSuggestions, topNote };
        } finally {
          await setAskBeforeSplitting(originalShouldAsk);
        }

        async function openSplitPickerForSelection(file: TFile, startOffset: number, endOffset: number): Promise<string[]> {
          const editor = await openAndGetEditor(file);
          editor.setSelection(editor.offsetToPos(startOffset), editor.offsetToPos(endOffset));
          app.commands.executeCommandById(`${pluginId}:extract-current-selection`);
          await waitUntil({ predicate: () => document.querySelector('.prompt') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new Error('No split picker input.');
          }
          input.value = file.basename;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({ predicate: () => Array.from(document.querySelectorAll('.suggestion-title')).some((el) => el.textContent.includes(file.basename)) });
          return Array.from(document.querySelectorAll('.suggestion-title')).map((el) => el.textContent);
        }

        function dispatchSelectSuggestion(shouldPrependToTop: boolean): void {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new Error('No split picker input.');
          }
          input.dispatchEvent(
            new KeyboardEvent('keydown', {
              bubbles: true,
              code: 'Enter',
              key: 'Enter',
              shiftKey: shouldPrependToTop
            })
          );
        }

        function movedBefore(path: string, moved: string, marker: string): boolean {
          const value = editorValueFor(path);
          if (value === undefined) {
            return false;
          }
          const movedIndex = value.indexOf(moved);
          const markerIndex = value.indexOf(marker);
          return movedIndex !== -1 && markerIndex !== -1 && movedIndex < markerIndex;
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

    // The split picker now offers the current note itself as a target.
    expect(result.bottomSuggestions).toContain('extract-same-bottom');

    // Enter extracted "bravo" to the bottom: removed from the middle, appended, exactly once, no self-link.
    expect(result.bottomNote).toContain('bravo');
    expect(result.bottomNote.match(/bravo/g)?.length).toBe(1);
    expect(result.bottomNote.trimEnd().endsWith('bravo')).toBe(true);
    expect(result.bottomNote).not.toContain('[[extract-same-bottom');

    // Shift+Enter extracted "gamma" to the top: it now precedes the note's other words, exactly once.
    expect(result.topNote).toContain('gamma');
    expect(result.topNote.match(/gamma/g)?.length).toBe(1);
    expect(result.topNote.indexOf('gamma')).toBeLessThan(result.topNote.indexOf('delta'));
    expect(result.topNote).not.toContain('[[extract-same-top');
  });
});
