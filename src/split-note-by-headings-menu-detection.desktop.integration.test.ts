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

// Desktop-only: this exercises the editor context menu + command palette, which are desktop-only
// Surfaces here (matching the plugin's established single-file integration convention; no Android
// Emulator is wired for it). G99: this feature is pure plugin logic (it intersects the note's
// `metadataCache` headings with the editor selection/cursor range to gate a menu item) with no
// Dependence on minified Obsidian internals, version-sensitive DOM, or serialization formats, so
// Verifying on public-latest is sufficient; there is nothing internals-specific to differ on catalyst.
// Isolation: `npx vitest run --project integration-tests:desktop src/split-note-by-headings-menu-detection.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface MenuItemLike {
  dom?: HTMLElement;
}

interface MenuLike {
  items: MenuItemLike[];
}

interface ProbeResult {
  readonly isH1InMenu: boolean;
  readonly isH2Available: boolean;
  readonly isH2InMenu: boolean;
}

describe('better split detection on right click (issue #94)', () => {
  it('shows a Split note by headings - H<n> item only when the selection intersects a heading of that level', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 150;
        const EDIT_SAVE_DELAY_IN_MILLISECONDS = 300;
        const H2_ITEM_TITLE = 'Split note by headings - H2';
        const H1_ITEM_TITLE = 'Split note by headings - H1';
        const H2_COMMAND_ID = `${pluginId}:split-note-by-headings-h2`;
        const NOTE_PATH = 'anc-split-detection.md';
        // Line layout (0-indexed):
        // 0 Intro paragraph.  <- non-heading area, under no heading
        // 2 # Chapter 1        <- H1 section spans [2, end]
        // 4 Body of chapter 1. <- inside H1 only (before any H2)
        // 6 ## Section A        <- H2 section spans [6, 9]
        // 8 Body of section A.  <- inside the H2 (Section A) section
        // 10 ## Section B        <- H2 section spans [10, end]
        // 12 Body of section B.
        const NOTE_CONTENT = [
          'Intro paragraph.',
          '',
          '# Chapter 1',
          '',
          'Body of chapter 1.',
          '',
          '## Section A',
          '',
          'Body of section A.',
          '',
          '## Section B',
          '',
          'Body of section B.'
        ].join('\n');
        const INTRO_LINE = 0;
        const CHAPTER_BODY_LINE = 4;
        const SECTION_A_BODY_LINE = 8;

        const file = await ensureMarkdownFile(NOTE_PATH, NOTE_CONTENT);

        // Flat menu items (no submenu) so the split items are directly in `menu.items`.
        await setToggle('Should add commands to submenu', false);

        // Cursor inside the H2 (Section A) section: the H2 item is shown and the palette command available.
        const insideSectionA = await probe(file, SECTION_A_BODY_LINE, SECTION_A_BODY_LINE);
        // A real selection spanning inside the same H2 section: still shown.
        const selectionInSectionA = await probe(file, SECTION_A_BODY_LINE, SECTION_A_BODY_LINE, 4);
        // Cursor in the H1 body before any H2: the H2 item is hidden/unavailable, the H1 item stays shown.
        const insideChapterOnly = await probe(file, CHAPTER_BODY_LINE, CHAPTER_BODY_LINE);
        // Cursor in the intro, under no heading at all: neither the H1 nor the H2 item is shown.
        const insideIntro = await probe(file, INTRO_LINE, INTRO_LINE);

        // Restore the shared instance to a clean default state.
        await setToggle('Should add commands to submenu', true);

        return {
          insideChapterOnly,
          insideIntro,
          insideSectionA,
          selectionInSectionA
        };

        async function probe(targetFile: TFile, fromLine: number, toLine: number, toCh = 0): Promise<ProbeResult> {
          const editor = await openAndGetEditor(targetFile);
          editor.setSelection({ ch: 0, line: fromLine }, { ch: toCh, line: toLine });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }

          const command = app.commands.commands[H2_COMMAND_ID];
          const isH2Available = command?.editorCheckCallback?.(true, editor, view) === true;

          const menu = new obsidianModule.Menu();
          app.workspace.trigger('editor-menu', menu, editor, view);
          const titles = menuItemTitles(menu);
          const isH2InMenu = titles.some((title) => title.includes(H2_ITEM_TITLE));
          const isH1InMenu = titles.some((title) => title.includes(H1_ITEM_TITLE));
          menu.hide();

          return { isH1InMenu, isH2Available, isH2InMenu };
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
          // The editor-menu gate reads the note's headings from metadataCache; wait for them to be indexed.
          await waitUntil({
            message: `headings for ${targetFile.path} were not indexed`,
            predicate: () => (app.metadataCache.getFileCache(targetFile)?.headings?.length ?? 0) >= 3
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          return view.editor;
        }

        async function setToggle(settingName: string, shouldEnable: boolean): Promise<void> {
          const settingTab = await openSettingTab();
          const settingItems = Array.from(settingTab.containerEl.querySelectorAll('.setting-item'));
          const settingItem = settingItems.find((el) => el.querySelector('.setting-item-name')?.textContent === settingName);
          const toggleEl = settingItem?.querySelector('.checkbox-container');
          if (!(toggleEl instanceof HTMLElement)) {
            throw new Error(`"${settingName}" toggle was not found.`);
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
      vaultPath: getTempVault().path
    });

    // Cursor inside the H2 (Section A) section: the H2 item shows and the palette command is available.
    expect(result.insideSectionA.isH2InMenu).toBe(true);
    expect(result.insideSectionA.isH2Available).toBe(true);
    expect(result.insideSectionA.isH1InMenu).toBe(true);

    // A real selection landing inside the same H2 section behaves identically.
    expect(result.selectionInSectionA.isH2InMenu).toBe(true);
    expect(result.selectionInSectionA.isH2Available).toBe(true);

    // Cursor in the H1 body before any H2: the H2 item is hidden and unavailable, the H1 item stays.
    expect(result.insideChapterOnly.isH2InMenu).toBe(false);
    expect(result.insideChapterOnly.isH2Available).toBe(false);
    expect(result.insideChapterOnly.isH1InMenu).toBe(true);

    // Cursor in the intro, under no heading: neither split item is shown.
    expect(result.insideIntro.isH1InMenu).toBe(false);
    expect(result.insideIntro.isH2InMenu).toBe(false);
  });
});
