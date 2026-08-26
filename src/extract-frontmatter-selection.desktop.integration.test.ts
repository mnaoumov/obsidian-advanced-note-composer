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

// Desktop-only, matching the plugin's established integration convention.
// Isolation: `npx vitest run --project integration-tests:desktop src/extract-frontmatter-selection.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: FrontmatterSelectionSettings;
}

interface FrontmatterSelectionSettings {
  shouldAskBeforeSplitting: boolean;
  shouldExtractFrontmatterSelectionAsProperties: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: FrontmatterSelectionSettings) => void): Promise<void>;
  settings: FrontmatterSelectionSettings;
}

describe('extracting a properties selection (issue #183)', () => {
  it('should merge the selected values into the destination note\'s properties instead of its body', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const SOURCE_PATH = 'fm-extract-source.md';
        const TARGET_PATH = 'fm-extract-target.md';

        const sourceContent = [
          '---',
          'aliases:',
          '  - alpha',
          '  - bravo',
          '  - charlie',
          'tags:',
          '  - keep',
          '---',
          '',
          'source body',
          ''
        ].join('\n');
        const targetContent = ['---', 'aliases:', '  - existing', '---', '', 'target body', ''].join('\n');

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeSplitting = false;
            settings.shouldExtractFrontmatterSelectionAsProperties = true;
          });

          const sourceFile = await resetFile(SOURCE_PATH, sourceContent);
          const targetFile = await resetFile(TARGET_PATH, targetContent);

          // The selection starts INSIDE the first value, exactly as the reporter's screenshot shows, and
          // Ends at the end of the second one.
          const editor = await openInSourceMode(sourceFile);
          editor.setSelection(
            editor.offsetToPos(sourceContent.indexOf('alpha') + 'al'.length),
            editor.offsetToPos(sourceContent.indexOf('bravo') + 'bravo'.length)
          );

          app.commands.executeCommandById(`${pluginId}:extract-current-selection`);
          await waitUntil({
            message: 'the split picker did not open',
            predicate: () => document.querySelector('.prompt') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          await chooseTargetInPicker('fm-extract-target');

          await waitUntil({
            message: 'the extracted aliases did not reach the destination note',
            predicate: async () => {
              const currentTargetContent = await app.vault.read(targetFile);
              return currentTargetContent.includes('bravo');
            }
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const targetFileContent = await app.vault.read(targetFile);
          // The source is rewritten through its editor, whose save to disk is debounced — so read what the
          // User sees, exactly as the same-note extract suite does.
          const sourceFileContent = editorValueFor(SOURCE_PATH) ?? await app.vault.read(sourceFile);

          return {
            sourceFrontmatter: parseFrontmatter(sourceFileContent),
            sourceRest: bodyOf(sourceFileContent),
            targetFrontmatter: parseFrontmatter(targetFileContent),
            targetRest: bodyOf(targetFileContent)
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeSplitting = original.shouldAskBeforeSplitting;
            settings.shouldExtractFrontmatterSelectionAsProperties = original.shouldExtractFrontmatterSelectionAsProperties;
          });
        }

        function bodyOf(content: string): string {
          return content.slice(obsidianModule.getFrontMatterInfo(content).contentStart);
        }

        async function chooseTargetInPicker(query: string): Promise<void> {
          const input = document.querySelector('.prompt-input');
          if (!(input instanceof HTMLInputElement)) {
            throw new TypeError('No split picker input.');
          }
          // Extracting into a note that ALREADY EXISTS is a merge, and the create/merge switch made that
          // Explicit (issue #227) - so the picker has to be told before it will offer existing notes.
          const modeToggle = document.querySelector('.advanced-note-composer-split-target-mode .checkbox-container');
          if (!(modeToggle instanceof HTMLElement)) {
            throw new TypeError('No create/merge switch in the split picker.');
          }
          if (!modeToggle.classList.contains('is-enabled')) {
            modeToggle.click();
          }

          input.value = query;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: 'the destination note suggestion did not appear',
            predicate: () => [...document.querySelectorAll('.suggestion-title')].some((el) => el.textContent.includes(query))
          });
          input.focus();
          pressKey({ key: 'Enter' });
        }

        function editorValueFor(path: string): string | undefined {
          for (const leaf of app.workspace.getLeavesOfType('markdown')) {
            const view = leaf.view;
            if (view instanceof obsidianModule.MarkdownView && view.file?.path === path) {
              return view.editor.getValue();
            }
          }
          return undefined;
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
          return typeof node.editAndSave === 'function' && typeof node.settings?.shouldExtractFrontmatterSelectionAsProperties === 'boolean';
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
          // Source mode: in Live Preview the properties block is a widget, so its raw YAML cannot be
          // Selected at all — which is why this feature only ever sees a source-mode selection.
          await view.setState({ ...view.getState(), mode: 'source', source: true }, { history: false });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return view.editor;
        }

        function parseFrontmatter(content: string): unknown {
          return obsidianModule.parseYaml(obsidianModule.getFrontMatterInfo(content).frontmatter);
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

    // The values arrived as PROPERTIES, merged into the destination's own `aliases`.
    expect(result.targetFrontmatter).toEqual({ aliases: ['existing', 'alpha', 'bravo'] });

    // And not as raw YAML text pasted into its body.
    expect(result.targetRest).not.toContain('alpha');
    expect(result.targetRest).not.toContain('aliases:');
    expect(result.targetRest).toContain('target body');

    // The source keeps the value that was not selected, its other property, and its body.
    expect(result.sourceFrontmatter).toEqual({ aliases: ['charlie'], tags: ['keep'] });
    expect(result.sourceRest).toContain('source body');
  });
});
