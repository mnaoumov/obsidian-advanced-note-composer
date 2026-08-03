import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only: it drives a real folder-move flow and reads the rendered notice out of the DOM, neither
// Of which the Android transport covers.
// Isolation: `npx vitest run --project integration-tests:desktop src/operation-notices.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: OperationNoticeSettings;
}

interface OperationNoticeSettings {
  shouldAskBeforeFlattening: boolean;
  shouldShowOperationNotices: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: OperationNoticeSettings) => void): Promise<void>;
  settings: OperationNoticeSettings;
}

/*
 * Issue #182: every operation must say what it did. `Flatten folder...` is the sample — it was one of the
 * silent ones, and it is the only vault-restructuring command that runs end to end with no picker or
 * modal in the way (with its confirmation turned off), so the notice is what the test can observe.
 */
describe('operation notices (issue #182)', () => {
  it('reports a finished operation, and stays silent when the setting is off', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        // Doubles as the silence window for the setting-off run: long enough that a notice would have
        // Rendered had one been shown, so timing out there means none was.
        const NOTICE_TIMEOUT_IN_MILLISECONDS = 5000;

        const settingsComponent = findSettingsComponent();
        const originalShouldAsk = settingsComponent.settings.shouldAskBeforeFlattening;
        const originalShouldShow = settingsComponent.settings.shouldShowOperationNotices;
        try {
          await settingsComponent.editAndSave((settings) => {
            // The confirmation dialog is covered elsewhere; skipping it lets the flatten run straight
            // From the command, so the notice is the only thing this test has to wait on.
            settings.shouldAskBeforeFlattening = false;
            settings.shouldShowOperationNotices = true;
          });

          const noticeText = await runFlattenAndReadNotice('notice-on');

          await settingsComponent.editAndSave((settings) => {
            settings.shouldShowOperationNotices = false;
          });

          const silentText = await runFlattenAndReadNotice('notice-off');

          return { noticeText, silentText };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeFlattening = originalShouldAsk;
            settings.shouldShowOperationNotices = originalShouldShow;
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

        /**
         * Finds the notice reporting THIS run's flatten. Notices render into `activeDocument`, NOT
         * `document` — reading the latter is reliably empty here. Matching on the run's own folder name
         * rather than just `Flattened folder` is what keeps the setting-off run from reading the
         * setting-on run's notice, which lingers for its full duration.
         *
         * @param prefix - The run's path prefix.
         * @returns The notice text, or `null` when this run has shown none.
         */
        function findOperationNoticeText(prefix: string): null | string {
          for (const noticeEl of Array.from(activeDocument.querySelectorAll('.notice'))) {
            const text = noticeEl.textContent;
            if (text.includes(`Flattened folder ${prefix}-src`)) {
              return text;
            }
          }
          return null;
        }

        function isSettingsComponent(node: ComponentTreeNode): node is SettingsCarrier {
          return typeof node.editAndSave === 'function' && typeof node.settings?.shouldShowOperationNotices === 'boolean';
        }

        async function openFile(file: TFile): Promise<void> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
          });
        }

        /**
         * Builds a fresh folder holding one note, flattens it, and returns the operation notice's text.
         *
         * @param prefix - Distinguishes this run's paths from the other run's, so neither sees the other's
         * leftovers.
         * @returns The notice text, or `null` when no operation notice was shown.
         */
        async function runFlattenAndReadNotice(prefix: string): Promise<null | string> {
          await trashIfExists(`${prefix}-src`);
          await trashIfExists(`${prefix}-note.md`);

          await app.vault.createFolder(`${prefix}-src`);
          const note = await app.vault.create(`${prefix}-src/${prefix}-note.md`, 'body');
          await openFile(note);

          app.commands.executeCommandById(`${pluginId}:flatten-folder`);

          await waitUntil({
            message: 'the note was not promoted to the root',
            predicate: () => app.vault.getAbstractFileByPath(`${prefix}-note.md`) !== null
          });

          try {
            await waitUntil({
              message: 'no operation notice was shown',
              predicate: () => findOperationNoticeText(prefix) !== null,
              timeoutInMilliseconds: NOTICE_TIMEOUT_IN_MILLISECONDS
            });
          } catch {
            // Give-up wrapper: the caller asserts on what was (not) captured, so a timeout must not
            // Discard the observation by throwing out of the closure.
            return null;
          }
          return findOperationNoticeText(prefix);
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }
      },
      vaultPath: getTempVault().path
    });

    // With the setting on, the finished flatten names both the folder and where its children landed.
    expect(result.noticeText).toContain('Flattened folder');
    expect(result.noticeText).toContain('promoting 1 item(s)');
    // With the setting off, the same operation runs but says nothing.
    expect(result.silentText).toBeNull();
  });
});
