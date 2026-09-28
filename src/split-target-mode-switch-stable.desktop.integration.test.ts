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

/*
 * Coverage for issue #303. With `Should choose the folder before the name when splitting` on, the
 * create/merge switch moves between TWO modals: the folder prompt (`Create`) and the split picker
 * (`Merge`). The reporter saw two differences between them:
 *
 * - the input jumped by a line on every flip, because the folder prompt's description wrapped onto a
 *   second line and the picker's did not;
 * - only the picker had the minimize button.
 *
 * Both are layout, which only the real app renders, so this measures them: the input's top and the
 * switch row's height on each surface, and the minimize buttons on each.
 *
 * Isolation: `npx vitest run --project integration-tests:desktop src/split-target-mode-switch-stable.desktop.integration.test.ts`.
 */

const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: SwitchSettings;
}

interface SettingsCarrier {
  editAndSave: (editor: (settings: SwitchSettings) => void) => Promise<void>;
  settings: SwitchSettings;
}

interface SurfaceMeasure {
  description: string;
  inputTop: number;
  minimizeButtonCount: number;
  switchRowHeight: number;
}

interface SwitchSettings {
  defaultSplitTargetMode: string;
  shouldAskBeforeSplitting: boolean;
  shouldAskForTargetFolderWhenSplitting: boolean;
  shouldChooseFolderBeforeNameWhenSplitting: boolean;
  shouldSplitHeadingsAutomatically: boolean;
  shouldSplitIntoFolder: boolean;
}

