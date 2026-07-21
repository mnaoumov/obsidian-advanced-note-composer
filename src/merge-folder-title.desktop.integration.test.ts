import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsTab } from './plugin-settings-tab.ts';

const PLUGIN_ID = 'advanced-note-composer';

describe('merge folder preserves a child note title (issue #114)', () => {
  it('keeps the title frontmatter of a moved child note merged into a folder with no colliding note', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const originalShouldAsk = await setAskBeforeMerging(true);
        try {
          // Source folder holds a child note carrying a `title`; the target folder exists but has no
          // Note of the same name, so the merge creates a brand-new target file (isNewTargetFile === true).
          const sourceNote = await resetFile('mt-src/note.md', '---\ntitle: Child Title\n---\nchild body');
          await resetFile('mt-dst/other.md', 'other body');
          // Guarantee the target has no colliding note (a prior run's merge could have left one behind).
          await deleteIfExists('mt-dst/note.md');

          // Open the note so its parent folder ("mt-src") becomes the merge source.
          await app.workspace.getLeaf(false).openFile(sourceNote);
          await waitUntil({ predicate: () => app.workspace.getActiveFile()?.path === 'mt-src/note.md' });
          app.commands.executeCommandById(`${pluginId}:merge-folder`);
          await waitUntil({ predicate: () => document.querySelector('.prompt') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // Choose the target folder, then confirm the merge.
          await chooseFolderInPicker('mt-dst');
          await waitUntil({ predicate: () => findButton('Merge') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          findButton('Merge')?.click();

          // The merge completes: the source folder is deleted and the child note lands in the target.
          await waitUntil({ predicate: () => app.vault.getAbstractFileByPath('mt-dst/note.md') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const movedFile = app.vault.getAbstractFileByPath('mt-dst/note.md');
          const movedContent = movedFile instanceof obsidianModule.TFile ? await app.vault.read(movedFile) : '';
          const sourceFolderExists = app.vault.getAbstractFileByPath('mt-src') !== null;
          const targetSiblingIntact = app.vault.getAbstractFileByPath('mt-dst/other.md') !== null;

          return { movedContent, sourceFolderExists, targetSiblingIntact };
        } finally {
          await setAskBeforeMerging(originalShouldAsk);
        }

        function findButton(text: string): HTMLButtonElement | null {
          for (const el of Array.from(document.querySelectorAll('.modal-button-container button'))) {
            if (el.instanceOf(HTMLButtonElement) && el.textContent === text) {
              return el;
            }
          }
          return null;
        }

        async function chooseFolderInPicker(folderPath: string): Promise<void> {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new Error('No merge-folder picker input.');
          }
          input.value = folderPath;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({ predicate: () => Array.from(document.querySelectorAll('.suggestion-item')).some((el) => el.textContent.includes(folderPath)) });
          input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Enter', key: 'Enter' }));
        }

        async function deleteIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.fileManager.trashFile(existing);
          }
        }

        async function setAskBeforeMerging(shouldAsk: boolean): Promise<boolean> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          (tab as PluginSettingsTab).displayLegacy();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const item = Array.from(tab.containerEl.querySelectorAll('.setting-item'))
            .find((el) => el.querySelector('.setting-item-name')?.textContent === 'Should ask before merging');
          const toggle = item?.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new Error('"Should ask before merging" toggle was not found.');
          }
          const wasEnabled = toggle.classList.contains('is-enabled');
          if (wasEnabled !== shouldAsk) {
            toggle.click();
            await sleep(RENDER_DELAY_IN_MILLISECONDS);
          }
          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return wasEnabled;
        }

        async function resetFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          const parentPath = path.slice(0, path.lastIndexOf('/'));
          if (parentPath && app.vault.getAbstractFileByPath(parentPath) === null) {
            await app.vault.createFolder(parentPath);
          }
          return app.vault.create(path, content);
        }
      },
      vaultPath: getTempVault().path
    });

    // The source folder was consumed by the merge.
    expect(result.sourceFolderExists).toBe(false);
    // The moved child note kept its `title` frontmatter (the issue-#114 regression) and its body.
    expect(result.movedContent).toContain('title: Child Title');
    expect(result.movedContent).toContain('child body');
    // The pre-existing sibling in the target folder was untouched.
    expect(result.targetSiblingIntact).toBe(true);
  });
});
