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
const SMART_CUT_TEMPLATE = 'Smart cut & paste template';
const SPLIT_TEMPLATE = 'Split template';
const TO_TOP_TEMPLATE = 'Smart cut & paste template (to top of file)';
const TO_BOTTOM_TEMPLATE = 'Smart cut & paste template (to bottom of file)';
const MOVE_HERE_COMMAND_ID = 'move-marked-selection-here';

describe('Smart cut & paste template', () => {
  it('uses the smart cut & paste template for a marked-selection move, falling back to the split template when empty', async () => {
    try {
      // Distinct templates so the moved content proves which one was applied.
      await setTemplate(SPLIT_TEMPLATE, 'SPLIT-TPL {{content}}');
      await setTemplate(SMART_CUT_TEMPLATE, 'SMART-TPL {{content}}');

      // A smart cut & paste move (mark → move here) must apply the smart cut & paste template.
      const withSmartTemplate = await markAndMove('anc-tpl-a', MOVE_HERE_COMMAND_ID);

      // With the smart cut & paste template emptied, the move falls back to the split template.
      await setTemplate(SMART_CUT_TEMPLATE, '');
      const withFallback = await markAndMove('anc-tpl-b', MOVE_HERE_COMMAND_ID);

      // The move applied the smart cut & paste template, not the split template.
      expect(withSmartTemplate).toContain('SMART-TPL');
      expect(withSmartTemplate).toContain('BBB');
      expect(withSmartTemplate).not.toContain('SPLIT-TPL');

      // With the smart cut & paste template empty, the same move falls back to the split template.
      expect(withFallback).toContain('SPLIT-TPL');
      expect(withFallback).toContain('BBB');
      expect(withFallback).not.toContain('SMART-TPL');
    } finally {
      // Leave the shared instance in its default (empty-template) state.
      await setTemplate(SPLIT_TEMPLATE, '');
      await setTemplate(SMART_CUT_TEMPLATE, '');
    }
  });

  it('applies each direction\'s own template, falling back to the shared one when the override is empty (issue #174)', async () => {
    try {
      // Three distinct templates, so the moved content proves WHICH one each direction picked.
      await setTemplate(SMART_CUT_TEMPLATE, 'SHARED-TPL {{content}}');
      await setTemplate(TO_TOP_TEMPLATE, 'TOP-TPL {{content}}');
      await setTemplate(TO_BOTTOM_TEMPLATE, 'BOTTOM-TPL {{content}}');

      const toTop = await markAndMove('anc-dir-top', 'move-marked-selection-to-top-of-file');
      const toBottom = await markAndMove('anc-dir-bottom', 'move-marked-selection-to-bottom-of-file');
      // The at-cursor move has no override of its own, so it must still take the shared template even
      // With both edge overrides set.
      const atCursor = await markAndMove('anc-dir-cursor', MOVE_HERE_COMMAND_ID);

      // Emptying one override sends that direction back to the shared template, leaving the other alone.
      await setTemplate(TO_TOP_TEMPLATE, '');
      const toTopFallback = await markAndMove('anc-dir-top-fallback', 'move-marked-selection-to-top-of-file');

      // Each edge move took its OWN override, not the shared template and not the other direction's.
      expect(toTop).toContain('TOP-TPL');
      expect(toTop).toContain('BBB');
      expect(toTop).not.toContain('SHARED-TPL');
      expect(toTop).not.toContain('BOTTOM-TPL');

      expect(toBottom).toContain('BOTTOM-TPL');
      expect(toBottom).toContain('BBB');
      expect(toBottom).not.toContain('SHARED-TPL');
      expect(toBottom).not.toContain('TOP-TPL');

      // The at-cursor move has no override, so the shared template stays its template.
      expect(atCursor).toContain('SHARED-TPL');
      expect(atCursor).toContain('BBB');
      expect(atCursor).not.toContain('TOP-TPL');
      expect(atCursor).not.toContain('BOTTOM-TPL');

      // With the to-top override emptied, that direction falls back to the shared template.
      expect(toTopFallback).toContain('SHARED-TPL');
      expect(toTopFallback).toContain('BBB');
      expect(toTopFallback).not.toContain('TOP-TPL');
    } finally {
      // Leave the shared instance in its default (empty-template) state.
      await setTemplate(SMART_CUT_TEMPLATE, '');
      await setTemplate(TO_TOP_TEMPLATE, '');
      await setTemplate(TO_BOTTOM_TEMPLATE, '');
    }
  });
});

/**
 * Marks a selection in a fresh source note, runs one move command into a fresh target, and reports what the
 * target ended up holding - which is where the applied template shows.
 *
 * One eval per scenario rather than a helper called three or four times inside one: the second test's
 * closure declared 67 400 ms of waiting against the transport's ~30 s per-closure cap, because a helper's
 * ceilings are charged once per CALL SITE, so the eval could only ever die as a bare `script timeout`
 * naming the harness rather than the wait that overran. Every scenario builds its own notes, so the
 * sequencing belongs in NODE, where no cap applies to it.
 * @param notePrefix - The prefix for this scenario's own source and target notes.
 * @param moveCommandId - The move command to run, without the plugin-id prefix.
 * @returns The target note's content once the moved text has arrived.
 */
async function markAndMove(notePrefix: string, moveCommandId: string): Promise<string> {
  return evalInObsidian({
    async callback({ app, baseName, commandId, lib: { waitUntil }, obsidianModule, pluginId }): Promise<string> {
      /**
       * Sized so the SUM of every wait this closure declares stays under the transport's ~30 s per-closure
       * cap, not at it. Three ceilings share it - one per `openAndGetEditor` call and the moved text
       * arriving - and each is a note opening or a template being applied to one line, both well under a
       * second. Adding an `openAndGetEditor` call adds a whole ceiling: re-divide this budget by the new
       * call count, not by the `waitUntil` calls the body shows.
       */
      const WAIT_TIMEOUT_IN_MILLISECONDS = 7000;
      const SETTLE_IN_MILLISECONDS = 400;

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
      await waitUntil({
        predicate: () => editorValueFor(`${baseName}-target.md`)?.includes('BBB') === true,
        timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
      });
      await sleep(SETTLE_IN_MILLISECONDS);

      return editorValueFor(`${baseName}-target.md`) ?? '';

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
          predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor !== undefined,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
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
    input: { baseName: notePrefix, commandId: moveCommandId, pluginId: PLUGIN_ID },
    vaultPath: getTemporaryVault().path
  });
}

/**
 * Writes one template setting through the REAL settings tab, the way a user does.
 *
 * Its own eval rather than a step inside `markAndMove`: templates are shared-instance state set BETWEEN
 * scenarios, and folding them in would charge their delays against the same per-closure cap.
 * @param templateSettingName - The template setting to write, by its displayed name.
 * @param templateValue - The template text, or the empty string to clear it.
 */
async function setTemplate(templateSettingName: string, templateValue: string): Promise<void> {
  await evalInObsidian({
    async callback({ app, findSettingItem, pluginId, settingName, value }): Promise<void> {
      const SAVE_IN_MILLISECONDS = 300;
      const RENDER_IN_MILLISECONDS = 150;

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
    },
    input: { findSettingItem: findSettingItemInObsidian, pluginId: PLUGIN_ID, settingName: templateSettingName, value: templateValue },
    vaultPath: getTemporaryVault().path
  });
}
