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
 * An Extract writes the target, runs `Templater` over it, and only then replaces the extracted text in the
 * SOURCE editor with a link to the target. That editor belongs to a leaf, not to a note, so a user who opened
 * another note in that leaf while a slow template ran had the link written into THAT note, and the source kept
 * its text: the extract turned into a copy, and an unrelated note was edited.
 *
 * A fake `templater-obsidian` stands in for a slow template, and opens another note in the source's leaf while
 * it "renders", which is what a click in the file explorer does. The split must refuse and roll back: the other
 * note untouched, the source still holding its text, and nothing written into the target.
 *
 * Isolation: `npx vitest run --project integration-tests:desktop src/split-navigation-during-templater.desktop.integration.test.ts`.
 */

const PLUGIN_ID = 'advanced-note-composer';

interface ExtractResult {
  readonly decoyContent: string;
  readonly notices: readonly string[];
  readonly sourceContent: string;
  readonly targetContent: null | string;
}

describe('Navigating away from the source while Templater runs', () => {
  it('should refuse the split instead of writing the link into the other note', async () => {
    const result = await runExtract();

    expect(result.decoyContent).toBe('decoy body');
    expect(result.sourceContent).toBe('keep this fragment here');
    // The note the split created before it started stays, emptied again by the rollback.
    expect(result.targetContent).toBe('');
    expect(result.notices.some((notice) => notice.includes('was no longer showing'))).toBe(true);
  });
});

async function runExtract(): Promise<ExtractResult> {
  return await evalInObsidian({
    async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
      /**
       * Every wait here settles in well under a second on a healthy machine. The closure declares four of them,
       * so this keeps the sum at 20 s, well under the transport's ~30 s per-closure cap.
       */
      const WAIT_TIMEOUT_IN_MILLISECONDS = 5000;
      const SETTLE_IN_MILLISECONDS = 300;
      const targetName = 'anc-split-nav-target';
      const targetPath = `${targetName}.md`;

      interface SettingsCarrier {
        editAndSave: (editor: (settings: Record<string, unknown>) => void) => Promise<void>;
        settings: Record<string, unknown>;
      }

      interface ComponentTreeNode {
        _children?: ComponentTreeNode[];
        editAndSave?: unknown;
        settings?: Record<string, unknown>;
      }

      const CHANGED_SETTINGS: Record<string, unknown> = {
        defaultSplitTargetMode: 'Create',
        shouldAskBeforeSplitting: false,
        shouldChooseFolderBeforeNameWhenSplitting: false,
        shouldOpenTargetNoteAfterSplit: false,
        shouldRunTemplaterOnDestinationFile: true,
        textAfterExtractionMode: 'link'
      };

      const settingsComponent = findSettingsComponent();
      // Field by field: the settings object carries a `Map`, which a spread would not restore.
      const originalSettings: Record<string, unknown> = {};
      for (const key of Object.keys(CHANGED_SETTINGS)) {
        originalSettings[key] = settingsComponent.settings[key];
      }
      const pluginsRecord: Record<string, unknown> = app.plugins.plugins;
      const originalTemplaterPlugin = pluginsRecord['templater-obsidian'];
      const notices: string[] = [];
      const noticeObserver = new MutationObserver(() => {
        for (const noticeEl of activeDocument.querySelectorAll('.notice')) {
          const text = noticeEl.textContent;
          if (!notices.includes(text)) {
            notices.push(text);
          }
        }
      });

      try {
        await settingsComponent.editAndSave((settings) => {
          Object.assign(settings, CHANGED_SETTINGS);
        });

        const sourceFile = await app.vault.create('anc-split-nav-source.md', 'keep this fragment here');
        const decoyFile = await app.vault.create('anc-split-nav-decoy.md', 'decoy body');

        pluginsRecord['templater-obsidian'] = {
          templater: {
            // eslint-disable-next-line camelcase -- `Templater`'s own API method name.
            overwrite_file_commands: async (): Promise<void> => {
              // The user clicks another note while the template is still rendering.
              await app.workspace.getLeaf(false).openFile(decoyFile);
              await waitUntil({
                message: 'the decoy note did not open',
                predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file === decoyFile,
                timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
              });
            }
          }
        };

        const editor = await openAndGetEditor(sourceFile);
        // Select "fragment".
        editor.setSelection(editor.offsetToPos(10), editor.offsetToPos(18));
        noticeObserver.observe(activeDocument.body, { childList: true, subtree: true });
        app.commands.executeCommandById(`${pluginId}:extract-current-selection`);
        await waitUntil({ message: 'the split picker did not open', predicate: () => document.querySelector('.prompt-input') !== null, timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS });
        const inputEl = document.querySelector('.prompt-input');
        if (!(inputEl instanceof HTMLInputElement)) {
          throw new TypeError('No split picker input.');
        }
        inputEl.value = targetName;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(SETTLE_IN_MILLISECONDS);
        inputEl.focus();
        // Creates from the typed name whatever the list holds.
        await pressKey({ key: 'Enter', modifiers: ['Mod'] });

        // Either ending settles here: the refusal rolls the target back, the old code leaves its link in the decoy.
        await waitUntil({
          message: 'the split neither refused nor wrote its link',
          predicate: async () => {
            const decoyEditorValue = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor.getValue() ?? '';
            const decoyFileContent = await app.vault.read(decoyFile);
            return decoyEditorValue.includes(`[[${targetName}]]`) || decoyFileContent.includes(targetName)
              || notices.some((notice) => notice.includes('was no longer showing'));
          },
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        await sleep(SETTLE_IN_MILLISECONDS);

        const decoyView = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
        return {
          decoyContent: decoyView?.file === decoyFile ? decoyView.editor.getValue() : await app.vault.read(decoyFile),
          notices,
          sourceContent: await app.vault.read(sourceFile),
          targetContent: await readIfExists(targetPath)
        };
      } finally {
        noticeObserver.disconnect();
        pluginsRecord['templater-obsidian'] = originalTemplaterPlugin;
        await settingsComponent.editAndSave((settings) => {
          Object.assign(settings, originalSettings);
        });
      }

      async function readIfExists(path: string): Promise<null | string> {
        const file = app.vault.getFileByPath(path);
        return file ? await app.vault.read(file) : null;
      }

      async function openAndGetEditor(file: TFile): Promise<Editor> {
        await app.workspace.getLeaf(false).openFile(file);
        await waitUntil({
          message: 'the source editor did not open',
          predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file === file,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
        if (!view) {
          throw new Error('No active markdown view.');
        }
        return view.editor;
      }

      function findSettingsComponent(): SettingsCarrier {
        const plugin = app.plugins.getPlugin(pluginId) as ComponentTreeNode | null;
        const queue: ComponentTreeNode[] = plugin ? [plugin] : [];
        while (queue.length > 0) {
          const node = queue.shift();
          if (!node) {
            continue;
          }
          if (typeof node.editAndSave === 'function' && typeof node.settings?.['splitTemplate'] === 'string') {
            return node as SettingsCarrier;
          }
          if (node._children) {
            queue.push(...node._children);
          }
        }
        throw new Error('Settings component was not found.');
      }
    },
    input: { pluginId: PLUGIN_ID },
    vaultPath: getTemporaryVault().path
  });
}
