import type {
  App,
  TFile
} from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

interface ComponentTreeNode {
  readonly _children?: ComponentTreeNode[];
  readonly editAndSave?: unknown;
  readonly settings?: Partial<SplitSettings>;
}

interface SettingsCarrier {
  readonly editAndSave: (editor: (settings: SplitSettings) => void) => Promise<void>;
  readonly settings: SplitSettings;
}

interface SplitSettings {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- `editAndSave`'s callback writes it.
  shouldAskBeforeSplitting: boolean;
}

const PLUGIN_ID = 'advanced-note-composer';

describe('split note by horizontal rules', () => {
  it('turns every block between the rules into its own note, leaving a link and the rules behind', async () => {
    const result = await evalInObsidian({
      async callback({ app, findSettingsComponent, lib: { waitUntil }, obsidianModule, pluginId }) {
        // Three waits of 7 s each, 21 s declared, under the transport's ~30 s per-closure cap.
        const WAIT_TIMEOUT_IN_MILLISECONDS = 7000;
        const NOTE_PATH = 'split-by-hr.md';
        // `---` and `***` are both thematic breaks; the frontmatter stays with the source, the first block
        // is named by its heading and the two others by their first line.
        const SOURCE = '---\ntags: x\n---\n# Alpha\n\nalpha body\n\n---\n\n- beta **line**\nbeta body\n\n***\n\ngamma line';
        const settingsComponent = findSettingsComponent(app, pluginId);
        const isOriginalShouldAsk = settingsComponent.settings.shouldAskBeforeSplitting;
        await settingsComponent.editAndSave((settings) => {
          settings.shouldAskBeforeSplitting = false;
        });
        try {
          const existing = app.vault.getAbstractFileByPath(NOTE_PATH);
          if (existing) {
            await app.vault.delete(existing);
          }
          const file = await app.vault.create(NOTE_PATH, SOURCE);
          const leaf = app.workspace.getLeaf(false);
          await leaf.openFile(file, { state: { mode: 'source' } });
          await waitUntil({
            message: 'the note did not open with its horizontal rules indexed',
            predicate: () =>
              app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === NOTE_PATH
              && (app.metadataCache.getFileCache(file)?.sections ?? []).filter((section) => section.type === 'thematicBreak').length === 2,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          const canRun = app.commands.executeCommandById(`${pluginId}:split-note-by-horizontal-rules`);
          const names = ['Alpha', 'beta line', 'gamma line'];
          await waitUntil({
            message: 'the three notes were not created',
            predicate: () => names.every((name) => findNote(name) !== null),
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await waitUntil({
            message: 'the source does not hold a link to every created note',
            predicate: () => {
              const value = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor.getValue() ?? '';
              return names.every((name) => value.includes(name)) && !value.includes('alpha body');
            },
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          const contents: string[] = [];
          for (const name of names) {
            const note = findNote(name);
            contents.push(note ? await app.vault.read(note) : '');
          }
          return {
            canRun,
            contents,
            source: app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor.getValue() ?? ''
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeSplitting = isOriginalShouldAsk;
          });
        }

        function findNote(basename: string): null | TFile {
          return app.vault.getMarkdownFiles().find((note) => note.basename === basename) ?? null;
        }
      },
      input: { findSettingsComponent: findSettingsComponentInObsidian, pluginId: PLUGIN_ID }
    });

    expect(result.canRun).toBe(true);
    expect(result.contents[0]).toContain('# Alpha\n\nalpha body');
    expect(result.contents[1]).toContain('- beta **line**\nbeta body');
    expect(result.contents[2]).toContain('gamma line');
    expect(result.source.startsWith('---\ntags: x\n---\n')).toBe(true);
    const alphaIndex = result.source.indexOf('Alpha');
    const firstRuleIndex = result.source.indexOf('\n---\n', 'tags: x\n---\n'.length);
    const betaIndex = result.source.indexOf('beta line');
    const secondRuleIndex = result.source.indexOf('***');
    const gammaIndex = result.source.indexOf('gamma line');
    expect(alphaIndex).toBeGreaterThan(0);
    expect(alphaIndex).toBeLessThan(firstRuleIndex);
    expect(firstRuleIndex).toBeLessThan(betaIndex);
    expect(betaIndex).toBeLessThan(secondRuleIndex);
    expect(secondRuleIndex).toBeLessThan(gammaIndex);
  });
});

/**
 * Finds the plugin's settings component by walking its component tree. Runs inside Obsidian, passed through
 * `input`.
 *
 * @param app - The app.
 * @param pluginId - The plugin.
 * @returns The settings component.
 */
function findSettingsComponentInObsidian(app: App, pluginId: string): SettingsCarrier {
  const plugin = app.plugins.getPlugin(pluginId) as ComponentTreeNode | null;
  const queue: ComponentTreeNode[] = plugin ? [plugin] : [];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) {
      continue;
    }
    if (typeof node.editAndSave === 'function' && typeof node.settings?.shouldAskBeforeSplitting === 'boolean') {
      return node as SettingsCarrier;
    }
    if (node._children) {
      queue.push(...node._children);
    }
  }
  throw new Error('Settings component was not found.');
}
