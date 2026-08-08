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

import type { PluginSettingsTab } from './plugin-settings-tab.ts';

// Desktop-only: this exercises the editor context menu + command palette, which are desktop-only
// Surfaces here (matching the plugin's established single-file integration convention; no Android
// Emulator is wired for it). G99: this feature is pure plugin logic (it reads
// `Editor.somethingSelected()` to decide whether to add a menu item) with no dependence on minified
// Obsidian internals, version-sensitive DOM, or serialization formats, so verifying on public-latest is
// Sufficient; there is nothing internals-specific to differ on catalyst.
// Isolation: `npx vitest run --project integration-tests:desktop src/heading-commands-hidden-on-selection.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface MenuItemLike {
  dom?: HTMLElement;
}

interface MenuLike {
  items: MenuItemLike[];
}

interface ProbeResult {
  readonly isExtractCurrentSelectionInMenu: boolean;
  readonly isExtractThisHeadingInMenu: boolean;
  readonly isRecursiveSplitAvailable: boolean;
  readonly isRecursiveSplitInMenu: boolean;
  readonly isSplitByH2InMenu: boolean;
}

describe('heading commands hidden when a selection is made (issue #188)', () => {
  it('hides the recursive split and extract-this-heading menu items while a selection is active, keeping the palette command available', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 150;
        const EDIT_SAVE_DELAY_IN_MILLISECONDS = 300;
        const RECURSIVE_SPLIT_ITEM_TITLE = 'Split note by headings recursively';
        const EXTRACT_THIS_HEADING_ITEM_TITLE = 'Extract this heading';
        const EXTRACT_CURRENT_SELECTION_ITEM_TITLE = 'Extract current selection';
        const SPLIT_BY_H2_ITEM_TITLE = 'Split note by headings - H2';
        const RECURSIVE_SPLIT_COMMAND_ID = `${pluginId}:split-note-by-headings-recursively`;
        const NOTE_PATH = 'anc-selection-menu-visibility.md';
        // Line layout (0-indexed):
        // 0 Intro paragraph.
        // 2 # Chapter 1
        // 4 Body of chapter 1.
        // 6 ## Section A
        // 8 Body of section A.  <- the line every probe below sits on
        const NOTE_CONTENT = [
          'Intro paragraph.',
          '',
          '# Chapter 1',
          '',
          'Body of chapter 1.',
          '',
          '## Section A',
          '',
          'Body of section A.'
        ].join('\n');
        const SECTION_A_BODY_LINE = 8;
        const SELECTION_END_CH = 4;

        const file = await ensureMarkdownFile(NOTE_PATH, NOTE_CONTENT);

        // Flat menu items (no submenu) so the plugin's items are directly in `menu.items`.
        await setToggle('Should add commands to submenu', false);

        // Caret inside the heading's body, nothing selected: both heading commands are offered.
        const caretInBody = await probe(file, 0);
        // A real selection on that same line: both are gone, the selection command takes over.
        const selectionInBody = await probe(file, SELECTION_END_CH);

        // Restore the shared instance to a clean default state.
        await setToggle('Should add commands to submenu', true);

        return { caretInBody, selectionInBody };

        async function probe(targetFile: TFile, toCh: number): Promise<ProbeResult> {
          const editor = await openAndGetEditor(targetFile);
          editor.setSelection({ ch: 0, line: SECTION_A_BODY_LINE }, { ch: toCh, line: SECTION_A_BODY_LINE });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }

          const command = app.commands.commands[RECURSIVE_SPLIT_COMMAND_ID];
          const isRecursiveSplitAvailable = command?.editorCheckCallback?.(true, editor, view) === true;

          const menu = new obsidianModule.Menu();
          app.workspace.trigger('editor-menu', menu, editor, view);
          const titles = menuItemTitles(menu);
          const probeResult = {
            isExtractCurrentSelectionInMenu: titles.some((title) => title.includes(EXTRACT_CURRENT_SELECTION_ITEM_TITLE)),
            isExtractThisHeadingInMenu: titles.some((title) => title.includes(EXTRACT_THIS_HEADING_ITEM_TITLE)),
            isRecursiveSplitAvailable,
            isRecursiveSplitInMenu: titles.some((title) => title.includes(RECURSIVE_SPLIT_ITEM_TITLE)),
            isSplitByH2InMenu: titles.some((title) => title.includes(SPLIT_BY_H2_ITEM_TITLE))
          };
          menu.hide();

          return probeResult;
        }

        function menuItemTitles(menu: MenuLike): string[] {
          return menu.items.map((item) => item.dom?.textContent ?? '');
        }

        async function ensureMarkdownFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          return app.vault.create(path, content);
        }

        async function openAndGetEditor(targetFile: TFile): Promise<Editor> {
          await app.workspace.getLeaf(false).openFile(targetFile);
          await waitUntil({
            message: `markdown view for ${targetFile.path} did not become active`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === targetFile.path
          });
          // The heading commands read the note's headings from metadataCache; wait for them to be indexed.
          await waitUntil({
            message: `headings for ${targetFile.path} were not indexed`,
            predicate: () => (app.metadataCache.getFileCache(targetFile)?.headings?.length ?? 0) >= 2
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          return view.editor;
        }

        async function setToggle(settingName: string, shouldEnable: boolean): Promise<void> {
          const settingTab = await openSettingTab();
          const settingItems = [...settingTab.containerEl.querySelectorAll('.setting-item')];
          const settingItem = settingItems.find((el) => el.querySelector('.setting-item-name')?.textContent === settingName);
          const toggleEl = settingItem?.querySelector('.checkbox-container');
          if (!(toggleEl instanceof HTMLElement)) {
            throw new TypeError(`"${settingName}" toggle was not found.`);
          }
          const isEnabled = toggleEl.classList.contains('is-enabled');
          if (isEnabled !== shouldEnable) {
            toggleEl.click();
            await sleep(EDIT_SAVE_DELAY_IN_MILLISECONDS);
          }
          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        }

        async function openSettingTab(): Promise<PluginSettingsTab> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const settingTab = app.setting.pluginTabs.find((tab) => tab.id === pluginId);
          if (!settingTab) {
            throw new Error('Settings tab was not found.');
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return settingTab as PluginSettingsTab;
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // Caret in the heading's body with nothing selected: both heading commands are offered, and
    // `Extract this heading...` works from the body rather than only the `#` line (issue #143).
    expect(result.caretInBody.isRecursiveSplitInMenu).toBe(true);
    expect(result.caretInBody.isExtractThisHeadingInMenu).toBe(true);
    expect(result.caretInBody.isExtractCurrentSelectionInMenu).toBe(false);

    // A selection on the same line: both heading commands leave the menu (issue #188)...
    expect(result.selectionInBody.isRecursiveSplitInMenu).toBe(false);
    expect(result.selectionInBody.isExtractThisHeadingInMenu).toBe(false);
    // ...and the selection-scoped command is the one offered instead.
    expect(result.selectionInBody.isExtractCurrentSelectionInMenu).toBe(true);

    // The hide is menu-only: the palette command (and any hotkey) stays available either way.
    expect(result.caretInBody.isRecursiveSplitAvailable).toBe(true);
    expect(result.selectionInBody.isRecursiveSplitAvailable).toBe(true);

    // The level-scoped items keep their own rule (issue #94): shown whenever the selection intersects a
    // Heading of that level, selection or not.
    expect(result.caretInBody.isSplitByH2InMenu).toBe(true);
    expect(result.selectionInBody.isSplitByH2InMenu).toBe(true);
  });
});
