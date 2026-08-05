import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

const PLUGIN_ID = 'advanced-note-composer';

describe('rename heading', () => {
  it('should rewrite single-segment AND nested backlinks when a heading is renamed', async () => {
    const result = await evalInObsidian({
      // eslint-disable-next-line unicorn/name-replacements -- `args` is an `obsidian-integration-testing` parameter name.
      args: { pluginId: PLUGIN_ID },
      // eslint-disable-next-line unicorn/name-replacements -- `fn` is an `obsidian-integration-testing` parameter name.
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const target = await resetFile('rename-target.md', '# Parent\n\nparent text\n\n## Child\n\nchild text\n');
        const note = await resetFile(
          'rename-note.md',
          'Nested [[rename-target#Parent#Child]] and single [[rename-target#Parent]].\n'
        );

        await openFile(target);
        await waitUntil({
          message: 'target heading cache not ready',
          predicate: () => (app.metadataCache.getFileCache(target)?.headings?.length ?? 0) === 2
        });
        await waitUntil({
          message: 'note link cache not ready',
          predicate: () => (app.metadataCache.getFileCache(note)?.links?.length ?? 0) === 2
        });

        const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
        if (!view) {
          throw new Error('No active markdown view.');
        }
        // Put the cursor on the `# Parent` heading line so the command targets it.
        view.editor.setCursor({ ch: 0, line: 0 });

        const canRun = app.commands.executeCommandById(`${pluginId}:rename-heading`);

        await waitUntil({
          message: 'rename prompt did not open',
          predicate: () => document.querySelector('.prompt-modal input.text-box') !== null
        });

        const inputEl = document.querySelector('.prompt-modal input.text-box');
        if (!(inputEl instanceof HTMLInputElement)) {
          throw new TypeError('No prompt input.');
        }
        inputEl.value = 'New';
        inputEl.dispatchEvent(new Event('input'));

        const okButton = document.querySelector('.prompt-modal .ok-button');
        if (!(okButton instanceof HTMLElement)) {
          throw new TypeError('No OK button.');
        }
        okButton.click();

        await waitUntil({
          message: 'nested backlink was not rewritten',
          predicate: async () => {
            const content = await app.vault.read(note);
            return content.includes('[[rename-target#New#Child]]');
          }
        });

        return {
          canRun,
          noteContent: await app.vault.read(note),
          targetContent: await app.vault.read(target)
        };

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
      vaultPath: getTempVault().path
    });

    expect(result.canRun).toBe(true);
    // The renamed heading is applied in the source note.
    expect(result.targetContent).toContain('# New');
    expect(result.targetContent).not.toContain('# Parent');
    // Both the nested (middle-segment) and single-segment backlinks are rewritten.
    expect(result.noteContent).toContain('[[rename-target#New#Child]]');
    expect(result.noteContent).toContain('[[rename-target#New]]');
    expect(result.noteContent).not.toContain('#Parent');
  });
});