describe('the create/merge switch across the folder prompt and the picker (issue #303)', () => {
  it('keeps the input in place and the minimize button on both sides of the flip', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        /**
         * Seven call sites share this ceiling (one inside `openAndGetEditor`), so the closure declares 21 s
         * of waits plus about 1.2 s of fixed render delays - under the transport's ~30 s cap with headroom.
         */
        const WAIT_TIMEOUT_IN_MILLISECONDS = 3000;
        const RENDER_DELAY_IN_MILLISECONDS = 300;
        const FOLDER_PLACEHOLDER = 'Select folder to create the new note in...';
        const PICKER_PLACEHOLDER = 'Select file to extract into...';
        const SOURCE_PATH = 'switch-stable-source.md';
        const SOURCE_CONTENT = 'alpha SWITCH-STABLE-BODY omega\n';
        const SELECTED_TEXT = 'SWITCH-STABLE-BODY';

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldChooseFolderBeforeNameWhenSplitting = true;
            settings.defaultSplitTargetMode = 'Create';
            settings.shouldAskBeforeSplitting = false;
            settings.shouldAskForTargetFolderWhenSplitting = false;
            settings.shouldSplitIntoFolder = false;
            settings.shouldSplitHeadingsAutomatically = false;
          });

          const source = await resetFile(SOURCE_PATH, SOURCE_CONTENT);
          const editor = await openAndGetEditor(source);
          editor.setValue(SOURCE_CONTENT);
          await waitUntil({
            message: 'the source editor did not catch up with the reset content',
            predicate: () => editor.getValue() === SOURCE_CONTENT,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          const selectionStart = SOURCE_CONTENT.indexOf(SELECTED_TEXT);
          editor.setSelection(editor.offsetToPos(selectionStart), editor.offsetToPos(selectionStart + SELECTED_TEXT.length));
          app.commands.executeCommandById(`${pluginId}:extract-current-selection`);

          await waitForPlaceholder(FOLDER_PLACEHOLDER, 'the folder prompt did not open');
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const folderPrompt = measure();

          getSwitchToggle()?.click();
          await waitForPlaceholder(PICKER_PLACEHOLDER, 'the switch did not open the picker');
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const picker = measure();

          // Back to the folder prompt, to prove the return trip lands where the outward one started.
          getSwitchToggle()?.click();
          await waitForPlaceholder(FOLDER_PLACEHOLDER, 'the picker\'s switch did not return to the folder prompt');
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const folderPromptAgain = measure();

          // Cancel through Obsidian's own keymap (trusted input): an open prompt would hold the source lock
          // into every later suite.
          getPromptInput()?.focus();
          await pressKey({ key: 'Escape' });
          await waitUntil({
            message: 'Escape did not close the folder prompt',
            predicate: () => getPromptInput() === null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          return { folderPrompt, folderPromptAgain, picker };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.defaultSplitTargetMode = original.defaultSplitTargetMode;
            settings.shouldAskBeforeSplitting = original.shouldAskBeforeSplitting;
            settings.shouldAskForTargetFolderWhenSplitting = original.shouldAskForTargetFolderWhenSplitting;
            settings.shouldChooseFolderBeforeNameWhenSplitting = original.shouldChooseFolderBeforeNameWhenSplitting;
            settings.shouldSplitHeadingsAutomatically = original.shouldSplitHeadingsAutomatically;
            settings.shouldSplitIntoFolder = original.shouldSplitIntoFolder;
          });
        }

        function findSettingsComponent(): SettingsCarrier {
          const plugin = app.plugins.getPlugin(pluginId) as ComponentTreeNode | null;
          const queue: ComponentTreeNode[] = plugin ? [plugin] : [];
          while (queue.length > 0) {
            const node = queue.shift();
            if (!node) {
              continue;
            }
            if (typeof node.editAndSave === 'function' && typeof node.settings?.shouldChooseFolderBeforeNameWhenSplitting === 'boolean') {
              return node as SettingsCarrier;
            }
            if (node._children) {
              queue.push(...node._children);
            }
          }
          throw new Error('Settings component was not found.');
        }

        function getPromptInput(): HTMLInputElement | null {
          const input = document.querySelector('.prompt-input');
          return input instanceof HTMLInputElement ? input : null;
        }

        function getSwitchRow(): HTMLElement | null {
          return getPromptInput()?.closest('.modal-container')?.querySelector<HTMLElement>(':scope .advanced-note-composer-split-target-mode') ?? null;
        }

        function getSwitchToggle(): HTMLElement | null {
          return getSwitchRow()?.querySelector<HTMLElement>(':scope .checkbox-container') ?? null;
        }

        function measure(): SurfaceMeasure {
          return {
            description: getSwitchRow()?.querySelector(':scope .setting-item-description')?.textContent ?? '',
            inputTop: getPromptInput()?.getBoundingClientRect().top ?? -1,
            minimizeButtonCount: document.querySelectorAll('.modal-container .minimize-button').length,
            switchRowHeight: getSwitchRow()?.getBoundingClientRect().height ?? -1
          };
        }

        async function openAndGetEditor(file: TFile): Promise<Editor> {
          const leaf = app.workspace.getLeaf(false);
          await leaf.openFile(file);
          await waitUntil({
            message: `the editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          await view.setState({ ...view.getState(), mode: 'source', source: true }, { history: false });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return view.editor;
        }

        async function resetFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          return app.vault.create(path, content);
        }

        async function waitForPlaceholder(placeholder: string, message: string): Promise<void> {
          await waitUntil({
            message,
            predicate: () => getPromptInput()?.placeholder === placeholder,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The two surfaces say the same thing, so the row above the input is one height and the input does not move.
    expect(result.picker.description).toBe(result.folderPrompt.description);
    expect(result.picker.switchRowHeight).toBe(result.folderPrompt.switchRowHeight);
    expect(result.picker.inputTop).toBe(result.folderPrompt.inputTop);
    expect(result.folderPromptAgain.inputTop).toBe(result.folderPrompt.inputTop);

    // Both surfaces are minimizable.
    expect(result.folderPrompt.minimizeButtonCount).toBe(1);
    expect(result.picker.minimizeButtonCount).toBe(1);
    expect(result.folderPromptAgain.minimizeButtonCount).toBe(1);
  });
});
