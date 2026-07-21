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

describe('switch to split/extract from the smart-cut notice', () => {
  it('re-opens the source with the selection restored, opens the split picker, and completes the move', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const originalShouldAsk = await setAskBeforeSplitting(false);
        try {
          const source = await resetFile('open-split-source.md', 'alpha bravo charlie');
          const target = await resetFile('open-split-target.md', 'target body');

          // Open the source, select "bravo", and mark it for a smart cut & paste move.
          const editor = await openAndGetEditor(source);
          editor.setSelection(editor.offsetToPos(6), editor.offsetToPos(11));
          app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
          await waitUntil({ predicate: () => findSwitchButton() !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const switchButtonPresent = findSwitchButton() !== null;

          // Navigate away to prove the switch re-opens the SOURCE (not whatever is active).
          await app.workspace.getLeaf(false).openFile(target);
          await waitUntil({ predicate: () => app.workspace.getActiveFile()?.path === 'open-split-target.md' });

          // Click the notice's "Switch to split/extract" button: it clears the mark, re-opens the source
          // With the selection restored, and opens the split picker.
          findSwitchButton()?.click();
          await waitUntil({ predicate: () => document.querySelector('.prompt') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const activePathWhenPickerOpen = app.workspace.getActiveFile()?.path ?? '';
          const restoredSelection = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor.getSelection() ?? '';
          const markNoticeGone = findSwitchButton() === null;

          // Choose the target in the picker (Enter = move to bottom); "ask before splitting" is off so it
          // Completes immediately.
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new Error('No split picker input.');
          }
          input.value = target.basename;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({ predicate: () => Array.from(document.querySelectorAll('.suggestion-title')).some((el) => el.textContent.includes(target.basename)) });
          input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Enter', key: 'Enter' }));

          // The moved text lands in the target and is removed from the source; the source edit reaches
          // The open editor buffer first, so wait for the vault file to reflect both sides.
          await waitUntil({ predicate: async () => (await app.vault.read(target)).includes('bravo') });
          await waitUntil({ predicate: async () => !(await app.vault.read(source)).includes('bravo') });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const sourceContent = await app.vault.read(source);
          const targetContent = await app.vault.read(target);

          return { activePathWhenPickerOpen, markNoticeGone, restoredSelection, sourceContent, switchButtonPresent, targetContent };
        } finally {
          await setAskBeforeSplitting(originalShouldAsk);
        }

        function findSwitchButton(): HTMLButtonElement | null {
          for (const el of Array.from(activeDocument.querySelectorAll('.notice button'))) {
            if (el.instanceOf(HTMLButtonElement) && el.textContent === 'Switch to split/extract') {
              return el;
            }
          }
          return null;
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
      },
      vaultPath: getTempVault().path
    });

    // The notice offered the switch button; clicking it re-opened the source (dismissing the mark
    // Notice) with "bravo" restored as the selection and the split picker open.
    expect(result.switchButtonPresent).toBe(true);
    expect(result.markNoticeGone).toBe(true);
    expect(result.activePathWhenPickerOpen).toBe('open-split-source.md');
    expect(result.restoredSelection).toBe('bravo');
    // Completing the split moved "bravo" into the target and removed it from the source.
    expect(result.targetContent).toContain('bravo');
    expect(result.sourceContent).not.toContain('bravo');
  });
});
