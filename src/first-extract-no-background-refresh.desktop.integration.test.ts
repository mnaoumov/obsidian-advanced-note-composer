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

describe('first extract does not refresh the background (issue #102)', () => {
  it('opens the split confirm dialog without transiently switching the active tab', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 500;

        const source = await resetFile('issue-102-source.md', 'alpha bravo charlie delta echo foxtrot\nsecond line here\nthird line here');
        const target = await resetFile('issue-102-target.md', 'target body');
        const other = await resetFile('issue-102-other.md', 'other body');

        // Open three tabs (other, target, source) with source last so it is active. Background tabs are
        // What let the regression manifest: before the fix, rendering the confirm dialog's internal links
        // Warmed obsidian-dev-utils' link handlers by briefly creating/activating/detaching a leaf, which
        // Transiently switched the active tab to a background one and back.
        await app.workspace.getLeaf('tab').openFile(other);
        await app.workspace.getLeaf('tab').openFile(target);
        const sourceEditor = await openInNewTabAndGetEditor(source);
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        sourceEditor.setSelection(sourceEditor.offsetToPos(0), sourceEditor.offsetToPos(17));
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        const activeLeafChanges: string[] = [];
        const activeBefore = app.workspace.getActiveFile()?.path ?? '';
        const eventRef = app.workspace.on('active-leaf-change', (leaf) => {
          const file = leaf?.view.getState()['file'];
          activeLeafChanges.push(typeof file === 'string' ? file : '(none)');
        });

        try {
          app.commands.executeCommandById(`${pluginId}:extract-current-selection`);
          await waitUntil({ message: 'picker did not open', predicate: () => document.querySelector('.prompt-input') !== null });
          const activeWhenPickerOpen = app.workspace.getActiveFile()?.path ?? '';

          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No picker input.');
          }
          input.value = target.basename;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: 'target suggestion did not appear',
            predicate: () => [...document.querySelectorAll('.suggestion-title')].some((el) => el.textContent.includes(target.basename))
          });

          const suggestionEl = [...document.querySelectorAll('.suggestion-item')]
            .find((el) => el.textContent.includes(target.basename));
          if (!(suggestionEl instanceof HTMLElement)) {
            throw new TypeError('No target suggestion element.');
          }
          suggestionEl.click();

          await waitUntil({
            message: 'confirm dialog did not open',
            predicate: () => document.body.textContent.includes('Are you sure you want to split')
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const activeWhenConfirmOpen = app.workspace.getActiveFile()?.path ?? '';

          // Close the confirm dialog and picker.
          await pressKey({ key: 'Escape' });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          await pressKey({ key: 'Escape' });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const backgroundTabSwitches = activeLeafChanges.filter((path) => path !== 'issue-102-source.md');

          return {
            activeBefore,
            activeWhenConfirmOpen,
            activeWhenPickerOpen,
            backgroundTabSwitches
          };
        } finally {
          app.workspace.offref(eventRef);
        }

        async function resetFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          return app.vault.create(path, content);
        }

        async function openInNewTabAndGetEditor(file: TFile): Promise<Editor> {
          await app.workspace.getLeaf('tab').openFile(file);
          await waitUntil({ predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor !== undefined });
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

    // The source note stays active the whole time: opening the picker and the confirm dialog never
    // Switches the active tab to a background note.
    expect(result.activeBefore).toBe('issue-102-source.md');
    expect(result.activeWhenPickerOpen).toBe('issue-102-source.md');
    expect(result.activeWhenConfirmOpen).toBe('issue-102-source.md');
    expect(result.backgroundTabSwitches).toEqual([]);
  });
});
