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

/**
 * Issue #115: a heading written with two spaces after its `#` run (`##  Title of note`) reportedly named the
 * extracted note `_Title of note` and lost its content. This replays the report's steps in real Obsidian,
 * with the report's own split template, through both commands it names.
 *
 * The settings written here are RESTORED in a `finally`: `data.json` is shared by the whole aggregate run.
 *
 * Isolation: `npx vitest run --project integration-tests:desktop src/split/extract/heading-with-extra-space-extract.desktop.integration.test.ts`.
 */

const PLUGIN_ID = 'advanced-note-composer';

const HEADING_TEXT = 'Issue 115 title of note';
const SOURCE_CONTENT = `##  ${HEADING_TEXT}\n- first bullet\n    - indented bullet\n    - second indented bullet\n- last bullet\n`;
const SPLIT_TEMPLATE = '> [!bc]\n> up:: [[{{fromTitle}}]]\n#inbox\n\n {{content}}';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: ExtractSettings;
}

interface ExtractResult {
  readonly createdPaths: string[];
  readonly extractedContent: string;
  readonly sourceContent: string;
}

interface ExtractSettings {
  defaultSplitTargetMode: string;
  shouldAskBeforeSplitting: boolean;
  shouldAskForTargetFolderWhenSplitting: boolean;
  shouldChooseFolderBeforeNameWhenSplitting: boolean;
  shouldSplitIntoFolder: boolean;
  splitTemplate: string;
}

interface SettingsCarrier {
  editAndSave: (editor: (settings: ExtractSettings) => void) => Promise<void>;
  settings: ExtractSettings;
}

function expectExtracted(result: ExtractResult): void {
  // Named after the heading's TEXT: the second space is not part of it, so no `_` prefix.
  expect(result.createdPaths).toEqual([`${HEADING_TEXT}.md`]);
  // Nothing was lost: the template is applied around every bullet.
  expect(result.extractedContent).toContain('up:: [[heading-with-extra-space-source]]');
  expect(result.extractedContent).toContain('- first bullet');
  expect(result.extractedContent).toContain('    - indented bullet');
  expect(result.extractedContent).toContain('    - second indented bullet');
  expect(result.extractedContent).toContain('- last bullet');
  // The source keeps a link to the extracted note in place of the section.
  expect(result.sourceContent).toContain(`[[${HEADING_TEXT}]]`);
}

async function runExtract(commandId: string, shouldSelectAll: boolean): Promise<ExtractResult> {
  return await evalInObsidian({
    async callback({ app, commandId: command, headingText, lib: { pressKey, waitUntil }, obsidianModule, pluginId, shouldSelectAll: selectAll, sourceContent, splitTemplate }) {
      // Six waits at the harness's 5_000 default plus two short settles: well under the ~30 s closure cap.
      const RENDER_DELAY_IN_MILLISECONDS = 400;
      const SOURCE_PATH = 'heading-with-extra-space-source.md';

      const settingsComponent = findSettingsComponent();
      const original = {
        defaultSplitTargetMode: settingsComponent.settings.defaultSplitTargetMode,
        shouldAskBeforeSplitting: settingsComponent.settings.shouldAskBeforeSplitting,
        shouldAskForTargetFolderWhenSplitting: settingsComponent.settings.shouldAskForTargetFolderWhenSplitting,
        shouldChooseFolderBeforeNameWhenSplitting: settingsComponent.settings.shouldChooseFolderBeforeNameWhenSplitting,
        shouldSplitIntoFolder: settingsComponent.settings.shouldSplitIntoFolder,
        splitTemplate: settingsComponent.settings.splitTemplate
      };
      try {
        await settingsComponent.editAndSave((settings) => {
          settings.defaultSplitTargetMode = 'Create';
          settings.shouldAskBeforeSplitting = false;
          settings.shouldAskForTargetFolderWhenSplitting = false;
          settings.shouldChooseFolderBeforeNameWhenSplitting = false;
          settings.shouldSplitIntoFolder = false;
          settings.splitTemplate = splitTemplate;
        });

        const pathsBefore = new Set(app.vault.getMarkdownFiles().map((file) => file.path));
        const source = await resetFile(SOURCE_PATH, sourceContent);
        const editor = await openAndGetEditor(source);
        editor.setValue(sourceContent);
        await waitUntil({
          message: 'the heading cache did not catch up with the reset content',
          predicate: () => app.metadataCache.getFileCache(source)?.headings?.[0]?.heading === headingText
        });
        if (selectAll) {
          editor.setSelection({ ch: 0, line: 0 }, { ch: 0, line: editor.lineCount() - 1 });
        } else {
          editor.setCursor({ ch: 2, line: 2 });
        }

        app.commands.executeCommandById(`${pluginId}:${command}`);
        await waitUntil({
          message: 'the split picker did not open',
          predicate: () => document.querySelector('.prompt-input') instanceof HTMLInputElement
        });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        // Accept the SEEDED name, exactly as the reporter did: `Mod+Enter` creates from what the box holds.
        const input = document.querySelector('.prompt-input');
        if (!(input instanceof HTMLInputElement)) {
          throw new TypeError('No split picker input.');
        }
        input.focus();
        await pressKey({ key: 'Enter', modifiers: ['Mod'] });

        await waitUntil({
          message: 'no note was created',
          predicate: () => app.vault.getMarkdownFiles().some((file) => !pathsBefore.has(file.path) && file.path !== SOURCE_PATH)
        });
        await waitUntil({
          message: 'the bullets never left the source note',
          predicate: () => !editor.getValue().includes('first bullet')
        });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        const created = app.vault.getMarkdownFiles().filter((file) => !pathsBefore.has(file.path) && file.path !== SOURCE_PATH);
        const extractedContent = created[0] ? await app.vault.read(created[0]) : 'MISSING';
        const createdPaths = created.map((file) => file.path);
        for (const file of created) {
          await app.fileManager.trashFile(file);
        }
        return { createdPaths, extractedContent, sourceContent: editor.getValue() };
      } finally {
        await settingsComponent.editAndSave((settings) => {
          Object.assign(settings, original);
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
          if (typeof node.editAndSave === 'function' && typeof node.settings?.defaultSplitTargetMode === 'string') {
            return node as SettingsCarrier;
          }
          if (node._children) {
            queue.push(...node._children);
          }
        }
        throw new Error('Settings component was not found.');
      }

      async function openAndGetEditor(file: TFile): Promise<Editor> {
        await app.workspace.getLeaf(false).openFile(file);
        await waitUntil({
          message: `markdown view for ${file.path} did not become active`,
          predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
        });
        const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
        if (!view) {
          throw new Error('No active markdown view.');
        }
        return view.editor;
      }

      async function resetFile(path: string, content: string): Promise<TFile> {
        const existing = app.vault.getAbstractFileByPath(path);
        if (existing instanceof obsidianModule.TFile) {
          await app.vault.modify(existing, content);
          return existing;
        }
        return await app.vault.create(path, content);
      }
    },
    input: {
      commandId,
      headingText: HEADING_TEXT,
      pluginId: PLUGIN_ID,
      shouldSelectAll,
      sourceContent: SOURCE_CONTENT,
      splitTemplate: SPLIT_TEMPLATE
    },
    vaultPath: getTemporaryVault().path
  });
}

describe('extracting a heading written with an extra space (issue #115)', () => {
  it('names the note after the heading and keeps its content, from a selection', async () => {
    expectExtracted(await runExtract('extract-current-selection', true));
  });

  it('names the note after the heading and keeps its content, from the heading body', async () => {
    expectExtracted(await runExtract('extract-this-heading', false));
  });
});
