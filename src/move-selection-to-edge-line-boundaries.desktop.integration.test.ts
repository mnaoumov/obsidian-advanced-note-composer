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

import { findSettingItemInObsidian } from './settings-tab-navigation.ts';

const PLUGIN_ID = 'advanced-note-composer';

interface EdgeBoundaryProbe {
  reporterTemplateBottom: string;
  shippedDefaultBottom: string;
  shippedDefaultTop: string;
}

/**
 * Issue #179 — a marked selection moved to the top or bottom of a note used to be glued onto the note's
 * existing first / last line instead of landing on a line of its own.
 *
 * Both halves are covered, because each shows up under a DIFFERENT template and the reporter's two videos
 * showed one case each:
 *
 * - The **shipped defaults** (`smartCutAndPasteTemplate: ''` → `mergeTemplate: '\n\n{{content}}'`, a
 *   leading separator only) merged at the **top**. So this was never purely a misconfiguration.
 * - The **reporter's own** `'{{content}}\n'` is the mirror image and merged at the **bottom**.
 */
describe('a marked selection moved to an edge lands on its own line', () => {
  it('should not glue the moved block onto the adjacent line, under either template (issue #179)', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingItem, lib: { waitUntil }, obsidianModule, pluginId }): Promise<EdgeBoundaryProbe> {
        const SETTLE_IN_MILLISECONDS = 400;
        const SAVE_IN_MILLISECONDS = 300;
        const RENDER_IN_MILLISECONDS = 150;

        try {
          // Shipped defaults: every template empty, so the chain falls through to `mergeTemplate`.
          const shippedDefaultTop = await markAndMoveToEdge('anc-179-default-top', 'top');
          const shippedDefaultBottom = await markAndMoveToEdge('anc-179-default-bottom', 'bottom');

          // The reporter's configuration, which merges at the other end.
          await setTemplate('Smart cut & paste template', '{{content}}\n');
          const reporterTemplateBottom = await markAndMoveToEdge('anc-179-reporter-bottom', 'bottom');

          return { reporterTemplateBottom, shippedDefaultBottom, shippedDefaultTop };
        } finally {
          // Leave the shared instance in its default (empty-template) state.
          await setTemplate('Smart cut & paste template', '');
        }

        async function markAndMoveToEdge(baseName: string, edge: 'bottom' | 'top'): Promise<string> {
          const sourcePath = `${baseName}-source.md`;
          const targetPath = `${baseName}-target.md`;

          const source = await resetFile(sourcePath, 'keep MOVEME keep');
          const sourceEditor = await openAndGetEditor(source);
          const movemeOffset = sourceEditor.getValue().indexOf('MOVEME');
          sourceEditor.setSelection(
            sourceEditor.offsetToPos(movemeOffset),
            sourceEditor.offsetToPos(movemeOffset + 'MOVEME'.length)
          );
          app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
          await sleep(SETTLE_IN_MILLISECONDS);

          const target = await resetFile(targetPath, 'ALPHA\nOMEGA');
          await openAndGetEditor(target);
          app.commands.executeCommandById(`${pluginId}:move-marked-selection-to-${edge}-of-file`);
          await waitUntil({
            message: `the moved block did not reach the ${edge} of ${targetPath}`,
            predicate: () => editorValueFor(targetPath)?.includes('MOVEME') === true
          });
          await sleep(SETTLE_IN_MILLISECONDS);

          return editorValueFor(targetPath) ?? '';
        }

        async function setTemplate(settingName: string, value: string): Promise<void> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const settingTab = app.setting.pluginTabs.find((tab) => tab.id === pluginId);
          if (!settingTab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_IN_MILLISECONDS);

          const settingItem = await findSettingItem({ app, name: settingName, settingTab });
          const textAreaEl = settingItem?.querySelector('textarea');
          if (!(textAreaEl instanceof HTMLTextAreaElement)) {
            throw new TypeError(`"${settingName}" template input was not found.`);
          }

          textAreaEl.value = value;
          textAreaEl.dispatchEvent(new Event('input'));
          textAreaEl.dispatchEvent(new Event('change'));
          await sleep(SAVE_IN_MILLISECONDS);

          app.setting.close();
          await sleep(RENDER_IN_MILLISECONDS);
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
          await waitUntil({ predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor !== undefined });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          return view.editor;
        }

        function editorValueFor(path: string): string | undefined {
          for (const leaf of app.workspace.getLeavesOfType('markdown')) {
            const view = leaf.view;
            if (view instanceof obsidianModule.MarkdownView && view.file?.path === path) {
              return view.editor.getValue();
            }
          }
          return undefined;
        }
      },
      input: { findSettingItem: findSettingItemInObsidian, pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The defect stated directly: no line ever holds the moved block AND the line next to it. Asserting on
    // The split lines rather than on a substring is what tells a moved block on its own line apart from one
    // Glued to `ALPHA` — a `toContain('MOVEME')` passes for both.
    const notes: [string, string][] = [
      ['reporterTemplateBottom', result.reporterTemplateBottom],
      ['shippedDefaultBottom', result.shippedDefaultBottom],
      ['shippedDefaultTop', result.shippedDefaultTop]
    ];

    for (const [name, note] of notes) {
      const lines = note.split('\n');
      expect(lines, name).toContain('MOVEME');
      expect(lines.some((line) => line !== 'MOVEME' && line.includes('MOVEME')), name).toBe(false);
      // The note's own lines survive intact, so nothing was absorbed the other way either.
      expect(lines, name).toContain('ALPHA');
      expect(lines, name).toContain('OMEGA');
    }

    // And the block still landed at the requested edge.
    expect(result.shippedDefaultTop.indexOf('MOVEME')).toBeLessThan(result.shippedDefaultTop.indexOf('ALPHA'));
    expect(result.shippedDefaultBottom.indexOf('MOVEME')).toBeGreaterThan(result.shippedDefaultBottom.indexOf('OMEGA'));
    expect(result.reporterTemplateBottom.indexOf('MOVEME')).toBeGreaterThan(result.reporterTemplateBottom.indexOf('OMEGA'));
  });
});
