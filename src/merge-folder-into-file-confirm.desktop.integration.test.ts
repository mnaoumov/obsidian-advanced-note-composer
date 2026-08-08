import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// The merge-folder-into-file confirmation dialog is v8-ignored modal UI (`modals/merge-folder-into-file-modal.ts`),
// So this drives the REAL dialog DOM against a real Obsidian (issue #166). The merged note is created only
// AFTER the dialog is confirmed, so rendering its path as an internal link made a click CREATE it — the
// Settled rule is `link when the path already exists, code block when it does not`, and only a real Obsidian
// Proves which element type came out (the unit test mocks both renderers).
// Separate from `merge-folder-into-file.desktop.integration.test.ts` on purpose: this case cancels, so it
// Never moves or deletes a file and stays clear of the headless rename wall that suite warns about.
// G99: this asserts public-API modal DOM (`.modal-content` `code`/`a`), not Obsidian internals, so one end
// Would suffice — but it was run on BOTH anyway: catalyst-latest 1.13.4 and public-latest 1.12.7. Pin the
// Other end with the desktop project's `environmentOptions.obsidianTransport.obsidianVersion`.
// Isolation: `npx vitest run --project integration-tests:desktop src/merge-folder-into-file-confirm.desktop.integration.test.ts`.

const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: MergeSettings;
}

interface MergeSettings {
  shouldAskBeforeMerging: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: MergeSettings) => void): Promise<void>;
  settings: MergeSettings;
}

describe('merge folder into file confirmation dialog (issue #166)', () => {
  it('renders the not-yet-created target as a code block, so the dialog cannot create it', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const settingsComponent = findSettingsComponent();
        const isOriginalShouldAsk = settingsComponent.settings.shouldAskBeforeMerging;
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = true;
          });

          await trashIfExists('merge-confirm');
          await trashIfExists('merge-confirm.md');

          await app.vault.createFolder('merge-confirm');
          const note = await app.vault.create('merge-confirm/note.md', 'note body');
          await openFile(note);

          app.commands.executeCommandById(`${pluginId}:merge-folder-into-file`);

          await waitUntil({ message: 'merge dialog did not open', predicate: () => findButton('Merge') !== null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          // The folder exists, so it is the ONE anchor in the body; the target note does not exist yet, so it
          // Must be a code block among the field labels.
          const linkTexts = [...document.querySelectorAll('.modal-content a')].map((el) => el.textContent);
          const codeTexts = [...document.querySelectorAll('.modal-content code')].map((el) => el.textContent);

          findButton('Cancel')?.click();
          await waitUntil({ message: 'dialog did not close', predicate: () => document.querySelector('.modal-button-container') === null });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const isTargetNotCreated = app.vault.getAbstractFileByPath('merge-confirm.md') === null;
          const isSourceUntouched = app.vault.getAbstractFileByPath('merge-confirm/note.md') !== null;

          return { codeTexts, linkTexts, sourceUntouched: isSourceUntouched, targetNotCreated: isTargetNotCreated };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = isOriginalShouldAsk;
          });
        }

        function findButton(text: string): HTMLButtonElement | null {
          for (const el of document.querySelectorAll('.modal-button-container button')) {
            if (el.instanceOf(HTMLButtonElement) && el.textContent === text) {
              return el;
            }
          }
          return null;
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
          return typeof node.editAndSave === 'function' && typeof node.settings?.shouldAskBeforeMerging === 'boolean';
        }

        async function openFile(file: TFile): Promise<void> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
          });
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // Issue #166: the target is a code block, NOT an anchor — before the fix `renderInternalLink` rendered
    // `[[merge-confirm.md|merge-confirm.md]]`, so the target's path showed up in the anchor texts.
    expect(result.codeTexts).toContain('merge-confirm.md');
    expect(result.linkTexts).not.toContain('merge-confirm.md');
    // The source folder stays a link (issue #165), and it is the only one in the body.
    expect(result.linkTexts).toStrictEqual(['merge-confirm']);
    // Nothing was created by merely opening and cancelling the dialog.
    expect(result.targetNotCreated).toBe(true);
    expect(result.sourceUntouched).toBe(true);
  });
});
