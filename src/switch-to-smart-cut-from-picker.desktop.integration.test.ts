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

describe('switch to smart cut from the split/extract picker', () => {
  it('marks the selection and stays on the source note without switching to the highlighted suggestion', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const source = await resetFile('picker-switch-source.md', 'alpha bravo charlie');
        // A distinctly-named target so it becomes the picker's highlighted suggestion once typed. Under
        // The pre-fix behavior, switching to smart cut from the picker opened this merely-highlighted
        // Suggestion, switching the active note away from the source (issue #141).
        const target = await resetFile('picker-switch-target.md', 'target body');

        // Open the source, select "bravo", and mark it for a smart cut & paste move.
        const editor = await openAndGetEditor(source);
        editor.setSelection(editor.offsetToPos(6), editor.offsetToPos(11));
        app.commands.executeCommandById(`${pluginId}:mark-selection-to-move`);
        await waitUntil({ predicate: () => findMarkNotice() !== null });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        // Switch to the split/extract picker (the notice's "Switch to split/extract" action).
        app.commands.executeCommandById(`${pluginId}:open-split-modal`);
        await waitUntil({ predicate: () => document.querySelector('.prompt') !== null });
        await waitUntil({ predicate: () => app.workspace.getActiveFile()?.path === 'picker-switch-source.md' });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        // Type the target's basename so it is the highlighted suggestion — but never choose it (no Enter).
        const input = document.querySelector('.prompt-input');
        if (!(input instanceof HTMLInputElement)) {
          throw new Error('No split picker input.');
        }
        input.value = target.basename;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await waitUntil({ predicate: () => Array.from(document.querySelectorAll('.suggestion-title')).some((el) => el.textContent.includes(target.basename)) });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        // Click the picker's "Switch to smart cut & paste" button.
        const switchButton = findPickerSwitchButton();
        const switchButtonPresent = switchButton !== null;
        switchButton?.click();

        // The mark is re-established (permanent notice) and the picker closes — but the active note must
        // Stay on the source, NOT switch to the merely-highlighted target.
        await waitUntil({ predicate: () => document.querySelector('.prompt') === null });
        await waitUntil({ predicate: () => findMarkNotice() !== null });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        const activePath = app.workspace.getActiveFile()?.path ?? '';
        const markNoticeShown = findMarkNotice() !== null;
        const sourceContent = await app.vault.read(source);
        const targetContent = await app.vault.read(target);

        // Clean up: release the mark so the source note is unlocked.
        app.commands.executeCommandById(`${pluginId}:cancel-move`);
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        return { activePath, markNoticeShown, sourceContent, switchButtonPresent, targetContent };

        function findPickerSwitchButton(): HTMLButtonElement | null {
          for (const el of Array.from(document.querySelectorAll('.advanced-note-composer-switch-to-smart-cut button'))) {
            if (el.instanceOf(HTMLButtonElement) && el.textContent === 'Switch to smart cut & paste') {
              return el;
            }
          }
          return null;
        }

        function findMarkNotice(): Element | null {
          for (const el of Array.from(activeDocument.querySelectorAll('.notice'))) {
            if (el.textContent.includes('Smart cut & paste')) {
              return el;
            }
          }
          return null;
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
      },
      vaultPath: getTempVault().path
    });

    // The picker offered the switch button; clicking it re-established the mark (permanent notice)...
    expect(result.switchButtonPresent).toBe(true);
    expect(result.markNoticeShown).toBe(true);
    // ...and kept the source note active instead of opening the merely-highlighted target (issue #141).
    expect(result.activePath).toBe('picker-switch-source.md');
    // ...without moving any content: both notes are untouched.
    expect(result.sourceContent).toContain('bravo');
    expect(result.targetContent).toBe('target body');
  });
});
