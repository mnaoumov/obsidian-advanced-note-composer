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

describe('switch to smart cut from the split confirmation dialog', () => {
  it('marks the selection and opens the target instead of splitting', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, obsidianModule, pluginId, waitUntil }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const originalShouldAsk = await setAskBeforeSplitting(true);
        try {
          const source = await resetFile('confirm-switch-source.md', 'alpha bravo charlie');
          const target = await resetFile('confirm-switch-target.md', 'target body');

          // Open the source, select "bravo", and start an extract.
          const editor = await openAndGetEditor(source);
          editor.setSelection(editor.offsetToPos(6), editor.offsetToPos(11));
          app.commands.executeCommandById(`${pluginId}:extract-current-selection`);
          await waitUntil({ predicate: () => document.querySelector('.prompt') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // Choose the (existing) target note in the picker.
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new Error('No split picker input.');
          }
          input.value = target.basename;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({ predicate: () => Array.from(document.querySelectorAll('.suggestion-title')).some((el) => el.textContent.includes(target.basename)) });
          input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Enter', key: 'Enter' }));

          // The confirmation dialog appears; click its "Switch to smart cut & paste" button.
          await waitUntil({ predicate: () => findSwitchButton() !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const switchButton = findSwitchButton();
          if (!switchButton) {
            throw new Error('No "Switch to smart cut & paste" button in the confirmation dialog.');
          }
          switchButton.click();

          // The mark is now active: the permanent notice shows and the target note is opened.
          await waitUntil({ predicate: () => app.workspace.getActiveFile()?.path === 'confirm-switch-target.md' });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const markNoticeShown = findMarkNotice() !== null;
          const activePath = app.workspace.getActiveFile()?.path ?? '';
          const sourceContent = await app.vault.read(source);
          const targetContent = await app.vault.read(target);

          // Clean up: release the mark so the source note is unlocked.
          app.commands.executeCommandById(`${pluginId}:cancel-move`);
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          return { activePath, markNoticeShown, sourceContent, targetContent };
        } finally {
          await setAskBeforeSplitting(originalShouldAsk);
        }

        function findSwitchButton(): HTMLButtonElement | null {
          for (const el of Array.from(document.querySelectorAll('.modal-button-container button'))) {
            if (el.instanceOf(HTMLButtonElement) && el.textContent === 'Switch to smart cut & paste') {
              return el;
            }
          }
          return null;
        }

        function findMarkNotice(): Element | null {
          for (const el of Array.from(activeDocument.querySelectorAll('.notice'))) {
            if (el.textContent.includes('Smart cut & paste')) {
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

    // The confirmation-dialog switch marked the selection (permanent notice) and opened the target...
    expect(result.markNoticeShown).toBe(true);
    expect(result.activePath).toBe('confirm-switch-target.md');
    // ...without splitting: the source still holds "bravo" and the target is untouched.
    expect(result.sourceContent).toContain('bravo');
    expect(result.targetContent).toBe('target body');
  });
});
