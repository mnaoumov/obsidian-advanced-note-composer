import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: LinkSettings;
}

interface LinkSettings {
  shouldAskBeforeSplitting: boolean;
  shouldSplitHeadingsAutomatically: boolean;
  shouldSplitIntoFolder: boolean;
  splitExcludePaths: string[];
}

interface SettingsCarrier {
  editAndSave: (editor: (settings: LinkSettings) => void) => Promise<void>;
  settings: LinkSettings;
}

/*
 * Issue #291: a note whose headings link to one another, split apart by this plugin, used to leave every one
 * of those links pointing at the ORIGINAL note — where the heading no longer is. Measured on 1.14.2 before
 * the fix: `[[#HlB]]` inside `# HlA` became `[[hl-source#HlB]]` in `HlA/HlA.md`, and the intro's `[[#HlB]]`,
 * left behind in the source, was not touched at all.
 */
describe('heading links survive a split (issue #291)', () => {
  it('should point every heading and block link at the note that holds its target after a recursive split', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        /*
         * Under the transport's ~30s per-closure cap: four waits at the ceiling below (20000) plus one
         * settle of 1000.
         */
        const WAIT_TIMEOUT_IN_MILLISECONDS = 5000;
        const SETTLE_DELAY_IN_MILLISECONDS = 1000;
        const SOURCE_PATH = 'hl-source.md';
        const SOURCE_CONTENT = [
          'Intro links to [[#HlB]], [[#HlC]] and [[#HlE x]].',
          '',
          '# HlA',
          '',
          'A links to [[#HlB]], [[#HlD]] and [[#^blk]].',
          '',
          '## HlB',
          '',
          'B links to [[#HlC]] and [[#HlA]].',
          '',
          '### HlC',
          '',
          'C text ^blk',
          '',
          '## HlD',
          '',
          'D links to [[#HlB|alias]].',
          '',
          '### HlE: x',
          '',
          'E text',
          ''
        ].join('\n');

        const settingsComponent = findSettingsComponent();
        const original = {
          shouldAskBeforeSplitting: settingsComponent.settings.shouldAskBeforeSplitting,
          shouldSplitHeadingsAutomatically: settingsComponent.settings.shouldSplitHeadingsAutomatically,
          shouldSplitIntoFolder: settingsComponent.settings.shouldSplitIntoFolder
        };
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeSplitting = false;
            settings.shouldSplitIntoFolder = false;
            settings.shouldSplitHeadingsAutomatically = false;
          });

          const sourceFile = await app.vault.create(SOURCE_PATH, SOURCE_CONTENT);
          await app.workspace.getLeaf(false).openFile(sourceFile);
          await waitUntil({
            message: 'the source note did not open',
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file === sourceFile,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await waitUntil({
            message: 'the metadata cache did not index the source headings',
            predicate: () => (app.metadataCache.getFileCache(sourceFile)?.headings ?? []).length === 5,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          app.commands.executeCommandById(`${pluginId}:split-note-by-headings-recursively`);

          const paths = ['HlA/HlA.md', 'HlA/HlB/HlB.md', 'HlA/HlB/HlC/HlC.md', 'HlA/HlD/HlD.md', 'HlA/HlD/HlE_ x/HlE_ x.md'];
          await waitUntil({
            message: 'the recursive split did not build the tree',
            predicate: () => paths.every((path) => app.vault.getAbstractFileByPath(path) instanceof obsidianModule.TFile),
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await sleep(SETTLE_DELAY_IN_MILLISECONDS);

          const contents: Record<string, string> = {};
          for (const path of [SOURCE_PATH, ...paths]) {
            const file = app.vault.getFileByPath(path);
            contents[path] = file ? await app.vault.read(file) : '<missing>';
          }

          return { contents };
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
            if (typeof node.editAndSave === 'function' && Array.isArray(node.settings?.splitExcludePaths)) {
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

    const { contents } = result;
    // What stayed in the source now points at the notes its headings became, including a heading whose link
    // text differs from the heading (`HlE: x` is linked as `HlE x`, the way Obsidian writes it, and its note is
    // `HlE_ x` once the invalid character is replaced).
    expect(contents['hl-source.md']).toContain('Intro links to [[HlB#HlB]], [[HlC#HlC]] and [[HlE_ x#HlE x]].');
    // Links between headings that were split apart follow each heading into its own note, block links too.
    expect(contents['HlA/HlA.md']).toContain('A links to [[HlB#HlB]], [[HlD#HlD]] and [[HlC#^blk]].');
    expect(contents['HlA/HlB/HlB.md']).toContain('B links to [[HlC#HlC]] and [[HlA#HlA]].');
    // An alias survives the rewrite.
    expect(contents['HlA/HlD/HlD.md']).toContain('D links to [[HlB#HlB|alias]].');
    // And nothing points at the note the headings left.
    for (const content of Object.values(contents)) {
      expect(content).not.toContain('hl-source#');
    }
  });

  it('should keep a same-note link as it is when its heading moves along with it, and redirect the rest (Extract this heading)', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        /*
         * Under the transport's ~30s per-closure cap: four waits at the ceiling below (20000) plus one
         * settle of 1000.
         */
        const WAIT_TIMEOUT_IN_MILLISECONDS = 5000;
        const SETTLE_DELAY_IN_MILLISECONDS = 1000;
        const SOURCE_PATH = 'hl-extract-source.md';
        const SOURCE_CONTENT = [
          'Intro links to [[#ExQ]] and [[#ExQ2]] and [[#ExR]].',
          '',
          '## ExQ',
          '',
          'Q links to [[#ExQ2]] and [[#ExR]].',
          '',
          '### ExQ2',
          '',
          'Q2 text',
          '',
          '## ExR',
          '',
          'R links to [[#ExQ|back]].',
          ''
        ].join('\n');

        const settingsComponent = findSettingsComponent();
        const original = {
          shouldAskBeforeSplitting: settingsComponent.settings.shouldAskBeforeSplitting,
          shouldSplitHeadingsAutomatically: settingsComponent.settings.shouldSplitHeadingsAutomatically,
          shouldSplitIntoFolder: settingsComponent.settings.shouldSplitIntoFolder
        };
        try {
          // No picker and no confirmation: the extract names its note after the heading and just runs.
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeSplitting = false;
            settings.shouldSplitIntoFolder = false;
            settings.shouldSplitHeadingsAutomatically = true;
          });

          const sourceFile = await app.vault.create(SOURCE_PATH, SOURCE_CONTENT);
          await app.workspace.getLeaf(false).openFile(sourceFile);
          await waitUntil({
            message: 'the source note did not open',
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file === sourceFile,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await waitUntil({
            message: 'the metadata cache did not index the source headings',
            predicate: () => (app.metadataCache.getFileCache(sourceFile)?.headings ?? []).length === 3,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });

          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          // In the BODY of `## ExQ`, so the command resolves the enclosing heading.
          view.editor.setCursor({ ch: 0, line: 4 });
          app.commands.executeCommandById(`${pluginId}:extract-this-heading`);

          await waitUntil({
            message: 'the heading was not extracted',
            predicate: () => app.vault.getFileByPath('ExQ.md') !== null && !view.editor.getValue().includes('Q links to'),
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await sleep(SETTLE_DELAY_IN_MILLISECONDS);

          const extracted = app.vault.getFileByPath('ExQ.md');
          if (!extracted) {
            throw new Error('The extracted note was not found.');
          }
          return {
            extractedContent: await app.vault.read(extracted),
            sourceContent: view.editor.getValue()
          };
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
            if (typeof node.editAndSave === 'function' && Array.isArray(node.settings?.splitExcludePaths)) {
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

    // `ExQ2` moved WITH the link to it, so the same-note link is kept exactly as written; `ExR` stayed.
    expect(result.extractedContent).toContain('Q links to [[#ExQ2]] and [[hl-extract-source#ExR]].');
    // The links left in the source follow the two headings out, and leave the one that stayed alone. The
    // first two sit BEFORE the extracted range, so this also proves the edit did not shift what was removed.
    expect(result.sourceContent).toContain('Intro links to [[ExQ#ExQ]] and [[ExQ#ExQ2]] and [[#ExR]].');
    expect(result.sourceContent).toContain('R links to [[ExQ#ExQ|back]].');
    expect(result.sourceContent).not.toContain('Q2 text');
    expect(result.sourceContent).toContain('## ExR');
  });

  it('should copy a link to the heading the cursor is under', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        // Two waits at the ceiling below.
        const WAIT_TIMEOUT_IN_MILLISECONDS = 5000;
        const SOURCE_PATH = 'hl-copy-source.md';
        const sourceFile = await app.vault.create(SOURCE_PATH, ['# CpA', '', '## CpB: x', '', 'body of CpB', ''].join('\n'));
        await app.workspace.getLeaf(false).openFile(sourceFile);
        await waitUntil({
          message: 'the metadata cache did not index the source headings',
          predicate: () =>
            app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file === sourceFile
            && (app.metadataCache.getFileCache(sourceFile)?.headings ?? []).length === 2,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
        if (!view) {
          throw new Error('No active markdown view.');
        }
        view.editor.setCursor({ ch: 0, line: 4 });

        // The hidden test window is never focused, and the real clipboard refuses an unfocused document, so
        // the write is captured instead of performed.
        const clipboard = activeWindow.navigator.clipboard;
        const originalWriteText = clipboard.writeText.bind(clipboard);
        let copied: null | string = null;
        clipboard.writeText = (text: string): Promise<void> => {
          copied = text;
          return new Promise<void>((resolve) => {
            resolve();
          });
        };
        try {
          app.commands.executeCommandById(`${pluginId}:copy-link-to-this-heading`);
          await waitUntil({
            message: 'nothing was copied',
            predicate: () => copied !== null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
        } finally {
          clipboard.writeText = originalWriteText;
        }

        return { copied };
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // Obsidian's own link for the heading, from the note it sits in: the same-note form the issue asked for,
    // with the heading's colon dropped the way Obsidian's `[[#` suggester drops it.
    expect(result.copied).toBe('[[#CpB x]]');
  });
});
