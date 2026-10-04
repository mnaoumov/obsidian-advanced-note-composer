import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

const PLUGIN_ID = 'advanced-note-composer';

describe('reorder headings: sort by name (issue #306)', () => {
  it('should sort a changelog newest first through the modal\'s sort row, carrying each version\'s content', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        // Five waits share the transport's 30 s cap, each a fast modal or one-note step.
        const WAIT_TIMEOUT_IN_MILLISECONDS = 4000;

        const file = await resetFile(
          'reorder-headings-sort.md',
          '# Changelog\n\n## 1.9.0\nnine\n\n### Fixed\nf9\n\n## 1.10.0\nten\n\n## 1.2.0\ntwo\n'
        );
        await app.workspace.getLeaf(false).openFile(file);
        await waitUntil({
          message: 'editor did not open',
          predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        await waitUntil({
          message: 'heading cache not ready',
          predicate: () => (app.metadataCache.getFileCache(file)?.headings?.length ?? 0) === 5,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        app.commands.executeCommandById(`${pluginId}:reorder-headings`);
        await waitUntil({
          message: 'sort row did not render',
          predicate: () => getRowLabels().length === 5 && document.querySelector('.advanced-note-composer-reorder-sort-scope') !== null,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        const scopeEl = document.querySelector('.advanced-note-composer-reorder-sort-scope');
        if (!(scopeEl instanceof HTMLSelectElement)) {
          throw new TypeError('No sort scope dropdown.');
        }
        const defaultScope = scopeEl.value;
        const scopes = [...scopeEl.options].map((option) => option.text);

        clickButton('.advanced-note-composer-reorder-sort-z-to-a');
        await waitUntil({
          message: 'rows were not sorted',
          predicate: () => getRowLabels()[1] === '1.10.0',
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        const sortedRows = getRowLabels();

        clickButton('.modal-button-container button.mod-cta');
        await waitUntil({
          message: 'note was not reordered',
          predicate: async () => {
            const content = await app.vault.read(file);
            return content.indexOf('## 1.10.0') < content.indexOf('## 1.9.0');
          },
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        return { defaultScope, note: await app.vault.read(file), scopes, sortedRows };

        function clickButton(selector: string): void {
          const button = document.querySelector(selector);
          if (!(button instanceof HTMLButtonElement)) {
            throw new TypeError(`No button matching ${selector}.`);
          }
          button.click();
        }

        function getRowLabels(): string[] {
          return [...document.querySelectorAll<HTMLElement>('.advanced-note-composer-reorder-item')].map((itemEl) => itemEl.dataset['rowLabel'] ?? '');
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

    // The lone title heading is skipped: the dropdown starts on the versions under it.
    expect(result.defaultScope).toBe('2');
    expect(result.scopes).toEqual(['Level 2 (##)', 'All levels']);
    expect(result.sortedRows).toEqual(['Changelog', '1.10.0', '1.9.0', 'Fixed', '1.2.0']);
    expect(result.note).toBe('# Changelog\n\n## 1.10.0\nten\n\n## 1.9.0\nnine\n\n### Fixed\nf9\n\n## 1.2.0\ntwo\n');
  });
});
