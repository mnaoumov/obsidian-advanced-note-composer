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
 * Coverage for issue #187: extracting a property value into another note must not reorder the
 * destination note's own properties. The destination's keys are deliberately not in alphabetical order,
 * so any re-sorting or rebuild-from-scratch shows up immediately.
 *
 * Isolation: `npx vitest run --project integration-tests:desktop src/frontmatter-property-order.desktop.integration.test.ts`.
 */

const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: FrontmatterSelectionSettings;
}

interface FrontmatterSelectionSettings {
  defaultFrontmatterMergeStrategy: string;
  shouldAskBeforeSplitting: boolean;
  shouldExtractFrontmatterSelectionAsProperties: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: FrontmatterSelectionSettings) => void): Promise<void>;
  settings: FrontmatterSelectionSettings;
}

describe('property order when extracting a property value (issue #187)', () => {
  it('should keep the destination note\'s own property order under every merge strategy', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { pressKey, waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const SOURCE_PATH = 'fm-order-source.md';
        const TARGET_PATH = 'fm-order-target.md';

        const sourceContent = [
          '---',
          'aliases:',
          '  - alpha',
          '  - bravo',
          '---',
          '',
          'source body',
          ''
        ].join('\n');

        // Deliberately NOT alphabetical, and `aliases` (the property being merged into) sits in the middle
        // Rather than at either end, so a rebuilt object cannot accidentally land on the right order.
        const targetContent = [
          '---',
          'zulu: 1',
          'aliases:',
          '  - existing',
          'mike: 2',
          'alfa: 3',
          '---',
          '',
          'target body',
          ''
        ].join('\n');

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        try {
          return {
            preferNewValues: await runExtract('MergeAndPreferNewValues', 'bravo'),
            preferOriginalValues: await runExtract('MergeAndPreferOriginalValues', 'alpha')
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.defaultFrontmatterMergeStrategy = original.defaultFrontmatterMergeStrategy;
            settings.shouldAskBeforeSplitting = original.shouldAskBeforeSplitting;
            settings.shouldExtractFrontmatterSelectionAsProperties = original.shouldExtractFrontmatterSelectionAsProperties;
          });
        }

        async function runExtract(strategy: string, valueToExtract: string): Promise<string[]> {
          await settingsComponent.editAndSave((settings) => {
            settings.defaultFrontmatterMergeStrategy = strategy;
            settings.shouldAskBeforeSplitting = false;
            settings.shouldExtractFrontmatterSelectionAsProperties = true;
          });

          const sourceFile = await resetFile(SOURCE_PATH, sourceContent);
          const targetFile = await resetFile(TARGET_PATH, targetContent);

          const editor = await openInSourceMode(sourceFile);
          editor.setSelection(
            editor.offsetToPos(sourceContent.indexOf(valueToExtract)),
            editor.offsetToPos(sourceContent.indexOf(valueToExtract) + valueToExtract.length)
          );

          app.commands.executeCommandById(`${pluginId}:extract-current-selection`);
          await waitUntil({
            message: `the split picker did not open for ${strategy}`,
            predicate: () => document.querySelector('.prompt') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          await chooseTargetInPicker('fm-order-target');

          await waitUntil({
            message: `the extracted value did not reach the destination note for ${strategy}`,
            predicate: async () => {
              const currentTargetContent = await app.vault.read(targetFile);
              return currentTargetContent.includes(valueToExtract);
            }
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          return keysOf(await app.vault.read(targetFile));
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
          await pressKey({ key: 'Enter' });
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

        function keysOf(content: string): string[] {
          const parsed = obsidianModule.parseYaml(obsidianModule.getFrontMatterInfo(content).frontmatter) as null | Record<string, unknown>;
          return parsed ? Object.keys(parsed) : [];
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
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    expect(result.preferNewValues).toStrictEqual(['zulu', 'aliases', 'mike', 'alfa']);
    expect(result.preferOriginalValues).toStrictEqual(['zulu', 'aliases', 'mike', 'alfa']);
  });
});
