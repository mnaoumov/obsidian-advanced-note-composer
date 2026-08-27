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
 * Coverage for issue #237: the split/extract picker seeds its box with the heading name, which exists to
 * NAME a new note - so it is noise in `Merge`, where the box searches for a note that already exists and the
 * user had to erase it first. Flipping the switch now swaps the box per mode, and the reporter's follow-up
 * comment settles the other half ("if switched back to `create`, the header name should appear again").
 *
 * `SplitFileModal` is `v8 ignore`d, so every interaction it offers needs a desktop test rather than a
 * model-level unit test.
 *
 * Isolation: `npx vitest run --project integration-tests:desktop src/split-picker-mode-seed.desktop.integration.test.ts`.
 */

const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: ModeSeedSettings;
}

interface ModeSeedSettings {
  defaultSplitTargetMode: string;
  shouldSplitHeadingsAutomatically: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: ModeSeedSettings) => void): Promise<void>;
  settings: ModeSeedSettings;
}

describe('the split/extract picker\'s box is remembered per mode (issue #237)', () => {
  it('drops the heading name when the switch says merge, and gives it back when it says create', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const SOURCE_PATH = 'split-picker-mode-seed-source.md';
        // Distinctive on purpose: the whole aggregate run shares ONE vault, so a generic name here would
        // Make another suite's link ambiguous - and this is also the note the picker must NOT create.
        const HEADING = 'split-picker-mode-seed-heading';
        const SOURCE_CONTENT = `# Note\n\n## ${HEADING}\nseed body one\nseed body two\n`;
        const HEADING_LINE_INDEX = 2;
        const HEADING_COUNT = 2;
        // Whatever the user types while merging is a search for an existing note, not a name - so it must
        // Survive a round trip through `Create` just as the heading survives one through `Merge`.
        const MERGE_SEARCH = 'split-picker-mode-seed-merge-search';

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        try {
          await settingsComponent.editAndSave((settings) => {
            // The picker has to actually OPEN: with headings split automatically, `Extract this heading...`
            // Skips it entirely and there is no box to observe.
            settings.shouldSplitHeadingsAutomatically = false;
            settings.defaultSplitTargetMode = 'Create';
          });

          const source = await resetFile(SOURCE_PATH, SOURCE_CONTENT);
          const editor = await openAndGetEditor(source);
          // Reset through the EDITOR: an open buffer wins over `vault.modify`, so a line-based cursor would
          // Otherwise land in the previous run's text.
          editor.setValue(SOURCE_CONTENT);
          await waitUntil({
            message: 'the source editor did not catch up with the reset content',
            predicate: () => editor.getValue() === SOURCE_CONTENT
          });
          await waitUntil({
            message: 'the heading cache is not ready',
            predicate: () => (app.metadataCache.getFileCache(source)?.headings?.length ?? 0) === HEADING_COUNT
          });

          editor.setCursor({ ch: 0, line: HEADING_LINE_INDEX });
          app.commands.executeCommandById(`${pluginId}:extract-this-heading`);
          await waitUntil({
            message: 'the split picker did not open',
            predicate: () => document.querySelector('.prompt') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // Read the seed BEFORE anything is flipped: without it every assertion below would pass just as
          // Well against a picker that was never seeded at all.
          const seededValueInCreateMode = readPickerValue();

          await flipSwitch();
          const valueAfterSwitchingToMerge = readPickerValue();
          // Issue #260: a CLICK on the switch used to leave focus on the switch, so the next thing typed
          // Went nowhere. `Alt+M` never had the problem — a key press leaves focus where it was.
          const isBoxFocusedAfterClickingSwitch = activeDocument.activeElement === getPickerInput();

          typeIntoPicker(MERGE_SEARCH);
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          await flipSwitch();
          const valueAfterSwitchingBackToCreate = readPickerValue();

          await flipSwitch();
          const valueAfterSwitchingToMergeAgain = readPickerValue();

          pressKey({ key: 'Escape' });
          await waitUntil({
            message: 'the split picker did not close',
            predicate: () => document.querySelector('.prompt') === null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          return {
            isBoxFocusedAfterClickingSwitch,
            seededValueInCreateMode,
            valueAfterSwitchingBackToCreate,
            valueAfterSwitchingToMerge,
            valueAfterSwitchingToMergeAgain,
            // Cancelling must leave the vault alone - a note named after the heading would mean the picker
            // Chose something on the way out.
            wasHeadingNoteCreated: app.vault.getAbstractFileByPath(`${HEADING}.md`) !== null
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.defaultSplitTargetMode = original.defaultSplitTargetMode;
            settings.shouldSplitHeadingsAutomatically = original.shouldSplitHeadingsAutomatically;
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
          return typeof node.editAndSave === 'function' && typeof node.settings?.defaultSplitTargetMode === 'string';
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

        function readPickerValue(): string {
          return getPickerInput().value;
        }

        function typeIntoPicker(value: string): void {
          const input = getPickerInput();
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
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
          const leaf = app.workspace.getLeaf(false);
          await leaf.openFile(file);
          await app.workspace.revealLeaf(leaf);
          await waitUntil({
            message: `the editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          await view.setState({ ...view.getState(), mode: 'source', source: true }, { history: false });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return view.editor;
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The picker really was seeded with the heading, which is what makes the rest of this test mean anything.
    // Issue #260: the box keeps the cursor when the switch is clicked, matching what `Alt+M` always did.
    expect(result.isBoxFocusedAfterClickingSwitch).toBe(true);

    expect(result.seededValueInCreateMode).toBe('split-picker-mode-seed-heading');

    // The reported bug: `Merge` searches for an EXISTING note, so the name meant for a new one is gone.
    expect(result.valueAfterSwitchingToMerge).toBe('');

    // The reporter's follow-up comment: switching back brings the heading name back.
    expect(result.valueAfterSwitchingBackToCreate).toBe('split-picker-mode-seed-heading');

    // ...and the memory runs both ways, so the merge search the user typed is not lost either.
    expect(result.valueAfterSwitchingToMergeAgain).toBe('split-picker-mode-seed-merge-search');

    // Cancelling created nothing.
    expect(result.wasHeadingNoteCreated).toBe(false);
  });
});
