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

/*
 * Coverage for issue #184: `Should offer the current note when splitting` controls whether the note being
 * split from appears in the split/extract picker. It defaults to ON, because picking the current note is
 * the only way to extract a selection to that note's own top or bottom - `Switch to smart cut & paste`
 * moves to the cursor instead, so it is not a replacement.
 *
 * Isolation: `npx vitest run --project integration-tests:desktop src/split-picker-current-note.desktop.integration.test.ts`.
 */

const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: SplitPickerSettings;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: SplitPickerSettings) => void): Promise<void>;
  settings: SplitPickerSettings;
}

interface SplitPickerSettings {
  shouldAskBeforeSplitting: boolean;
  shouldOfferCurrentNoteWhenSplitting: boolean;
}

describe('offering the current note in the split picker (issue #184)', () => {
  it('should list the current note only when the setting is on', async () => {
    const result = await evalInObsidian({
      // eslint-disable-next-line unicorn/name-replacements -- `args` is an `obsidian-integration-testing` parameter name.
      args: { pluginId: PLUGIN_ID },
      // eslint-disable-next-line unicorn/name-replacements -- `fn` is an `obsidian-integration-testing` parameter name.
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const SOURCE_BASENAME = 'split-picker-current-source';
        const SOURCE_PATH = `${SOURCE_BASENAME}.md`;
        const OTHER_PATH = 'split-picker-current-other.md';
        const sourceContent = 'first line\nextract me\nlast line\n';

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeSplitting = false;
          });

          await resetFile(SOURCE_PATH, sourceContent);
          await resetFile(OTHER_PATH, 'other body');

          return {
            whenOff: await doesListCurrentNote(false),
            whenOn: await doesListCurrentNote(true)
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeSplitting = original.shouldAskBeforeSplitting;
            settings.shouldOfferCurrentNoteWhenSplitting = original.shouldOfferCurrentNoteWhenSplitting;
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
          return typeof node.editAndSave === 'function' && typeof node.settings?.shouldOfferCurrentNoteWhenSplitting === 'boolean';
        }

        async function doesListCurrentNote(shouldOffer: boolean): Promise<boolean> {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldOfferCurrentNoteWhenSplitting = shouldOffer;
          });

          const file = app.vault.getFileByPath(SOURCE_PATH);
          if (!file) {
            throw new Error(`No file at ${SOURCE_PATH}.`);
          }
          const editor = await openInSourceMode(file);
          editor.setSelection(
            editor.offsetToPos(sourceContent.indexOf('extract me')),
            editor.offsetToPos(sourceContent.indexOf('extract me') + 'extract me'.length)
          );

          app.commands.executeCommandById(`${pluginId}:extract-current-selection`);
          await waitUntil({
            message: 'the split picker did not open',
            predicate: () => document.querySelector('.prompt') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No split picker input.');
          }
          // Query for the shared prefix so both notes are candidates: the OTHER note appearing is what proves
          // The picker actually ran its search, rather than the current note being missing for some other reason.
          input.value = 'split-picker-current';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: 'no suggestion appeared for the query',
            predicate: () => [...document.querySelectorAll('.suggestion-title')].some((el) => el.textContent.includes('split-picker-current'))
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const titles = [...document.querySelectorAll('.suggestion-title')].map((el) => el.textContent);
          const isCurrentNoteListed = titles.some((title) => title.includes(SOURCE_BASENAME));

          input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'Escape', key: 'Escape' }));
          await waitUntil({
            message: 'the split picker did not close',
            predicate: () => document.querySelector('.prompt') === null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          return isCurrentNoteListed;
        }

        async function openInSourceMode(file: TFile): Promise<Editor> {
          const leaf = app.workspace.getLeaf(false);
          await leaf.openFile(file);
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

        async function resetFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          return app.vault.create(path, content);
        }
      },
      vaultPath: getTempVault().path
    });

    expect(result.whenOn).toBe(true);
    expect(result.whenOff).toBe(false);
  });
});
