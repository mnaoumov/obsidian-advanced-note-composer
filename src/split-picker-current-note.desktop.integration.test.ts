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
  editAndSave: (editor: (settings: SplitPickerSettings) => void) => Promise<void>;
  settings: SplitPickerSettings;
}

interface SplitPickerSettings {
  shouldAskBeforeSplitting: boolean;
  shouldOfferCurrentNoteWhenSplitting: boolean;
}

describe('offering the current note in the split picker (issue #184)', () => {
  it('should list the current note only when the setting is on', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        /**
         * Sized so the SUM of every wait this closure declares stays under the transport's ~30 s per-closure
         * cap, not at it. Before this shared budget it declared 44 000 ms, so the eval could only ever die
         * as a bare transport timeout - which names the harness rather than the wait that overran. Every step
         * waited for here settles in well under a second on a healthy machine. A helper that waits is charged
         * once per CALL SITE, so adding a call to one adds a whole ceiling: re-divide this budget by the new
         * count, not by the `waitUntil` calls the body shows.
         */
        const WAIT_TIMEOUT_IN_MILLISECONDS = 2625;
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
            predicate: () => document.querySelector('.prompt') !== null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // Extracting into the note you are already in is a MERGE into an existing note, so since the
          // create/merge switch made the mode explicit (issue #227) this setting only decides anything in
          // `Merge` mode - `Create` never offers an existing note as a target.
          const modeToggle = document.querySelector('.advanced-note-composer-split-target-mode .checkbox-container');
          if (!(modeToggle instanceof HTMLElement)) {
            throw new TypeError('No create/merge switch in the split picker.');
          }
          if (!modeToggle.classList.contains('is-enabled')) {
            modeToggle.click();
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No split picker input.');
          }
          // Query for the shared prefix so both notes are candidates: the OTHER note appearing is what proves
          // the picker actually ran its search, rather than the current note being missing for some other reason.
          input.value = 'split-picker-current';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: 'no suggestion appeared for the query',
            predicate: () => [...document.querySelectorAll('.suggestion-title')].some((el) => el.textContent.includes('split-picker-current')),
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const titles = [...document.querySelectorAll('.suggestion-title')].map((el) => el.textContent);
          const isCurrentNoteListed = titles.some((title) => title.includes(SOURCE_BASENAME));

          input.focus();
          await pressKey({ key: 'Escape' });
          await waitUntil({
            message: 'the split picker did not close',
            predicate: () => document.querySelector('.prompt') === null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          return isCurrentNoteListed;
        }

        async function openInSourceMode(file: TFile): Promise<Editor> {
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
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    expect(result.whenOn).toBe(true);
    expect(result.whenOff).toBe(false);
  });
});
