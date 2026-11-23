import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Issue #315: every note the active note links on a line of its own is merged back in place of its link, in one
// step. The command handler's dialog is `v8 ignore`d UI and the link lookup reads Obsidian's own metadata cache,
// so only the real app shows the batch end to end.
// Isolation: `npx vitest run --project integration-tests:desktop src/merge/linked-notes/merge-linked-notes.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  readonly _children?: ComponentTreeNode[];
  readonly editAndSave?: unknown;
  readonly settings?: MergeLinkedNotesSettings;
}

interface MergeLinkedNotesSettings {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup and callbacks reassign this shared fixture state.
  shouldAskBeforeMerging: boolean;
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Test setup and callbacks reassign this shared fixture state.
  shouldMergeHeadingsByDefault: boolean;
}

interface SettingsCarrier {
  readonly editAndSave: (editor: (settings: MergeLinkedNotesSettings) => void) => Promise<void>;
  readonly settings: MergeLinkedNotesSettings;
}

describe('merging every linked note back at once (issue #315)', () => {
  it('puts each note linked on a line of its own in place of its link, and leaves the rest alone', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        /**
         * Shared by the four waits below, so their sum stays at 20 s, under the transport's ~30 s cap. Each step
         * settles in well under a second.
         */
        const WAIT_TIMEOUT_IN_MILLISECONDS = 5000;
        const TARGET_PATH = 't7197-target.md';

        const settingsComponent = findSettingsComponent();
        const isOriginalShouldAsk = settingsComponent.settings.shouldAskBeforeMerging;
        const isOriginalMergeHeadings = settingsComponent.settings.shouldMergeHeadingsByDefault;

        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = true;
            settings.shouldMergeHeadingsByDefault = false;
          });

          // `t7197-a` links `t7197-b` itself, so once it is merged the target references `t7197-b` twice: the
          // batch has to merge `t7197-b` at its own line all the same.
          await resetFile('t7197-a.md', '---\ntags: alpha\n---\nalpha body links [[t7197-b]]');
          await resetFile('t7197-b.md', 'bravo body');
          await resetFile('t7197-c.md', 'charlie body');
          await resetFile('t7197-d.md', 'delta body');
          const target = await resetFile(
            TARGET_PATH,
            'intro\n[[t7197-a]]\nmiddle\n![[t7197-b]]\nsee [[t7197-c]] here\n[[t7197-d#Part]]\noutro\n'
          );

          await app.workspace.getLeaf(false).openFile(target);
          await waitUntil({
            message: 'the target note did not become active',
            predicate: () => app.workspace.getActiveFile()?.path === TARGET_PATH,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          app.commands.executeCommandById(`${pluginId}:merge-linked-notes-back`);

          let mergeButton: HTMLButtonElement | undefined;
          await waitUntil({
            message: 'the confirmation dialog did not open',
            predicate: () => {
              mergeButton = [...document.querySelectorAll<HTMLButtonElement>('.modal-button-container button')]
                .find((button) => button.textContent === 'Merge');
              return mergeButton !== undefined;
            },
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          const dialogText = mergeButton?.closest('.modal')?.textContent ?? '';
          mergeButton?.click();

          await waitUntil({
            message: 'the batch merge did not complete',
            predicate: () => app.vault.getAbstractFileByPath('t7197-a.md') === null && app.vault.getAbstractFileByPath('t7197-b.md') === null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          return {
            content: await app.vault.read(target),
            dialogText,
            frontmatter: app.metadataCache.getFileCache(target)?.frontmatter ?? null,
            isCKept: app.vault.getAbstractFileByPath('t7197-c.md') !== null,
            isDKept: app.vault.getAbstractFileByPath('t7197-d.md') !== null
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = isOriginalShouldAsk;
            settings.shouldMergeHeadingsByDefault = isOriginalMergeHeadings;
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
            if (typeof node.editAndSave === 'function' && typeof node.settings?.shouldAskBeforeMerging === 'boolean') {
              return node as SettingsCarrier;
            }
            if (node._children) {
              queue.push(...node._children);
            }
          }
          throw new Error('Settings component was not found.');
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

    expect(result.dialogText).toContain('These 2 note(s) will each go in place of its link in');
    expect(result.dialogText).toContain('(line 2)');
    expect(result.dialogText).toContain('(line 4)');
    expect(result.content).toContain('intro\nalpha body links');
    expect(result.content).toContain('\nmiddle\nbravo body\nsee [[t7197-c]] here\n[[t7197-d#Part]]\noutro');
    expect(result.content).not.toContain('advanced-note-composer-move');
    expect(result.frontmatter).toEqual(expect.objectContaining({ tags: 'alpha' }));
    expect(result.isCKept).toBe(true);
    expect(result.isDKept).toBe(true);
  });
});
