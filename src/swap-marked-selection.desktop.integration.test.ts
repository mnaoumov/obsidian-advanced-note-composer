import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

const PLUGIN_ID = 'advanced-note-composer';

describe('swap marked selection from the smart cut & paste notice', () => {
  it('should swap the marked selection with the active editor selection when the Swap button is clicked', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const BIG_TIMEOUT_IN_MILLISECONDS = 30000;

        const sourceFile = await resetFile('swap-source.md', 'AAA BBB CCC\n');
        const targetFile = await resetFile('swap-target.md', 'XXX YYY ZZZ\n');

        // Mark "BBB" in the source note for smart cut & paste.
        await openFile(sourceFile);
        selectRange(4, 7);
        app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
        await waitUntil({
          message: 'smart cut & paste notice did not open',
          predicate: () => findSwapButton() !== null
        });

        // Select "YYY" in the target note; the Swap button should become enabled.
        await openFile(targetFile);
        selectRange(4, 7);
        await waitUntil({
          message: 'Swap with selection button did not become enabled',
          predicate: () => {
            const button = findSwapButton();
            return button !== null && !button.disabled;
          },
          timeoutInMilliseconds: BIG_TIMEOUT_IN_MILLISECONDS
        });

        const button = findSwapButton();
        button?.click();

        await waitUntil({
          message: 'notes were not swapped',
          predicate: async () => {
            const source = await app.vault.read(sourceFile);
            const target = await app.vault.read(targetFile);
            return source.includes('YYY') && target.includes('BBB');
          },
          timeoutInMilliseconds: BIG_TIMEOUT_IN_MILLISECONDS
        });

        return {
          source: await app.vault.read(sourceFile),
          target: await app.vault.read(targetFile)
        };

        function findSwapButton(): HTMLButtonElement | null {
          return Array.from(document.querySelectorAll('button'))
            .find((el) => el.textContent === 'Swap with selection')
            ?? null;
        }

        async function openFile(fileToOpen: TFile): Promise<void> {
          await app.workspace.getLeaf(false).openFile(fileToOpen);
          await waitUntil({
            message: `editor for ${fileToOpen.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === fileToOpen.path
          });
        }

        async function resetFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          return app.vault.create(path, content);
        }

        function selectRange(startOffset: number, endOffset: number): void {
          const editor = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor;
          if (!editor) {
            throw new Error('No active editor to select in.');
          }
          editor.setSelection(editor.offsetToPos(startOffset), editor.offsetToPos(endOffset));
          activeDocument.dispatchEvent(new Event('selectionchange'));
        }
      },
      vaultPath: getTempVault().path
    });

    // "BBB" and "YYY" were exchanged across the two notes.
    expect(result.source).toContain('AAA YYY CCC');
    expect(result.target).toContain('XXX BBB ZZZ');
  });
});
