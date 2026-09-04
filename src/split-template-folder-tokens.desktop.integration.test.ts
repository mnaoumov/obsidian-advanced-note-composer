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

/**
 * Issue #227: the `Create folder with notes...` folder tokens resolve in `Split template` too, naming the
 * folder the note ends up in — which with `Split into folder` on is the folder the split just created.
 *
 * Driven against real Obsidian rather than only unit-tested, because the thing under test is the token's
 * value at the moment the composer templates the note, and that moment sits after the item selector has
 * created the folder and renamed the note into it. A unit test can assert the resolver; only the real flow
 * can show the two agree.
 */
describe('split template folder tokens (issue #227)', () => {
  it('should resolve the folder tokens against the folder the split created, numbered or not', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingItem, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const SETTLE_IN_MILLISECONDS = 400;
        const SAVE_IN_MILLISECONDS = 300;
        const RENDER_IN_MILLISECONDS = 150;

        // Every folder token at once, each labelled, so one produced note proves all of them — and the
        // Index is bracketed so "no number" is distinguishable from "the number 0".
        const TEMPLATE = 'NAME:{{folderName}}|PATH:{{folderPath}}|SAFE:{{safeFolderName}}|IDX:[{{index}}]|PARENT:{{parentFolder}}\n\n{{content}}';

        const isOriginalShouldAsk = await didSetToggle('Should ask before splitting', false);
        const isOriginalShouldSplitIntoFolder = await didSetToggle('Should split into folder', true);
        try {
          await setTemplate('Split template', TEMPLATE);

          // A name the default `Reordered folder name template` recognizes as numbered, and one it does not.
          const numbered = await extractInto('1. Alpha 227', 'numbered');
          const unnumbered = await extractInto('Beta 227', 'unnumbered');

          return { numbered, unnumbered };
        } finally {
          await setTemplate('Split template', '');
          await didSetToggle('Should ask before splitting', isOriginalShouldAsk);
          await didSetToggle('Should split into folder', isOriginalShouldSplitIntoFolder);
        }

        /**
         * Extracts a fragment into a brand-new note of that name and returns what landed in it.
         *
         * @param newNoteName - The name typed into the split picker, which is also the folder's name.
         * @returns The produced note's content.
         */
        async function extractInto(newNoteName: string, sourceKey: string): Promise<string> {
          const notePath = `${newNoteName}/${newNoteName}.md`;
          // The source note's own name must NOT contain the typed text: it would fuzzy-match it in the
          // Picker and take the active suggestion, so Enter would extract into the source note instead of
          // Creating anything.
          const sourcePath = `anc-227-source-${sourceKey}.md`;

          // Leftovers from a previous run would make the folder name de-duplicate to `… 1`, which is a
          // Different name from the one the assertions expect.
          await removeIfExists(notePath);
          await removeIfExists(newNoteName);

          const sourceFile = await resetFile(sourcePath, 'keep this fragment here');
          const editor = await openAndGetEditor(sourceFile);
          // Select "fragment".
          editor.setSelection(editor.offsetToPos(10), editor.offsetToPos(18));
          app.commands.executeCommandById(`${pluginId}:extract-current-selection`);
          await waitUntil({ message: 'split picker did not open', predicate: () => document.querySelector('.prompt') !== null });
          await sleep(SETTLE_IN_MILLISECONDS);

          const inputEl = document.querySelector('.prompt-input');
          if (!(inputEl instanceof HTMLInputElement)) {
            throw new TypeError('No split picker input.');
          }
          inputEl.value = newNoteName;
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(SETTLE_IN_MILLISECONDS);
          /*
           * This used to wait for the `Enter to create` row and, on giving up, name what the picker had
           * offered instead — because a suggestion that fuzzy-matched the typed text is what plain `Enter`
           * would have extracted into. `Mod+Enter` removes the hazard rather than diagnosing it: it creates
           * from the typed name whatever the list holds, so nothing here depends on the shared vault's
           * contents any more ([[T880-P12]]).
           */
          inputEl.focus();
          await pressKey({ key: 'Enter', modifiers: ['Mod'] });

          await waitUntil({
            message: `extracted note was not created at ${notePath}`,
            predicate: () => app.vault.getAbstractFileByPath(notePath) instanceof obsidianModule.TFile
          });
          // The note is created before it is templated, so its existence is not the thing to wait for —
          // The template's own text landing in it is.
          await waitUntil({
            message: `split template was not applied to ${notePath}`,
            predicate: async () => {
              const content = await readIfExists(notePath);
              return content.includes('NAME:');
            }
          });

          return await readIfExists(notePath);
        }

        async function readIfExists(path: string): Promise<string> {
          const file = app.vault.getAbstractFileByPath(path);
          return file instanceof obsidianModule.TFile ? await app.vault.read(file) : '';
        }

        async function removeIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
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
          await waitUntil({ message: 'markdown editor did not open', predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor !== undefined });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          return view.editor;
        }

        async function setTemplate(settingName: string, value: string): Promise<void> {
          const settingItem = await openSettingItem(settingName);
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

        async function didSetToggle(name: string, shouldEnable: boolean): Promise<boolean> {
          const item = await openSettingItem(name);
          const toggle = item?.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new TypeError(`"${name}" toggle was not found.`);
          }
          const wasEnabled = toggle.classList.contains('is-enabled');
          if (wasEnabled !== shouldEnable) {
            toggle.click();
            await sleep(RENDER_IN_MILLISECONDS);
          }
          app.setting.close();
          await sleep(RENDER_IN_MILLISECONDS);
          return wasEnabled;
        }

        /**
         * Opens the plugin's settings tab and finds one row in it. A row inside a settings PAGE is not in
         * the DOM until that page is opened, which is what `findSettingItem` navigates.
         *
         * @param name - The row's name.
         * @returns The row element, or `null` when it was not found.
         */
        async function openSettingItem(name: string): Promise<HTMLElement | null> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const settingTab = app.setting.pluginTabs.find((tab) => tab.id === pluginId);
          if (!settingTab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_IN_MILLISECONDS);
          return await findSettingItem({ app, name, settingTab });
        }
      },
      input: { findSettingItem: findSettingItemInObsidian, pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The folder tokens name the folder the split created, NOT the folder it was created in.
    expect(result.numbered).toContain('NAME:1. Alpha 227');
    expect(result.numbered).toContain('PATH:1. Alpha 227');
    // Read back through `Reordered folder name template`: the number is `{{index}}`, the rest is
    // `{{safeFolderName}}`.
    expect(result.numbered).toContain('SAFE:Alpha 227');
    expect(result.numbered).toContain('IDX:[1]');
    // `{{folderName}}` and the long-standing `{{parentFolder}}` name the same folder here, which is what
    // Lets a template written for `Create folder with notes...` be pasted in unchanged.
    expect(result.numbered).toContain('PARENT:1. Alpha 227');
    // The extracted content is still there — the tokens are added to the template, not instead of it.
    expect(result.numbered).toContain('fragment');

    // A folder the numbering template does not recognize has no index at all, and keeps its whole name.
    expect(result.unnumbered).toContain('NAME:Beta 227');
    expect(result.unnumbered).toContain('SAFE:Beta 227');
    expect(result.unnumbered).toContain('IDX:[]');
    expect(result.unnumbered).toContain('fragment');
  });
});
