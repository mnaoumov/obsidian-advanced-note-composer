import type {
  Editor,
  TFile
} from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

const PLUGIN_ID = 'advanced-note-composer';

describe('mark heading to move', () => {
  it('should mark the whole heading section and move it into another note', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const SOURCE_PATH = 'mark-heading-to-move-source.md';
        const TARGET_PATH = 'mark-heading-to-move-target.md';
        /*
         * `MarkedB` owns a sub-heading, so the mark has to cover the whole subtree, and its siblings
         * `MarkedA` / `MarkedC` are what prove the mark is scoped to one heading section.
         */
        const SOURCE_CONTENT = [
          'Intro text',
          '',
          '## MarkedA',
          '',
          'body of MarkedA',
          '',
          '## MarkedB',
          '',
          'body of MarkedB',
          '',
          '### MarkedB1',
          '',
          'body of MarkedB1',
          '',
          '## MarkedC',
          '',
          'body of MarkedC',
          ''
        ].join('\n');
        // Inside `MarkedB`'s BODY, not on its `#` line — the enclosing heading is what the command resolves
        // (issue #143).
        const CURSOR_LINE = 8;
        const EXPECTED_HEADING_COUNT = 4;

        const sourceFile = await resetFile(SOURCE_PATH, SOURCE_CONTENT);
        const targetFile = await resetFile(TARGET_PATH, 'target intro');

        const sourceEditor = await openAndGetEditor(sourceFile);
        sourceEditor.setCursor({ ch: 0, line: CURSOR_LINE });

        await waitUntil({
          message: 'metadata cache did not index the source headings',
          predicate: () => (app.metadataCache.getFileCache(sourceFile)?.headings ?? []).length === EXPECTED_HEADING_COUNT
        });

        app.commands.executeCommandById(`${pluginId}:mark-heading-to-move`);

        await waitUntil({
          message: 'the marked-selection notice did not appear',
          predicate: () => activeDocument.querySelector('.advanced-note-composer-move-notice-buttons') !== null
        });
        const noticeButtonLabels = readNoticeButtonLabels();

        await openAndGetEditor(targetFile);
        app.commands.executeCommandById(`${pluginId}:move-marked-selection-to-bottom-of-file`);

        await waitUntil({
          message: 'the marked heading section did not land in the target note',
          predicate: async () => {
            const content = await app.vault.read(targetFile);
            return content.includes('body of MarkedB1');
          }
        });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        return {
          noticeButtonLabels,
          sourceContent: await app.vault.read(sourceFile),
          targetContent: await app.vault.read(targetFile)
        };

        function readNoticeButtonLabels(): string[] {
          const containerEl = activeDocument.querySelector('.advanced-note-composer-move-notice-buttons');
          if (!containerEl) {
            return [];
          }
          return [...containerEl.querySelectorAll('button')].map((buttonEl) => buttonEl.textContent);
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
          await waitUntil({
            message: 'markdown editor did not open',
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor !== undefined
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          return view.editor;
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The mark is a heading mark, so the notice offers the two heading-only actions as well.
    expect(result.noticeButtonLabels).toContain('Split heading recursively...');
    expect(result.noticeButtonLabels).toContain('Reorder headings...');

    // The whole section moved — the heading line, its body, and everything nested under it.
    expect(result.targetContent).toContain('## MarkedB');
    expect(result.targetContent).toContain('body of MarkedB');
    expect(result.targetContent).toContain('### MarkedB1');
    expect(result.targetContent).toContain('body of MarkedB1');

    // ...and only that section: the siblings are untouched in the source note.
    expect(result.sourceContent).toContain('## MarkedA');
    expect(result.sourceContent).toContain('body of MarkedA');
    expect(result.sourceContent).toContain('## MarkedC');
    expect(result.sourceContent).toContain('body of MarkedC');
    expect(result.sourceContent).toContain('Intro text');
    expect(result.sourceContent).not.toContain('body of MarkedB');
    expect(result.sourceContent).not.toContain('body of MarkedB1');
  });
});
