import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

const PLUGIN_ID = 'advanced-note-composer';

interface CopyState {
  copied: null | string;
}

/*
 * Issue #308: the reporter wanted the note-level sibling of `Copy link to this heading`, a link to the note
 * being edited, to paste into a section that is split out later.
 */
describe('copy link to this file (issue #308)', () => {
  it('should copy a link to the note being edited', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
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

        // The hidden test window is never focused, and the real clipboard refuses an unfocused document, so
        // the write is captured instead of performed.
        const clipboard = activeWindow.navigator.clipboard;
        const originalWriteText = clipboard.writeText.bind(clipboard);
        const state: CopyState = { copied: null };
        clipboard.writeText = (text: string): Promise<void> => {
          state.copied = text;
          return new Promise<void>((resolve) => {
            resolve();
          });
        };
        try {
          app.commands.executeCommandById(`${pluginId}:copy-link-to-this-file`);
          await waitUntil({
            message: 'nothing was copied',
            predicate: () => state.copied !== null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
        } finally {
          clipboard.writeText = originalWriteText;
        }

        const linkText = /^\[\[(?<linkText>[^\]|#]+)/u.exec(state.copied ?? '')?.groups?.['linkText'] ?? '';
        return {
          copied: state.copied,
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
