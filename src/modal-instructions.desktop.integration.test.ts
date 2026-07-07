import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsTab } from './plugin-settings-tab.ts';

interface InstructionCounts {
  checkboxCount: number;
  instructionCount: number;
}

const PLUGIN_ID = 'advanced-note-composer';

describe('shouldShowModalInstructions', () => {
  it('should show the modal instruction bar only when the setting is enabled', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 150;
        const EDIT_SAVE_DELAY_IN_MILLISECONDS = 300;
        const POLL_INTERVAL_IN_MILLISECONDS = 50;
        const POLL_TIMEOUT_IN_MILLISECONDS = 5000;

        const sourceFile = await ensureMarkdownFile('anc-instructions-source.md', '# Source\n\ncontent');
        await ensureMarkdownFile('anc-instructions-other.md', '# Other\n\ncontent');
        await app.workspace.getLeaf(false).openFile(sourceFile);
        await waitUntil(() => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor !== undefined);

        await setShowInstructions(true);
        const withInstructions = await openMergeModalAndCount();

        await setShowInstructions(false);
        const withoutInstructions = await openMergeModalAndCount();

        // Restore the default so the shared Obsidian instance is left in a clean state.
        await setShowInstructions(true);

        return { withInstructions, withoutInstructions };

        async function ensureMarkdownFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            return existing;
          }
          return app.vault.create(path, content);
        }

        async function setShowInstructions(shouldShow: boolean): Promise<void> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const settingTab = app.setting.pluginTabs.find((tab) => tab.id === pluginId);
          if (!settingTab) {
            throw new Error('Settings tab was not found.');
          }
          (settingTab as PluginSettingsTab).displayLegacy();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const settingItems = Array.from(settingTab.containerEl.querySelectorAll('.setting-item'));
          const settingItem = settingItems.find((el) => el.querySelector('.setting-item-name')?.textContent === 'Should show modal instructions');
          const toggleEl = settingItem?.querySelector('.checkbox-container');
          if (!(toggleEl instanceof HTMLElement)) {
            throw new Error('"Should show modal instructions" toggle was not found.');
          }

          const isEnabled = toggleEl.classList.contains('is-enabled');
          if (isEnabled !== shouldShow) {
            toggleEl.click();
            await sleep(EDIT_SAVE_DELAY_IN_MILLISECONDS);
          }

          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        }

        async function openMergeModalAndCount(): Promise<InstructionCounts> {
          app.commands.executeCommandById(`${pluginId}:merge-file`);
          await waitUntil(() => document.querySelector('.prompt') !== null);
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const prompt = document.querySelector('.prompt');
          const checkboxCount = prompt ? prompt.querySelectorAll('.prompt-instructions input[type="checkbox"]').length : 0;
          const instructionCount = prompt ? prompt.querySelectorAll('.prompt-instructions .prompt-instruction').length : 0;

          // Cancel the merge via the plugin's own unlock command. Aborting the setup flow closes the
          // Locked modal and releases the source-file lock, leaving no lingering modal or lock behind.
          app.commands.executeCommandById(`${pluginId}:unlock-active-note`);
          await waitUntil(() => document.querySelector('.prompt') === null);

          return { checkboxCount, instructionCount };
        }

        async function waitUntil(predicate: () => boolean): Promise<void> {
          const startTime = performance.now();
          while (performance.now() - startTime < POLL_TIMEOUT_IN_MILLISECONDS) {
            if (predicate()) {
              return;
            }
            await sleep(POLL_INTERVAL_IN_MILLISECONDS);
          }
          throw new Error('Timed out waiting for condition.');
        }
      },
      vaultPath: getTempVault().path
    });

    expect(result.withInstructions.instructionCount).toBeGreaterThan(0);
    expect(result.withInstructions.checkboxCount).toBeGreaterThan(0);
    expect(result.withoutInstructions.instructionCount).toBe(0);
    expect(result.withoutInstructions.checkboxCount).toBe(0);
  });
});
