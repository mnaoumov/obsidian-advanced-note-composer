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

import type { PluginSettingsTab } from './plugin-settings-tab.ts';

const PLUGIN_ID = 'advanced-note-composer';

describe('Smart cut & paste template', () => {
  it('uses the smart cut & paste template for a marked-selection move, falling back to the split template when empty', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const SETTLE_IN_MILLISECONDS = 400;
        const SAVE_IN_MILLISECONDS = 300;
        const RENDER_IN_MILLISECONDS = 150;

        try {
          // Distinct templates so the moved content proves which one was applied.
          await setTemplate('Split template', 'SPLIT-TPL {{content}}');
          await setTemplate('Smart cut & paste template', 'SMART-TPL {{content}}');

          // A smart cut & paste move (mark → move here) must apply the smart cut & paste template.
          const withSmartTemplate = await markAndMove('anc-tpl-a');

          // With the smart cut & paste template emptied, the move falls back to the split template.
          await setTemplate('Smart cut & paste template', '');
          const withFallback = await markAndMove('anc-tpl-b');

          return { withFallback, withSmartTemplate };
        } finally {
          // Leave the shared instance in its default (empty-template) state.
          await setTemplate('Split template', '');
          await setTemplate('Smart cut & paste template', '');
        }

        async function markAndMove(baseName: string): Promise<string> {
          const source = await resetFile(`${baseName}-source.md`, 'AAA BBB CCC');
          await resetFile(`${baseName}-target.md`, 'target end');

          const sourceEditor = await openAndGetEditor(source);
          sourceEditor.setSelection(sourceEditor.offsetToPos(4), sourceEditor.offsetToPos(7));
          app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
          await sleep(SETTLE_IN_MILLISECONDS);

          const target = await resetFile(`${baseName}-target.md`, 'target end');
          const targetEditor = await openAndGetEditor(target);
          targetEditor.setCursor(targetEditor.offsetToPos(7));
          app.commands.executeCommandById(`${pluginId}:move-marked-selection-here`);
          await waitUntil({ predicate: () => editorValueFor(`${baseName}-target.md`)?.includes('BBB') === true });
          await sleep(SETTLE_IN_MILLISECONDS);

          return editorValueFor(`${baseName}-target.md`) ?? '';
        }

        async function setTemplate(settingName: string, value: string): Promise<void> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const settingTab = app.setting.pluginTabs.find((tab) => tab.id === pluginId);
          if (!settingTab) {
            throw new Error('Settings tab was not found.');
          }
          (settingTab as PluginSettingsTab).displayLegacy();
          await sleep(RENDER_IN_MILLISECONDS);

          const settingItems = Array.from(settingTab.containerEl.querySelectorAll('.setting-item'));
          const settingItem = settingItems.find((el) => el.querySelector('.setting-item-name')?.textContent === settingName);
          const textAreaEl = settingItem?.querySelector('textarea');
          if (!(textAreaEl instanceof HTMLTextAreaElement)) {
            throw new Error(`"${settingName}" template input was not found.`);
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
      vaultPath: getTempVault().path
    });

    // The move applied the smart cut & paste template, not the split template.
    expect(result.withSmartTemplate).toContain('SMART-TPL');
    expect(result.withSmartTemplate).toContain('BBB');
    expect(result.withSmartTemplate).not.toContain('SPLIT-TPL');

    // With the smart cut & paste template empty, the same move falls back to the split template.
    expect(result.withFallback).toContain('SPLIT-TPL');
    expect(result.withFallback).toContain('BBB');
    expect(result.withFallback).not.toContain('SMART-TPL');
  });

  it('applies each direction\'s own template, falling back to the shared one when the override is empty (issue #174)', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const SETTLE_IN_MILLISECONDS = 400;
        const SAVE_IN_MILLISECONDS = 300;
        const RENDER_IN_MILLISECONDS = 150;

        try {
          // Three distinct templates, so the moved content proves WHICH one each direction picked.
          await setTemplate('Smart cut & paste template', 'SHARED-TPL {{content}}');
          await setTemplate('Smart cut & paste template (to top of file)', 'TOP-TPL {{content}}');
          await setTemplate('Smart cut & paste template (to bottom of file)', 'BOTTOM-TPL {{content}}');

          const toTop = await markAndMove('anc-dir-top', 'move-marked-selection-to-top-of-file');
          const toBottom = await markAndMove('anc-dir-bottom', 'move-marked-selection-to-bottom-of-file');
          // The at-cursor move has no override of its own, so it must still take the shared template even
          // With both edge overrides set.
          const atCursor = await markAndMove('anc-dir-cursor', 'move-marked-selection-here');

          // Emptying one override sends that direction back to the shared template, leaving the other alone.
          await setTemplate('Smart cut & paste template (to top of file)', '');
          const toTopFallback = await markAndMove('anc-dir-top-fallback', 'move-marked-selection-to-top-of-file');

          return { atCursor, toBottom, toTop, toTopFallback };
        } finally {
          // Leave the shared instance in its default (empty-template) state.
          await setTemplate('Smart cut & paste template', '');
          await setTemplate('Smart cut & paste template (to top of file)', '');
          await setTemplate('Smart cut & paste template (to bottom of file)', '');
        }

        async function markAndMove(baseName: string, commandId: string): Promise<string> {
          const source = await resetFile(`${baseName}-source.md`, 'AAA BBB CCC');
          await resetFile(`${baseName}-target.md`, 'target end');

          const sourceEditor = await openAndGetEditor(source);
          sourceEditor.setSelection(sourceEditor.offsetToPos(4), sourceEditor.offsetToPos(7));
          app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
          await sleep(SETTLE_IN_MILLISECONDS);

          const target = await resetFile(`${baseName}-target.md`, 'target end');
          const targetEditor = await openAndGetEditor(target);
          targetEditor.setCursor(targetEditor.offsetToPos(7));
          app.commands.executeCommandById(`${pluginId}:${commandId}`);
          await waitUntil({ predicate: () => editorValueFor(`${baseName}-target.md`)?.includes('BBB') === true });
          await sleep(SETTLE_IN_MILLISECONDS);

          return editorValueFor(`${baseName}-target.md`) ?? '';
        }

        async function setTemplate(settingName: string, value: string): Promise<void> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const settingTab = app.setting.pluginTabs.find((tab) => tab.id === pluginId);
          if (!settingTab) {
            throw new Error('Settings tab was not found.');
          }
          (settingTab as PluginSettingsTab).displayLegacy();
          await sleep(RENDER_IN_MILLISECONDS);

          const settingItems = Array.from(settingTab.containerEl.querySelectorAll('.setting-item'));
          const settingItem = settingItems.find((el) => el.querySelector('.setting-item-name')?.textContent === settingName);
          const textAreaEl = settingItem?.querySelector('textarea');
          if (!(textAreaEl instanceof HTMLTextAreaElement)) {
            throw new Error(`"${settingName}" template input was not found.`);
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
      vaultPath: getTempVault().path
    });

    // Each edge move took its OWN override, not the shared template and not the other direction's.
    expect(result.toTop).toContain('TOP-TPL');
    expect(result.toTop).toContain('BBB');
    expect(result.toTop).not.toContain('SHARED-TPL');
    expect(result.toTop).not.toContain('BOTTOM-TPL');

    expect(result.toBottom).toContain('BOTTOM-TPL');
    expect(result.toBottom).toContain('BBB');
    expect(result.toBottom).not.toContain('SHARED-TPL');
    expect(result.toBottom).not.toContain('TOP-TPL');

    // The at-cursor move has no override, so the shared template stays its template.
    expect(result.atCursor).toContain('SHARED-TPL');
    expect(result.atCursor).toContain('BBB');
    expect(result.atCursor).not.toContain('TOP-TPL');
    expect(result.atCursor).not.toContain('BOTTOM-TPL');

    // With the to-top override emptied, that direction falls back to the shared template.
    expect(result.toTopFallback).toContain('SHARED-TPL');
    expect(result.toTopFallback).toContain('BBB');
    expect(result.toTopFallback).not.toContain('TOP-TPL');
  });
});
