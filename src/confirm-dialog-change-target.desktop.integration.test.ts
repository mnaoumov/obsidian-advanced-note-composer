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

describe('change target from the split confirmation dialog', () => {
  it('reopens the picker and splits into the newly chosen target', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, obsidianModule, pluginId, waitUntil }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const originalShouldAsk = await setAskBeforeSplitting(true);
        try {
          const source = await resetFile('change-target-source.md', 'alpha bravo charlie');
          const targetA = await resetFile('change-target-a.md', 'target a body');
          const targetB = await resetFile('change-target-b.md', 'target b body');

          // Open the source, select "bravo", and start an extract.
          const editor = await openAndGetEditor(source);
          editor.setSelection(editor.offsetToPos(6), editor.offsetToPos(11));
          app.commands.executeCommandById(`${pluginId}:extract-current-selection`);
          await waitUntil({ predicate: () => document.querySelector('.prompt') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // Choose target A in the picker.
          await chooseInPicker(targetA.basename);

          // The confirmation dialog appears (for target A) with the "Change target" button.
          await waitUntil({ predicate: () => findButton('Change target') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const changeTargetButtonPresent = findButton('Change target') !== null;

          // Click "Change target": the picker reopens.
          findButton('Change target')?.click();
          await waitUntil({ predicate: () => document.querySelector('.prompt') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // Choose target B in the reopened picker.
          await chooseInPicker(targetB.basename);

          // The confirmation dialog appears again (for target B); confirm the split.
          await waitUntil({ predicate: () => findButton('Split') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          findButton('Split')?.click();

          // The split completes: target B receives the extracted text, source loses it.
          await waitUntil({ predicate: () => !document.body.querySelector('.mod-confirmation') });
          await waitUntil({ predicate: () => !editor.getValue().includes('bravo') });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // Read the source from the live editor buffer (the removal is applied there before it is
          // Auto-saved to disk); the targets are transaction-written, so read those from the vault.
          const sourceContent = editor.getValue();
          const targetAContent = await app.vault.read(targetA);
          const targetBContent = await app.vault.read(targetB);

          return { changeTargetButtonPresent, sourceContent, targetAContent, targetBContent };
        } finally {
          await setAskBeforeSplitting(originalShouldAsk);
        }

        function findButton(text: string): HTMLButtonElement | null {
          for (const el of Array.from(document.querySelectorAll('.modal-button-container button'))) {
            if (el.instanceOf(HTMLButtonElement) && el.textContent === text) {
              return el;
            }
          }
          return null;
        }

        async function chooseInPicker(basename: string): Promise<void> {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new Error('No split picker input.');
          }
          input.value = basename;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({ predicate: () => Array.from(document.querySelectorAll('.suggestion-title')).some((el) => el.textContent.includes(basename)) });
          input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Enter', key: 'Enter' }));
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

    // The confirmation dialog offered "Change target"...
    expect(result.changeTargetButtonPresent).toBe(true);
    // ...and after re-picking, the split landed in target B (not target A), removing the text from source.
    expect(result.targetBContent).toContain('bravo');
    expect(result.targetAContent).toBe('target a body');
    expect(result.sourceContent).not.toContain('bravo');
  });
});
