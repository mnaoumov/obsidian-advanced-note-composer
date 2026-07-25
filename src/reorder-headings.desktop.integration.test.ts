import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

const PLUGIN_ID = 'advanced-note-composer';

describe('reorder headings', () => {
  it('should reorder a note\'s top-level heading sections via the modal', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const file = await resetFile('reorder-headings.md', '# A\naaa\n\n# B\nbbb\n\n# C\nccc\n');
        await openFile(file);
        // The command reads headings from the metadata cache, so wait until it is populated.
        await waitUntil({
          message: 'heading cache not ready',
          predicate: () => (app.metadataCache.getFileCache(file)?.headings?.length ?? 0) === 3
        });

        const canRun = app.commands.executeCommandById(`${pluginId}:reorder-headings`);
        await waitUntil({
          message: 'reorder modal did not open',
          predicate: () => document.querySelector('.advanced-note-composer-reorder-headings-list') !== null
        });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        // Move section "A" down one place -> order becomes B, A, C.
        moveDown('A');
        await sleep(RENDER_DELAY_IN_MILLISECONDS);
        clickReorder();

        await waitUntil({
          message: 'note was not reordered',
          predicate: async () => {
            const value = await app.vault.read(file);
            return value.indexOf('# B') < value.indexOf('# A');
          }
        });
        const note = await app.vault.read(file);
        return { canRun, note };

        function moveDown(headingText: string): void {
          const button = document.querySelector(
            `.advanced-note-composer-reorder-headings-item[data-heading-text="${headingText}"] .advanced-note-composer-reorder-headings-down`
          );
          if (!(button instanceof HTMLButtonElement)) {
            throw new Error(`No move-down button for "${headingText}".`);
          }
          button.click();
        }

        function clickReorder(): void {
          const button = Array.from(document.querySelectorAll('.modal-button-container button'))
            .find((el) => el.textContent === 'Reorder');
          if (!(button instanceof HTMLButtonElement)) {
            throw new Error('No Reorder button.');
          }
          button.click();
        }

        async function resetFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          return app.vault.create(path, content);
        }

        async function openFile(fileToOpen: TFile): Promise<void> {
          await app.workspace.getLeaf(false).openFile(fileToOpen);
          await waitUntil({
            message: `editor for ${fileToOpen.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === fileToOpen.path
          });
        }
      },
      vaultPath: getTempVault().path
    });

    expect(result.canRun).toBe(true);
    expect(result.note.indexOf('# B')).toBeLessThan(result.note.indexOf('# A'));
    expect(result.note.indexOf('# A')).toBeLessThan(result.note.indexOf('# C'));
    expect(result.note).toContain('aaa');
    expect(result.note).toContain('bbb');
    expect(result.note).toContain('ccc');
  });
});
