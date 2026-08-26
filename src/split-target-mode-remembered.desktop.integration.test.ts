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
 * Coverage for issue #245: the create/merge switch should reopen holding the mode it was last left in,
 * instead of always starting from `Default split target mode`. The opt-in
 * `shouldRememberLastSplitTargetMode` setting makes the picker write the chosen mode back to that setting.
 *
 * `SplitFileModal` is `v8 ignore`d, so the payoff - what the switch READS when the picker reopens - can only
 * be observed in the real app. The unit tests pin the three guards; this pins that remembering happens at
 * all.
 *
 * Isolation: `npx vitest run --project integration-tests:desktop src/split-target-mode-remembered.desktop.integration.test.ts`.
 */

const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: RememberedModeSettings;
}

interface RememberedModeSettings {
  defaultSplitTargetMode: string;
  shouldAskBeforeSplitting: boolean;
  shouldRememberLastSplitTargetMode: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: RememberedModeSettings) => void): Promise<void>;
  settings: RememberedModeSettings;
}

describe('the split/extract picker remembers the mode it was left in (issue #245)', () => {
  it('should reopen in merge after a merge, once the setting is on', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        // Distinctive on purpose: the whole aggregate run shares ONE vault, so a generic name here would
        // Make another suite's link ambiguous.
        const SOURCE_PATH = 'split-mode-remembered-source.md';
        const TARGET_BASENAME = 'split-mode-remembered-target';
        const TARGET_PATH = `${TARGET_BASENAME}.md`;
        const SOURCE_CONTENT = 'alpha bravo charlie\n';
        const SELECTED_WORD = 'bravo';

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeSplitting = false;
            settings.shouldRememberLastSplitTargetMode = true;
            // The baseline the reopened picker has to have MOVED away from. Read back below rather than
            // Assumed: a suite that confirmed a dialog earlier can leave this setting anywhere.
            settings.defaultSplitTargetMode = 'Create';
          });
          const modeBeforeAnything = settingsComponent.settings.defaultSplitTargetMode;

          const editor = await openResetSource();
          await resetFile(TARGET_PATH, 'target body\n');

          await openPicker(editor);
          // Without this the whole test would pass just as well against a picker stuck on `Merge`.
          const isSwitchOnAtFirstOpen = isSwitchOn();

          await flipSwitch();
          const input = getPickerInput();
          typeIntoPicker(input, TARGET_BASENAME);
          await waitUntil({
            message: `no suggestion appeared for ${TARGET_BASENAME}`,
            predicate: () => [...document.querySelectorAll('.suggestion-item')].some((el) => el.textContent.includes(TARGET_BASENAME))
          });
          input.focus();
          pressKey({ key: 'Enter' });

          await waitUntil({
            message: 'the split picker did not close',
            predicate: () => document.querySelector('.prompt') === null
          });
          // The extraction rewrites the SOURCE note too, so waiting for that is what proves the operation
          // Ran rather than the modal merely closing.
          await waitUntil({
            message: 'the selection was not extracted out of the source note',
            predicate: () => !editor.getValue().includes('bravo charlie')
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const savedMode = settingsComponent.settings.defaultSplitTargetMode;
          const mergedTargetContent = await readIfExists(TARGET_PATH);

          // The point of the whole feature: the NEXT run opens where the last one left off.
          const reopenedEditor = await openResetSource();
          await openPicker(reopenedEditor);
          const isSwitchOnAtSecondOpen = isSwitchOn();

          pressKey({ key: 'Escape' });
          await waitUntil({
            message: 'the reopened split picker did not close',
            predicate: () => document.querySelector('.prompt') === null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          return {
            isSwitchOnAtFirstOpen,
            isSwitchOnAtSecondOpen,
            mergedTargetContent,
            modeBeforeAnything,
            savedMode
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            // This feature WRITES to the shared `data.json`, so leaving either key behind would decide the
            // Mode for every later split suite in the aggregate run.
            settings.defaultSplitTargetMode = original.defaultSplitTargetMode;
            settings.shouldAskBeforeSplitting = original.shouldAskBeforeSplitting;
            settings.shouldRememberLastSplitTargetMode = original.shouldRememberLastSplitTargetMode;
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
            if (isSettingsComponent(node)) {
              return node;
            }
            if (node._children) {
              queue.push(...node._children);
            }
          }
          throw new Error('Settings component was not found.');
        }

        function isSettingsComponent(node: ComponentTreeNode): node is SettingsCarrier {
          return typeof node.editAndSave === 'function' && typeof node.settings?.shouldRememberLastSplitTargetMode === 'boolean';
        }

        async function openPicker(editor: Editor): Promise<void> {
          const selectionStart = SOURCE_CONTENT.indexOf(SELECTED_WORD);
          editor.setSelection(editor.offsetToPos(selectionStart), editor.offsetToPos(selectionStart + SELECTED_WORD.length));
          app.commands.executeCommandById(`${pluginId}:extract-current-selection`);
          await waitUntil({
            message: 'the split picker did not open',
            predicate: () => document.querySelector('.prompt') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        }

        function isSwitchOn(): boolean {
          return document.querySelector('.advanced-note-composer-split-target-mode .checkbox-container')?.classList.contains('is-enabled') ?? false;
        }

        async function flipSwitch(): Promise<void> {
          const modeToggle = document.querySelector('.advanced-note-composer-split-target-mode .checkbox-container');
          if (!(modeToggle instanceof HTMLElement)) {
            throw new TypeError('No create/merge switch in the split picker.');
          }
          modeToggle.click();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        }

        function getPickerInput(): HTMLInputElement {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No split picker input.');
          }
          return input;
        }

        function typeIntoPicker(input: HTMLInputElement, value: string): void {
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        async function readIfExists(path: string): Promise<string> {
          const file = app.vault.getAbstractFileByPath(path);
          return file instanceof obsidianModule.TFile ? await app.vault.read(file) : '';
        }

        async function resetFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          return app.vault.create(path, content);
        }

        async function openResetSource(): Promise<Editor> {
          const source = await resetFile(SOURCE_PATH, SOURCE_CONTENT);
          const leaf = app.workspace.getLeaf(false);
          await leaf.openFile(source);
          await app.workspace.revealLeaf(leaf);
          await waitUntil({
            message: `the editor for ${source.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === source.path
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          await view.setState({ ...view.getState(), mode: 'source', source: true }, { history: false });
          // Reset through the EDITOR, not the vault: the previous run left a link where `bravo` was, and an
          // Open buffer wins over `vault.modify` - selecting by offset against a stale buffer would extract
          // That link instead of the word.
          view.editor.setValue(SOURCE_CONTENT);
          await waitUntil({
            message: 'the source editor did not catch up with the reset content',
            predicate: () => view.editor.getValue() === SOURCE_CONTENT
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return view.editor;
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The baseline really was `Create`, which is what makes the reopened switch mean anything.
    expect(result.modeBeforeAnything).toBe('Create');
    expect(result.isSwitchOnAtFirstOpen).toBe(false);

    // The merge really ran - the extracted word landed IN the existing note.
    expect(result.mergedTargetContent).toContain('target body');
    expect(result.mergedTargetContent).toContain('bravo');

    // ...and choosing that target in `Merge` saved the mode.
    expect(result.savedMode).toBe('Merge');

    // The payoff the reporter asked for: the next extract opens on `Merge`.
    expect(result.isSwitchOnAtSecondOpen).toBe(true);
  });
});
