import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

const PLUGIN_ID = 'advanced-note-composer';

/*
 * Issue #308: the reporter wanted the note-level sibling of `Copy link to this heading`, a link to the note
 * being edited, to paste into a section that is split out later.
 */
describe('copy link to this file (issue #308)', () => {
  it('should copy a link to the note being edited', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { useInMemoryClipboard, waitUntil }, obsidianModule, pluginId }) {
        // Two waits at the ceiling below.
        const WAIT_TIMEOUT_IN_MILLISECONDS = 5000;
        await app.vault.createFolder('copy-file-folder');
        const sourceFile = await app.vault.create('copy-file-folder/copy-file-source.md', ['# CfA', '', 'body', ''].join('\n'));
        await app.workspace.getLeaf(false).openFile(sourceFile);
        await waitUntil({
          message: 'the source note did not open',
          predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file === sourceFile,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        // The hidden test window is never focused, so the real clipboard refuses it, and the real clipboard
        // belongs to whoever uses the machine: the copy goes to a clipboard held in memory instead.
        const clipboard = useInMemoryClipboard();
        let copied: string;
        try {
          app.commands.executeCommandById(`${pluginId}:copy-link-to-this-file`);
          await waitUntil({
            message: 'nothing was copied',
            predicate: () => clipboard.writtenTexts.length > 0,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          copied = clipboard.text;
        } finally {
          clipboard.restore();
        }

        const linkText = /^\[\[(?<linkText>[^\]|#]+)/u.exec(copied)?.groups?.['linkText'] ?? '';
        return {
          copied,
          resolvedPath: app.metadataCache.getFirstLinkpathDest(linkText, '')?.path ?? null
        };
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // Obsidian's own link, under the vault's link settings, naming the note itself rather than an empty
    // same-note `[[]]`.
    expect(result.copied).toBe('[[copy-file-source]]');
    expect(result.resolvedPath).toBe('copy-file-folder/copy-file-source.md');
  });
});
