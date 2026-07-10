import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup';
import {
  describe,
  expect,
  it
} from 'vitest';

interface PickerState {
  hasPromptInput: boolean;
  minimizeButtonCount: number;
}

const PLUGIN_ID = 'advanced-note-composer';

describe('minimize button', () => {
  it('should not render a minimize button on the initial merge picker', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, obsidianModule, pluginId, waitUntil }) {
        const RENDER_DELAY_IN_MILLISECONDS = 150;

        const sourceFile = await ensureMarkdownFile('anc-minimize-source.md', '# Source\n\ncontent');
        await ensureMarkdownFile('anc-minimize-other.md', '# Other\n\ncontent');
        await app.workspace.getLeaf(false).openFile(sourceFile);
        await waitUntil({ predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor !== undefined });

        app.commands.executeCommandById(`${pluginId}:merge-file`);
        await waitUntil({ predicate: () => document.querySelector('.prompt') !== null });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        const prompt = document.querySelector('.prompt');
        const pickerState: PickerState = {
          hasPromptInput: prompt?.querySelector('.prompt-input') !== null && prompt?.querySelector('.prompt-input') !== undefined,
          minimizeButtonCount: prompt ? prompt.querySelectorAll('.minimize-button').length : -1
        };

        // Cancel the merge via the plugin's own unlock command. Aborting the setup flow closes the
        // Locked modal and releases the source-file lock, leaving no lingering modal or lock behind.
        app.commands.executeCommandById(`${pluginId}:unlock-active-note`);
        await waitUntil({ predicate: () => document.querySelector('.prompt') === null });

        return pickerState;

        async function ensureMarkdownFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            return existing;
          }
          return app.vault.create(path, content);
        }
      },
      vaultPath: getTempVault().path
    });

    // The picker really opened (it is the real suggest modal with a search input)...
    expect(result.hasPromptInput).toBe(true);
    // ...and it carries no minimize button.
    expect(result.minimizeButtonCount).toBe(0);
  });
});
