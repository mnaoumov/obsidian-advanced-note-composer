import type {
  Editor,
  TFile
} from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

const PLUGIN_ID = 'advanced-note-composer';

describe('swap selections', () => {
  it('should swap two selections across notes and within a single note', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        // --- Cross-note swap: "alpha" in A <-> "one" in B. ---
        const fileA = await resetFile('swap-a.md', 'AAA alpha BBB');
        const fileB = await resetFile('swap-b.md', 'CCC one DDD');

        const editorA = await openAndGetEditor(fileA);
        editorA.setSelection(editorA.offsetToPos(4), editorA.offsetToPos(9));
        app.commands.executeCommandById(`${pluginId}:mark-selection-to-swap`);

        const editorB = await openAndGetEditor(fileB);
        editorB.setSelection(editorB.offsetToPos(4), editorB.offsetToPos(7));
        app.commands.executeCommandById(`${pluginId}:swap-with-marked-selection`);

        await waitUntil({
          message: 'cross-note swap did not complete',
          predicate: async () => (await app.vault.read(fileA)) === 'AAA one BBB' && (await app.vault.read(fileB)) === 'CCC alpha DDD'
        });
        const crossNoteA = await app.vault.read(fileA);
        const crossNoteB = await app.vault.read(fileB);

        // --- Same-note swap: "one" <-> "three" in C. ---
        const fileC = await resetFile('swap-c.md', 'one and three');
        const editorC = await openAndGetEditor(fileC);
        editorC.setSelection(editorC.offsetToPos(0), editorC.offsetToPos(3));
        app.commands.executeCommandById(`${pluginId}:mark-selection-to-swap`);
        editorC.setSelection(editorC.offsetToPos(8), editorC.offsetToPos(13));
        app.commands.executeCommandById(`${pluginId}:swap-with-marked-selection`);

        await waitUntil({
          message: 'same-note swap did not complete',
          predicate: async () => (await app.vault.read(fileC)) === 'three and one'
        });
        const sameNoteC = await app.vault.read(fileC);

        return { crossNoteA, crossNoteB, sameNoteC };

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
            message: `editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          return view.editor;
        }
      },
      vaultPath: getTempVault().path
    });

    expect(result.crossNoteA).toBe('AAA one BBB');
    expect(result.crossNoteB).toBe('CCC alpha DDD');
    expect(result.sameNoteC).toBe('three and one');
  });
});
