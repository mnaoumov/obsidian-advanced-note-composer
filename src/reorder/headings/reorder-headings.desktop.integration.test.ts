import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

const PLUGIN_ID = 'advanced-note-composer';

describe('reorder headings', () => {
  it('should reorder a note\'s top-level heading sections via the modal', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
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
          predicate: () => document.querySelector('.advanced-note-composer-reorder-list') !== null
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
            `.advanced-note-composer-reorder-item[data-row-label="${CSS.escape(headingText)}"] .advanced-note-composer-reorder-down`
          );
          if (!(button instanceof HTMLButtonElement)) {
            throw new TypeError(`No move-down button for "${headingText}".`);
          }
          button.click();
        }

        function clickReorder(): void {
          const button = [...document.querySelectorAll('.modal-button-container button')]
            .find((el) => el.textContent === 'Reorder');
          if (!(button instanceof HTMLButtonElement)) {
            throw new TypeError('No Reorder button.');
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
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    expect(result.canRun).toBe(true);
    expect(result.note.indexOf('# B')).toBeLessThan(result.note.indexOf('# A'));
    expect(result.note.indexOf('# A')).toBeLessThan(result.note.indexOf('# C'));
    expect(result.note).toContain('aaa');
    expect(result.note).toContain('bbb');
    expect(result.note).toContain('ccc');
  });

  it('should reorder nested sibling headings, keeping them under their parent', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const file = await resetFile('reorder-nested-headings.md', '# A\n\n## A.1\na1\n\n## A.2\na2\n\n# B\nbbb\n');
        await openFile(file);
        await waitUntil({
          message: 'heading cache not ready',
          predicate: () => (app.metadataCache.getFileCache(file)?.headings?.length ?? 0) === 4
        });

        app.commands.executeCommandById(`${pluginId}:reorder-headings`);
        await waitUntil({
          message: 'reorder modal did not open',
          predicate: () => document.querySelector('.advanced-note-composer-reorder-list') !== null
        });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        // Move nested section "A.1" down one place -> the two nested siblings swap to A.2, A.1 under A.
        moveDown('A.1');
        await sleep(RENDER_DELAY_IN_MILLISECONDS);
        clickReorder();

        await waitUntil({
          message: 'note was not reordered',
          predicate: async () => {
            const value = await app.vault.read(file);
            return value.indexOf('## A.2') < value.indexOf('## A.1');
          }
        });
        return { note: await app.vault.read(file) };

        function clickReorder(): void {
          const button = [...document.querySelectorAll('.modal-button-container button')]
            .find((el) => el.textContent === 'Reorder');
          if (!(button instanceof HTMLButtonElement)) {
            throw new TypeError('No Reorder button.');
          }
          button.click();
        }

        function moveDown(headingText: string): void {
          const button = document.querySelector(
            `.advanced-note-composer-reorder-item[data-row-label="${CSS.escape(headingText)}"] .advanced-note-composer-reorder-down`
          );
          if (!(button instanceof HTMLButtonElement)) {
            throw new TypeError(`No move-down button for "${headingText}".`);
          }
          button.click();
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
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The whole "A" section (parent + both nested children) still precedes "B".
    expect(result.note.indexOf('# A')).toBeLessThan(result.note.indexOf('## A.2'));
    expect(result.note.indexOf('## A.2')).toBeLessThan(result.note.indexOf('## A.1'));
    expect(result.note.indexOf('## A.1')).toBeLessThan(result.note.indexOf('# B'));
    expect(result.note).toContain('a1');
    expect(result.note).toContain('a2');
  });
});
