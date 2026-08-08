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

// Desktop-only: `Extract this heading...` is a cross-platform editor command, but this plugin's
// Behavioral integration suites all run desktop-only (there is no Android emulator wired for this
// Feature and the plugin follows the established desktop-only integration convention). The command
// Itself is platform-agnostic, so the desktop run exercises the real logic on every platform.
const PLUGIN_ID = 'advanced-note-composer';

describe('extract this heading from the body (issue #143)', () => {
  it('extracts the whole heading section when the cursor sits in the heading BODY, not on the # line', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const TARGET_BASENAME = 'extracted-section';

        const isOriginalShouldAsk = await didSetAskBeforeSplitting(false);
        try {
          // A note with two same-level sections. The cursor will be placed on a BODY line of the
          // Second section (never on its `## Extract me` heading line) to prove issue #143's fix.
          const sourceFile = await resetFile(
            'extract-heading-body.md',
            '# Note\n\n## Keep me\nkeep body\n\n## Extract me\nextract body one\nextract body two\n'
          );
          await deleteIfExists(`${TARGET_BASENAME}.md`);

          const editor = await openAndGetEditor(sourceFile);
          await waitUntil({
            message: 'heading cache not ready',
            predicate: () => (app.metadataCache.getFileCache(sourceFile)?.headings?.length ?? 0) === 3
          });

          // Line 6 (0-based) is `extract body one` — inside the section BODY, not the heading line.
          editor.setCursor({ ch: 3, line: 6 });
          const cursorLineText = editor.getLine(editor.getCursor().line);

          app.commands.executeCommandById(`${pluginId}:extract-this-heading`);
          await waitUntil({
            message: 'split picker did not open',
            predicate: () => document.querySelector('.prompt') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // Type a brand-new target name and confirm (Enter) to extract the section into a new note.
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No split picker input.');
          }
          input.value = TARGET_BASENAME;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: 'create-new suggestion did not appear',
            predicate: () => [...document.querySelectorAll('.suggestion-title')].some((el) => el.textContent.includes(TARGET_BASENAME))
          });
          input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Enter', key: 'Enter' }));

          await waitUntil({
            message: 'extracted note was not created',
            predicate: () => app.vault.getAbstractFileByPath(`${TARGET_BASENAME}.md`) !== null
          });
          // The source-note edit (section removed, link left in its place) lives in the editor buffer
          // First (the on-disk save is debounced), so wait on and read the live buffer, not `vault.read`.
          await waitUntil({
            message: 'source section was not extracted out of the source note',
            predicate: () => !editor.getValue().includes('extract body one')
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const extractedFile = app.vault.getAbstractFileByPath(`${TARGET_BASENAME}.md`);
          const extractedContent = extractedFile instanceof obsidianModule.TFile ? await app.vault.read(extractedFile) : '';
          const sourceContent = editor.getValue();

          return { cursorLineText, extractedContent, sourceContent };
        } finally {
          await didSetAskBeforeSplitting(isOriginalShouldAsk);
        }

        async function deleteIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }

        async function didSetAskBeforeSplitting(shouldAsk: boolean): Promise<boolean> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const item = [...tab.containerEl.querySelectorAll('.setting-item')]
            .find((el) => el.querySelector('.setting-item-name')?.textContent === 'Should ask before splitting');
          const toggle = item?.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new TypeError('"Should ask before splitting" toggle was not found.');
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
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The cursor really was on a body line, not the heading line.
    expect(result.cursorLineText).toBe('extract body one');

    // The extracted note holds the whole "Extract me" section (heading + its body), extracted from the body.
    expect(result.extractedContent).toContain('extract body one');
    expect(result.extractedContent).toContain('extract body two');

    // The untouched sibling section stayed behind in the source note.
    expect(result.sourceContent).toContain('## Keep me');
    expect(result.sourceContent).toContain('keep body');

    // The extracted section's body no longer lives in the source note (it moved out).
    expect(result.sourceContent).not.toContain('extract body one');
  });
});
