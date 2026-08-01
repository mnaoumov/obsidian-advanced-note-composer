import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only: this is a file/folder-move flow. It runs desktop-only, matching the plugin's
// Established integration convention (no Android emulator wired for it). File-move suites can hit
// The documented headless rename wall (`renameFile`/`metadataCache.onCleanCache`) when several run
// In one aggregate; if this stalls in the aggregate, it is `it.skip`-ped and must still pass alone.
// Isolation: `npx vitest run --project integration-tests:desktop src/flatten-folder.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: FlattenSettings;
}

interface FlattenSettings {
  shouldAskBeforeFlattening: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: FlattenSettings) => void): Promise<void>;
  settings: FlattenSettings;
}

describe('flatten folder (issue #105)', () => {
  it('promotes a folder\'s direct children up one level (subfolders kept whole) and links still resolve', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const settingsComponent = findSettingsComponent();
        const originalShouldAsk = settingsComponent.settings.shouldAskBeforeFlattening;
        try {
          // Skip the confirmation dialog (issue #154, on by default) so the flatten runs straight from the
          // Command; the dialog itself is covered by `folder-confirm.desktop.integration.test.ts`.
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeFlattening = false;
          });

          // A prior run may have left the flattened files at root; start from a clean slate.
          await trashIfExists('parent-note.md');
          await trashIfExists('child-note.md');
          await trashIfExists('subfolder');
          await trashIfExists('flat-src');

          // Build `flat-src/` with two notes (one links to the other) plus a subfolder holding a note.
          await app.vault.createFolder('flat-src');
          await app.vault.createFolder('flat-src/subfolder');
          const parentNote = await app.vault.create('flat-src/parent-note.md', 'See [[child-note]].');
          await app.vault.create('flat-src/child-note.md', 'child body');
          await app.vault.create('flat-src/subfolder/grandchild.md', 'grandchild body');

          // Open a note inside `flat-src` so the folder command resolves the active file's parent folder.
          await openFile(parentNote);
          await waitUntil({
            message: 'link cache not ready',
            predicate: () => app.metadataCache.getFirstLinkpathDest('child-note', 'flat-src/parent-note.md')?.path === 'flat-src/child-note.md'
          });

          const canRun = app.commands.executeCommandById(`${pluginId}:flatten-folder`);

          // The direct children move up one level, becoming siblings of `flat-src` (i.e. into the root).
          await waitUntil({
            message: 'children were not promoted to the root',
            predicate: () =>
              app.vault.getAbstractFileByPath('parent-note.md') !== null
              && app.vault.getAbstractFileByPath('child-note.md') !== null
              && app.vault.getAbstractFileByPath('subfolder/grandchild.md') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const parentAtRoot = app.vault.getAbstractFileByPath('parent-note.md') !== null;
          const childAtRoot = app.vault.getAbstractFileByPath('child-note.md') !== null;
          const grandchildKeptStructure = app.vault.getAbstractFileByPath('subfolder/grandchild.md') !== null;
          const sourceFolderRemains = app.vault.getAbstractFileByPath('flat-src') !== null;
          // The link is link-aware after the move: it resolves from the promoted note to the promoted target.
          const linkResolves = app.metadataCache.getFirstLinkpathDest('child-note', 'parent-note.md')?.path === 'child-note.md';

          return { canRun, childAtRoot, grandchildKeptStructure, linkResolves, parentAtRoot, sourceFolderRemains };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeFlattening = originalShouldAsk;
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

        function isSettingsComponent(node: ComponentTreeNode): node is SettingsCarrier {
          return typeof node.editAndSave === 'function' && typeof node.settings?.shouldAskBeforeFlattening === 'boolean';
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }

        async function openFile(file: TFile): Promise<void> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
          });
        }
      },
      vaultPath: getTempVault().path
    });

    expect(result.canRun).toBe(true);
    // The two direct child notes became siblings of the (now emptied) source folder — at the root.
    expect(result.parentAtRoot).toBe(true);
    expect(result.childAtRoot).toBe(true);
    // The subfolder moved wholesale (its internal structure is preserved, not collapsed).
    expect(result.grandchildKeptStructure).toBe(true);
    // The inter-note link still resolves after the promotion (link-aware move).
    expect(result.linkResolves).toBe(true);
    // The emptied source folder is left in place (matching the manual "drag everything up" workflow).
    expect(result.sourceFolderRemains).toBe(true);
  });

  /*
   * Issue #161 asks that flatten "move each note's attachments along with it". This pins the answer:
   * flatten promotes EVERY direct child, so an attachment beside the note and an attachment sub-folder
   * both travel with it and the embeds keep resolving. Attachments in a central attachment folder live
   * outside the flattened folder and correctly stay where they are. Nothing needs carrying.
   */
  it('carries a note\'s attachments along, whether they sit beside it or in an attachment sub-folder', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const settingsComponent = findSettingsComponent();
        const originalShouldAsk = settingsComponent.settings.shouldAskBeforeFlattening;
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeFlattening = false;
          });

          await trashIfExists('attach-note.md');
          await trashIfExists('beside.png');
          await trashIfExists('assets');
          await trashIfExists('attach-src');

          await app.vault.createFolder('attach-src');
          await app.vault.createFolder('attach-src/assets');
          await app.vault.createBinary('attach-src/beside.png', new ArrayBuffer(4));
          await app.vault.createBinary('attach-src/assets/nested.png', new ArrayBuffer(4));
          const note = await app.vault.create('attach-src/attach-note.md', '![[beside.png]]\n![[nested.png]]');

          await openFile(note);
          await waitUntil({
            message: 'embed cache not ready',
            predicate: () => (app.metadataCache.getFileCache(note)?.embeds ?? []).length === 2
          });

          app.commands.executeCommandById(`${pluginId}:flatten-folder`);

          await waitUntil({
            message: 'the note was not promoted to the root',
            predicate: () => app.vault.getAbstractFileByPath('attach-note.md') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          return {
            besideMoved: app.vault.getAbstractFileByPath('beside.png') !== null,
            besideResolves: app.metadataCache.getFirstLinkpathDest('beside.png', 'attach-note.md')?.path === 'beside.png',
            nestedKeptStructure: app.vault.getAbstractFileByPath('assets/nested.png') !== null,
            nestedResolves: app.metadataCache.getFirstLinkpathDest('nested.png', 'attach-note.md')?.path === 'assets/nested.png'
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeFlattening = originalShouldAsk;
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

        function isSettingsComponent(node: ComponentTreeNode): node is SettingsCarrier {
          return typeof node.editAndSave === 'function' && typeof node.settings?.shouldAskBeforeFlattening === 'boolean';
        }

        async function openFile(file: TFile): Promise<void> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
          });
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

    // The attachment beside the note was promoted with it, and the embed still resolves.
    expect(result.besideMoved).toBe(true);
    expect(result.besideResolves).toBe(true);
    // The attachment sub-folder moved wholesale, so the nested embed resolves at its new path.
    expect(result.nestedKeptStructure).toBe(true);
    expect(result.nestedResolves).toBe(true);
  });

  /*
   * Issue #170: the reporter wants the folder itself to survive a flatten — only its child folders move up,
   * and the attachment folder holding the staying notes' attachments is not one of them. The two cases
   * above are the regression control: with the default `All children` mode nothing about them changes.
   */
  it('promotes only the child folders in `Child folders only` mode, keeping the folder and its attachment folder intact', async () => {
    const result = await evalInObsidian({
      args: { commandId: 'flatten-folder-child-folders-only', pluginId: PLUGIN_ID },
      async fn({
        app,
        commandId,
        lib: { waitUntil },
        obsidianModule,
        pluginId
      }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const settingsComponent = findSettingsComponent();
        const originalShouldAsk = settingsComponent.settings.shouldAskBeforeFlattening;
        const originalAttachmentFolderPath = app.vault.getConfig('attachmentFolderPath');
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeFlattening = false;
          });
          // A per-folder attachment sub-folder is the configuration the issue is written against.
          app.vault.setConfig('attachmentFolderPath', './att-assets');

          await trashIfExists('only-src');
          await trashIfExists('only-sub');
          await trashIfExists('att-assets');

          await app.vault.createFolder('only-src');
          await app.vault.createFolder('only-src/att-assets');
          await app.vault.createFolder('only-src/only-sub');
          await app.vault.createBinary('only-src/att-assets/only-pic.png', new ArrayBuffer(4));
          await app.vault.create('only-src/only-sub/only-deep.md', 'deep body');
          const note = await app.vault.create('only-src/only-note.md', 'See ![[only-pic.png]].');

          await openFile(note);
          await waitUntil({
            message: 'embed cache not ready',
            predicate: () => (app.metadataCache.getFileCache(note)?.embeds ?? []).length === 1
          });

          app.commands.executeCommandById(`${pluginId}:${commandId}`);

          await waitUntil({
            message: 'the child folder was not promoted to the root',
            predicate: () => app.vault.getAbstractFileByPath('only-sub/only-deep.md') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          return {
            attachmentFolderNotPromoted: app.vault.getAbstractFileByPath('att-assets') === null,
            attachmentFolderStayed: app.vault.getAbstractFileByPath('only-src/att-assets/only-pic.png') !== null,
            embedStillResolves: app.metadataCache.getFirstLinkpathDest('only-pic.png', 'only-src/only-note.md')?.path
              === 'only-src/att-assets/only-pic.png',
            noteStayed: app.vault.getAbstractFileByPath('only-src/only-note.md') !== null,
            subFolderPromoted: app.vault.getAbstractFileByPath('only-sub/only-deep.md') !== null
          };
        } finally {
          app.vault.setConfig('attachmentFolderPath', originalAttachmentFolderPath);
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeFlattening = originalShouldAsk;
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

        function isSettingsComponent(node: ComponentTreeNode): node is SettingsCarrier {
          return typeof node.editAndSave === 'function' && typeof node.settings?.shouldAskBeforeFlattening === 'boolean';
        }

        async function openFile(file: TFile): Promise<void> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
          });
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

    // The child folder was promoted, whole.
    expect(result.subFolderPromoted).toBe(true);
    // The folder itself survives with its own note — the whole point of issue #170.
    expect(result.noteStayed).toBe(true);
    // The attachment folder stayed with the note it belongs to, and was not promoted alongside the others.
    expect(result.attachmentFolderStayed).toBe(true);
    expect(result.attachmentFolderNotPromoted).toBe(true);
    expect(result.embedStillResolves).toBe(true);
  });

  /*
   * Issue #171: the same folder-only promotion, applied at every depth — a whole sub-tree of folders lands
   * as siblings of the folder the command was run on.
   */
  it('promotes every descendant folder up to the folder\'s own level in `All folders recursively` mode', async () => {
    const result = await evalInObsidian({
      args: { commandId: 'flatten-folder-all-folders-recursively', pluginId: PLUGIN_ID },
      async fn({
        app,
        commandId,
        lib: { waitUntil },
        obsidianModule,
        pluginId
      }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const settingsComponent = findSettingsComponent();
        const originalShouldAsk = settingsComponent.settings.shouldAskBeforeFlattening;
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeFlattening = false;
          });

          await trashIfExists('rec-src');
          await trashIfExists('rec-mid');
          await trashIfExists('rec-leaf');

          await app.vault.createFolder('rec-src');
          await app.vault.createFolder('rec-src/rec-mid');
          await app.vault.createFolder('rec-src/rec-mid/rec-leaf');
          await app.vault.create('rec-src/rec-mid/rec-mid-note.md', 'mid body');
          await app.vault.create('rec-src/rec-mid/rec-leaf/rec-leaf-note.md', 'leaf body');
          const note = await app.vault.create('rec-src/rec-note.md', 'root body');

          await openFile(note);

          app.commands.executeCommandById(`${pluginId}:${commandId}`);

          await waitUntil({
            message: 'the nested folders were not promoted to the root',
            predicate: () =>
              app.vault.getAbstractFileByPath('rec-mid/rec-mid-note.md') !== null
              && app.vault.getAbstractFileByPath('rec-leaf/rec-leaf-note.md') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          return {
            leafNoLongerNested: app.vault.getAbstractFileByPath('rec-mid/rec-leaf') === null,
            leafPromoted: app.vault.getAbstractFileByPath('rec-leaf/rec-leaf-note.md') !== null,
            midPromoted: app.vault.getAbstractFileByPath('rec-mid/rec-mid-note.md') !== null,
            sourceKeptItsOwnNote: app.vault.getAbstractFileByPath('rec-src/rec-note.md') !== null
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeFlattening = originalShouldAsk;
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

        function isSettingsComponent(node: ComponentTreeNode): node is SettingsCarrier {
          return typeof node.editAndSave === 'function' && typeof node.settings?.shouldAskBeforeFlattening === 'boolean';
        }

        async function openFile(file: TFile): Promise<void> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
          });
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

    // Both folders became siblings of the flattened folder, each keeping its own files.
    expect(result.midPromoted).toBe(true);
    expect(result.leafPromoted).toBe(true);
    // The leaf really left its old parent rather than moving inside it.
    expect(result.leafNoLongerNested).toBe(true);
    // The folder the command ran on survives, with its own note.
    expect(result.sourceKeptItsOwnNote).toBe(true);
  });
});
