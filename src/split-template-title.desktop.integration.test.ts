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
 * Issue #276: a `title` written by `Split template` survives into the note the split creates, even though
 * `Frontmatter title mode` has already given that note a title of its own.
 *
 * The reporter read it as `{{index}}` not resolving in properties; the token did resolve, but the whole
 * `title` key the template wrote was thrown away in favor of the typed name. Driven against real Obsidian
 * because the two titles are written by two different steps (the item selector and the composer), and only
 * the real flow runs both in their real order.
 */
describe('split template title (issue #276)', () => {
  it('should keep the title the split template writes over the frontmatter title mode one', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingItem, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        /**
         * Shared by the four waits below, so their SUM stays well under the transport's ~30 s per-closure
         * cap. Every step waited for settles in well under a second on a healthy machine.
         */
        const WAIT_TIMEOUT_IN_MILLISECONDS = 5000;
        const SETTLE_IN_MILLISECONDS = 400;
        const SAVE_IN_MILLISECONDS = 300;
        const RENDER_IN_MILLISECONDS = 150;

        // A title the typed name cannot produce on its own, so the two candidate titles are told apart.
        const TEMPLATE = '---\ntitle: "N{{index}} {{safeFolderName}}"\nindex: "{{index}}"\n---\n\n{{content}}';
        const NEW_NOTE_NAME = '1. Gamma 276';
        const NOTE_PATH = `${NEW_NOTE_NAME}/${NEW_NOTE_NAME}.md`;

        const isOriginalShouldAsk = await didSetToggle('Should ask before splitting', false);
        const isOriginalShouldSplitIntoFolder = await didSetToggle('Should split into folder', true);
        const originalTitleMode = await setDropdown('Frontmatter title mode', 'UseAlways');
        try {
          await setTemplate('Split template', TEMPLATE);

          await removeIfExists(NOTE_PATH);
          await removeIfExists(NEW_NOTE_NAME);

          const sourceFile = await resetFile('anc-276-source.md', 'keep this fragment here');
          const editor = await openAndGetEditor(sourceFile);
          // Select "fragment".
          editor.setSelection(editor.offsetToPos(10), editor.offsetToPos(18));
          app.commands.executeCommandById(`${pluginId}:extract-current-selection`);
          await waitUntil({ message: 'split picker did not open', predicate: () => document.querySelector('.prompt') !== null, timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS });
          await sleep(SETTLE_IN_MILLISECONDS);

          const inputEl = document.querySelector('.prompt-input');
          if (!(inputEl instanceof HTMLInputElement)) {
            throw new TypeError('No split picker input.');
          }
          inputEl.value = NEW_NOTE_NAME;
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(SETTLE_IN_MILLISECONDS);
          inputEl.focus();
          await pressKey({ key: 'Enter', modifiers: ['Mod'] });

          // The note is created, titled by `Frontmatter title mode`, and only then templated, so the thing to
          // wait for is the template's own property landing in it.
          await waitUntil({
            message: `split template was not applied to ${NOTE_PATH}`,
            predicate: async () => {
              const content = await readIfExists(NOTE_PATH);
              return content.includes('index:');
            },
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await sleep(SETTLE_IN_MILLISECONDS);

          return await readIfExists(NOTE_PATH);
        } finally {
          await setTemplate('Split template', '');
          await setDropdown('Frontmatter title mode', originalTitleMode);
          await didSetToggle('Should ask before splitting', isOriginalShouldAsk);
          await didSetToggle('Should split into folder', isOriginalShouldSplitIntoFolder);
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
          await waitUntil({ message: 'markdown editor did not open', predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor !== undefined, timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS });
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

        async function setDropdown(name: string, value: string): Promise<string> {
          const item = await openSettingItem(name);
          const selectEl = item?.querySelector('select');
          if (!(selectEl instanceof HTMLSelectElement)) {
            throw new TypeError(`"${name}" dropdown was not found.`);
          }
          const originalValue = selectEl.value;
          selectEl.value = value;
          selectEl.dispatchEvent(new Event('change'));
          await sleep(SAVE_IN_MILLISECONDS);
          app.setting.close();
          await sleep(RENDER_IN_MILLISECONDS);
          return originalValue;
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

    // `{{index}}` resolves in a property, as it always did.
    expect(result).toContain('index: "1"');
    // The template's title, not the typed name `Frontmatter title mode` wrote first.
    expect(result).toContain('title: N1 Gamma 276');
    expect(result).not.toContain('title: 1. Gamma 276');
    expect(result).toContain('fragment');
  });
});
