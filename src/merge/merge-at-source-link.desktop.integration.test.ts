import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Discussion #310: an extracted note is merged back into the place its residual link holds. The picker and the
// confirmation dialog are `v8 ignore`d UI, so only the real app shows the checkbox reaching the composer and the
// dialog naming the link's line.
// Isolation: `npx vitest run --project integration-tests:desktop src/merge/merge-at-source-link.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  readonly _children?: ComponentTreeNode[];
  readonly editAndSave?: unknown;
  readonly settings?: MergeAtLinkSettings;
}

interface MergeAtLinkSettings {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup and callbacks reassign this shared fixture state.
  shouldAllowOnlyCurrentFolderByDefault: boolean;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup and callbacks reassign this shared fixture state.
  shouldAskBeforeMerging: boolean;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup and callbacks reassign this shared fixture state.
  shouldMergeAtSourceLinkByDefault: boolean;
}

interface SettingsCarrier {
  readonly editAndSave: (editor: (settings: MergeAtLinkSettings) => void) => Promise<void>;
  readonly settings: MergeAtLinkSettings;
}

describe('merging a note at its residual link (discussion #310)', () => {
  it('puts the note in place of its sole link, and appends when the checkbox is off', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        /**
         * Shared by every wait below. The closure declares nine (two passes of four, plus the dialog), so 2500 ms
         * each keeps the sum at 22.5 s, under the transport's ~30 s cap. Each step settles in well under a second.
         */
        const WAIT_TIMEOUT_IN_MILLISECONDS = 2500;
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const SOURCE_PATH = 't5758-source.md';
        const TARGET_PATH = 't5758-target.md';
        const TARGET_CONTENT = 'intro\n[[t5758-source]]\noutro';

        const settingsComponent = findSettingsComponent();
        const isOriginalShouldAsk = settingsComponent.settings.shouldAskBeforeMerging;
        const isOriginalOnlyCurrentFolder = settingsComponent.settings.shouldAllowOnlyCurrentFolderByDefault;
        const isOriginalMergeAtLink = settingsComponent.settings.shouldMergeAtSourceLinkByDefault;

        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = true;
            settings.shouldAllowOnlyCurrentFolderByDefault = false;
            settings.shouldMergeAtSourceLinkByDefault = true;
          });

          let source = await resetFile(SOURCE_PATH, 'source body');
          let target = await resetFile(TARGET_PATH, TARGET_CONTENT);
          await openPicker(source);
          await chooseTargetInPicker();
          const dialogText = await confirmMerge();
          await waitForMerge();
          const contentAtLink = await app.vault.read(target);

          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = false;
            settings.shouldMergeAtSourceLinkByDefault = false;
          });

          source = await resetFile(SOURCE_PATH, 'source body');
          target = await resetFile(TARGET_PATH, TARGET_CONTENT);
          await openPicker(source);
          await chooseTargetInPicker();
          await waitForMerge();
          const contentAppended = await app.vault.read(target);

          return { contentAppended, contentAtLink, dialogText };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = isOriginalShouldAsk;
            settings.shouldAllowOnlyCurrentFolderByDefault = isOriginalOnlyCurrentFolder;
            settings.shouldMergeAtSourceLinkByDefault = isOriginalMergeAtLink;
          });
        }

        async function chooseTargetInPicker(): Promise<void> {
          const query = 't5758-target';
          const input = getPickerInput();
          input.value = query;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: 'the target did not appear as a suggestion',
            predicate: () => [...document.querySelectorAll('.suggestion-title')].some((el) => el.textContent.includes(query)),
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          input.focus();
          await pressKey({ key: 'Enter' });
        }

        async function confirmMerge(): Promise<string> {
          let mergeButton: HTMLButtonElement | undefined;
          await waitUntil({
            message: 'the merge confirmation dialog did not open',
            predicate: () => {
              mergeButton = [...document.querySelectorAll<HTMLButtonElement>('.modal-button-container button')]
                .find((button) => button.textContent === 'Merge');
              return mergeButton !== undefined;
            },
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          const text = mergeButton?.closest('.modal')?.textContent ?? '';
          mergeButton?.click();
          return text;
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

        function getPickerInput(): HTMLInputElement {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No merge picker input.');
          }
          return input;
        }

        function isSettingsComponent(node: ComponentTreeNode): node is SettingsCarrier {
          return typeof node.editAndSave === 'function'
            && typeof node.settings?.shouldMergeAtSourceLinkByDefault === 'boolean';
        }

        async function openPicker(sourceFile: TFile): Promise<void> {
          await app.workspace.getLeaf(false).openFile(sourceFile);
          await waitUntil({
            message: 'the source note did not become active',
            predicate: () => app.workspace.getActiveFile()?.path === SOURCE_PATH,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          app.commands.executeCommandById(`${pluginId}:merge-file`);
          await waitUntil({
            message: 'the merge picker did not open',
            predicate: () => document.querySelector('.prompt') !== null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        }

        async function resetFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          return app.vault.create(path, content);
        }

        async function waitForMerge(): Promise<void> {
          await waitUntil({
            message: 'the merge did not complete',
            predicate: () => app.vault.getAbstractFileByPath(SOURCE_PATH) === null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    expect(result.dialogText).toContain('will go in place of its link on line 2 of');
    expect(result.contentAtLink).toContain('intro\nsource body\noutro');
    expect(result.contentAtLink).not.toContain('[[t5758-source');
    expect(result.contentAppended).toContain('intro\n');
    expect(result.contentAppended.trimEnd().endsWith('source body')).toBe(true);
  });
});
