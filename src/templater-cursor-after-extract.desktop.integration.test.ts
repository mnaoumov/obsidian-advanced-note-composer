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
 * Issue #301: `Split template` = `<% tp.file.cursor() %> {{content}}`, and the note an Extract created kept the
 * raw `<% tp.file.cursor() %>` — read by the reporter as "Templater does not trigger". Templater DID run:
 * `tp.file.cursor()` renders to that very marker, and Templater consumes it only with a separate cursor jump in
 * the ACTIVE editor, while the plugin renders the destination before the note is ever opened.
 *
 * Templater is not installed in the test vault, so a fake `templater-obsidian` stands in, reproducing the two
 * halves of the real one that matter here (both checked against Templater 2.25.0): rendering leaves the marker
 * in the note, and `editor_handler.jump_to_next_cursor_location(file, true)` does nothing unless `file` is the
 * active note, where it removes the marker and puts the caret there. The real plugin was also driven through
 * this exact flow while fixing it, with the same outcome.
 *
 * Isolation: `npx vitest run --project integration-tests:desktop src/templater-cursor-after-extract.desktop.integration.test.ts`.
 */

const PLUGIN_ID = 'advanced-note-composer';

interface ExtractInput {
  readonly shouldOpenTargetNoteAfterSplit: boolean;
  readonly targetName: string;
}

interface ExtractResult {
  readonly contentAfterExtract: string;
  readonly cursorOffset: null | number;
  readonly editorValueAfterOpen: null | string;
  readonly jumpCalls: readonly string[];
}

describe('Templater cursor in a note created by Extract (issue #301)', () => {
  it('should consume the cursor marker when the note is opened later', async () => {
    const result = await runExtract({ shouldOpenTargetNoteAfterSplit: false, targetName: 'anc-301-opened-later' });

    // The render ran while the note was closed, so the marker is still in it...
    expect(result.contentAfterExtract).toBe('head\n<% tp.file.cursor() %>\nfragment');
    // ...and opening the note is what consumes it, with the caret where it was.
    expect(result.jumpCalls).toEqual(['anc-301-opened-later.md']);
    expect(result.editorValueAfterOpen).toBe('head\n\nfragment');
    expect(result.cursorOffset).toBe('head\n'.length);
  });

  it('should consume the cursor marker when the split opens the note itself', async () => {
    const result = await runExtract({ shouldOpenTargetNoteAfterSplit: true, targetName: 'anc-301-opened-by-split' });

    expect(result.jumpCalls).toEqual(['anc-301-opened-by-split.md']);
    expect(result.editorValueAfterOpen).toBe('head\n\nfragment');
    expect(result.cursorOffset).toBe('head\n'.length);
  });
});

async function runExtract(input: ExtractInput): Promise<ExtractResult> {
  return await evalInObsidian({
    async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId, shouldOpenTargetNoteAfterSplit, targetName }) {
      /**
       * Every wait here settles in well under a second on a healthy machine. The closure declares four of them,
       * so this keeps the sum near 14 s, well under the transport's ~30 s per-closure cap.
       */
      const WAIT_TIMEOUT_IN_MILLISECONDS = 3500;
      const SETTLE_IN_MILLISECONDS = 300;
      const MARKER = '<% tp.file.cursor() %>';
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
        shouldOpenTargetNoteAfterSplit,
        shouldRunTemplaterOnDestinationFile: true,
        splitTemplate: `head\n${MARKER}\n{{content}}`
      };

      const settingsComponent = findSettingsComponent();
      // Field by field: the settings object carries a `Map`, which a spread would not restore.
      const originalSettings: Record<string, unknown> = {};
      for (const key of Object.keys(CHANGED_SETTINGS)) {
        originalSettings[key] = settingsComponent.settings[key];
      }
      const pluginsRecord: Record<string, unknown> = app.plugins.plugins;
      const originalTemplaterPlugin = pluginsRecord['templater-obsidian'];
      const jumpCalls: string[] = [];

      try {
        await settingsComponent.editAndSave((settings) => {
          Object.assign(settings, CHANGED_SETTINGS);
        });
        pluginsRecord['templater-obsidian'] = {
          // eslint-disable-next-line camelcase -- Templater's own API property name.
          editor_handler: {
            // eslint-disable-next-line camelcase -- Templater's own API method name.
            jump_to_next_cursor_location: async (file: null | TFile): Promise<void> => {
              if (file && app.workspace.getActiveFile() !== file) {
                return;
              }
              const editor = app.workspace.activeEditor?.editor;
              if (!editor) {
                return;
              }
              jumpCalls.push(file?.path ?? '');
              const value = editor.getValue();
              const offset = value.indexOf(MARKER);
              if (offset === -1) {
                return;
              }
              editor.setValue(value.slice(0, offset) + value.slice(offset + MARKER.length));
              editor.setCursor(editor.offsetToPos(offset));
              // Templater awaits a render delay here; one tick stands in for it.
              await sleep(0);
            }
          },
          templater: {
            // `tp.file.cursor()` renders to its own marker, so the rendered note is the note as written.
            // eslint-disable-next-line camelcase -- Templater's own API method name.
            overwrite_file_commands: async (file: TFile): Promise<void> => {
              await app.vault.modify(file, await app.vault.read(file));
            }
          }
        };

        const sourceFile = await app.vault.create(`${targetName}-source.md`, 'keep this fragment here');
        const editor = await openAndGetEditor(sourceFile);
        // Select "fragment".
        editor.setSelection(editor.offsetToPos(10), editor.offsetToPos(18));
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

        await waitUntil({
          message: `the extract did not write ${targetPath}`,
          predicate: async () => {
            const content = await readIfExists(targetPath);
            return content.includes('fragment');
          },
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        const contentAfterExtract = await readIfExists(targetPath);

        if (!shouldOpenTargetNoteAfterSplit) {
          const targetFile = app.vault.getFileByPath(targetPath);
          if (!targetFile) {
            throw new Error(`${targetPath} is missing.`);
          }
          await app.workspace.getLeaf(false).openFile(targetFile);
        }

        await waitUntil({
          message: 'the cursor marker was not consumed when the note opened',
          predicate: () => {
            const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
            return view?.file?.path === targetPath && !view.editor.getValue().includes(MARKER);
          },
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);

        return {
          contentAfterExtract,
          cursorOffset: view ? view.editor.posToOffset(view.editor.getCursor()) : null,
          editorValueAfterOpen: view?.editor.getValue() ?? null,
          jumpCalls
        };
      } finally {
        pluginsRecord['templater-obsidian'] = originalTemplaterPlugin;
        await settingsComponent.editAndSave((settings) => {
          Object.assign(settings, originalSettings);
        });
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

      async function readIfExists(path: string): Promise<string> {
        const file = app.vault.getFileByPath(path);
        return file ? await app.vault.read(file) : '';
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
    input: { pluginId: PLUGIN_ID, ...input },
    vaultPath: getTemporaryVault().path
  });
}
