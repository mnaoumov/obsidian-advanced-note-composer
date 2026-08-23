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

import { findSettingItemInObsidian } from './settings-tab-navigation.ts';

// Desktop-only, for the same reason as `command-blocking.desktop.integration.test.ts`: it drives the
// Command palette's check callback, a desktop-only surface here. G99: settings-gated `canExecute*` logic
// With no dependence on minified internals or version-sensitive DOM, so public-latest is sufficient.
// Isolation: `npx vitest run --project integration-tests:desktop src/command-blocking-per-category.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

/**
 * One probed command per category, chosen so that a selection in any note is enough for all of them —
 * none of these has a further precondition that could be mistaken for a block.
 */
interface CategoryAvailability {
  readonly create: boolean;
  readonly smartCutAndPaste: boolean;
  readonly splitAndExtract: boolean;
  readonly swap: boolean;
}

describe('per-category command blocking (issue #249)', () => {
  it('hides one category on a path and leaves the others offered there', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingItem, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 150;
        const EDIT_SAVE_DELAY_IN_MILLISECONDS = 300;
        const BLOCKED_FOLDER = 'anc-category-block-demo';
        const BLOCKED_NOTE = `${BLOCKED_FOLDER}/blocked.md`;
        const OTHER_NOTE = 'anc-category-block-other.md';

        await app.vault.createFolder(BLOCKED_FOLDER).catch(() => undefined);
        const blockedFile = await ensureMarkdownFile(BLOCKED_NOTE, 'alpha bravo charlie');
        const otherFile = await ensureMarkdownFile(OTHER_NOTE, 'delta echo foxtrot');

        const nothingConfigured = await probeCategories(blockedFile);

        // The reporter's first example: one category loses its commands on the path, the rest stay.
        await setPaths('Smart cut & paste command exclude paths', BLOCKED_FOLDER);
        const oneCategoryBlocked = await probeCategories(blockedFile);
        const oneCategoryBlockedElsewhere = await probeCategories(otherFile);

        await setPaths('Smart cut & paste command exclude paths', '');

        return { nothingConfigured, oneCategoryBlocked, oneCategoryBlockedElsewhere };

        async function probeCategories(file: TFile): Promise<CategoryAvailability> {
          const editor = await openAndGetEditor(file);
          editor.setSelection(editor.offsetToPos(0), editor.offsetToPos(5));
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          const activeView = view;

          return {
            create: isAvailable('create-empty-note-at-cursor'),
            smartCutAndPaste: isAvailable('mark-selection-to-move'),
            splitAndExtract: isAvailable('extract-current-selection'),
            swap: isAvailable('mark-selection-to-swap')
          };

          function isAvailable(commandId: string): boolean {
            const command = app.commands.commands[`${pluginId}:${commandId}`];
            return command?.editorCheckCallback?.(true, editor, activeView) === true;
          }
        }

        async function ensureMarkdownFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          return app.vault.create(path, content);
        }

        async function openAndGetEditor(file: TFile): Promise<Editor> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({ predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          return view.editor;
        }

        async function setPaths(settingName: string, value: string): Promise<void> {
          const settingTab = await openSettingTab();
          const settingItem = await findSettingItem({ app, name: settingName, settingTab });
          const textAreaEl = settingItem?.querySelector('textarea');
          if (!(textAreaEl instanceof HTMLTextAreaElement)) {
            throw new TypeError(`"${settingName}" text area was not found.`);
          }
          textAreaEl.value = value;
          textAreaEl.dispatchEvent(new Event('input'));
          await sleep(EDIT_SAVE_DELAY_IN_MILLISECONDS);
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
      input: { findSettingItem: findSettingItemInObsidian, pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // Every probed command is offered while nothing is configured.
    expect(result.nothingConfigured).toEqual({ create: true, smartCutAndPaste: true, splitAndExtract: true, swap: true });

    // Only the excluded category is gone — the whole point of issue #249, which before it was all-or-nothing.
    expect(result.oneCategoryBlocked).toEqual({ create: true, smartCutAndPaste: false, splitAndExtract: true, swap: true });

    // And only on that path.
    expect(result.oneCategoryBlockedElsewhere).toEqual({ create: true, smartCutAndPaste: true, splitAndExtract: true, swap: true });
  });

  it('blocks every category the path is listed under, and keeps the ones it is not', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingItem, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 150;
        const EDIT_SAVE_DELAY_IN_MILLISECONDS = 300;
        const BLOCKED_FOLDER = 'anc-category-block-demo';
        const BLOCKED_NOTE = `${BLOCKED_FOLDER}/blocked.md`;

        await app.vault.createFolder(BLOCKED_FOLDER).catch(() => undefined);
        const blockedFile = await ensureMarkdownFile(BLOCKED_NOTE, 'alpha bravo charlie');

        // The reporter's second and third examples: name the categories to block, and whatever is left
        // Unlisted stays offered. Here `Smart cut & paste` is the one kept.
        await setPaths('Create command exclude paths', BLOCKED_FOLDER);
        await setPaths('Swap command exclude paths', BLOCKED_FOLDER);
        await setPaths('Split/extract command exclude paths', BLOCKED_FOLDER);
        const restBlocked = await probeCategories(blockedFile);

        // The un-prefixed pair still means EVERY command (that is what makes an existing `data.json` behave
        // Identically), so listing the path there hides the kept category too.
        await setPaths('Command exclude paths', BLOCKED_FOLDER);
        const baselineBlocked = await probeCategories(blockedFile);

        // A category filter narrows; it can never re-open what the baseline hid.
        await setPaths('Create command include paths', BLOCKED_FOLDER);
        const baselineWinsOverCategoryInclude = await probeCategories(blockedFile);

        // Restore the shared instance to a clean default state.
        await setPaths('Create command include paths', '');
        await setPaths('Command exclude paths', '');
        await setPaths('Create command exclude paths', '');
        await setPaths('Swap command exclude paths', '');
        await setPaths('Split/extract command exclude paths', '');
        const restored = await probeCategories(blockedFile);

        return { baselineBlocked, baselineWinsOverCategoryInclude, restBlocked, restored };

        async function probeCategories(file: TFile): Promise<CategoryAvailability> {
          const editor = await openAndGetEditor(file);
          editor.setSelection(editor.offsetToPos(0), editor.offsetToPos(5));
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          const activeView = view;

          return {
            create: isAvailable('create-empty-note-at-cursor'),
            smartCutAndPaste: isAvailable('mark-selection-to-move'),
            splitAndExtract: isAvailable('extract-current-selection'),
            swap: isAvailable('mark-selection-to-swap')
          };

          function isAvailable(commandId: string): boolean {
            const command = app.commands.commands[`${pluginId}:${commandId}`];
            return command?.editorCheckCallback?.(true, editor, activeView) === true;
          }
        }

        async function ensureMarkdownFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          return app.vault.create(path, content);
        }

        async function openAndGetEditor(file: TFile): Promise<Editor> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({ predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          return view.editor;
        }

        async function setPaths(settingName: string, value: string): Promise<void> {
          const settingTab = await openSettingTab();
          const settingItem = await findSettingItem({ app, name: settingName, settingTab });
          const textAreaEl = settingItem?.querySelector('textarea');
          if (!(textAreaEl instanceof HTMLTextAreaElement)) {
            throw new TypeError(`"${settingName}" text area was not found.`);
          }
          textAreaEl.value = value;
          textAreaEl.dispatchEvent(new Event('input'));
          await sleep(EDIT_SAVE_DELAY_IN_MILLISECONDS);
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
      input: { findSettingItem: findSettingItemInObsidian, pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    expect(result.restBlocked).toEqual({ create: false, smartCutAndPaste: true, splitAndExtract: false, swap: false });
    expect(result.baselineBlocked).toEqual({ create: false, smartCutAndPaste: false, splitAndExtract: false, swap: false });
    expect(result.baselineWinsOverCategoryInclude).toEqual({ create: false, smartCutAndPaste: false, splitAndExtract: false, swap: false });
    expect(result.restored).toEqual({ create: true, smartCutAndPaste: true, splitAndExtract: true, swap: true });
  });
});
