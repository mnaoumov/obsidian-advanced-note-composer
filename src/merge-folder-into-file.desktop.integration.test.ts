import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// Desktop-only: this is a folder-contents merge (file-delete) flow, matching the plugin's established
// Integration convention. File-move/delete suites can hit the documented headless rename wall when several
// Run in one aggregate; if this stalls in the aggregate, it is `it.skip`-ped and must still pass alone.
// Isolation: `npx vitest run --project integration-tests:desktop src/merge-folder-into-file.desktop.integration.test.ts`.
const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: MergeSettings;
}

interface MergeSettings {
  attachmentExtensions: string[];
  emptyFolderBehaviorAfterMergingFolder: string;
  mergeFolderIntoFileNoteNameTemplate: string;
  shouldAskBeforeMerging: boolean;
  shouldConvertFoldersToHeadingsWhenMergingFolder: boolean;
  shouldMoveAttachmentsWhenMergingFolder: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: MergeSettings) => void): Promise<void>;
  settings: MergeSettings;
}

describe('merge folder contents into a single file (issue #92)', () => {
  it('concatenates every descendant note into one new file named after the folder and deletes the sources', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const settingsComponent = findSettingsComponent();
        const originalShouldAsk = settingsComponent.settings.shouldAskBeforeMerging;
        try {
          // Skip the confirmation dialog so the merge runs straight from the command.
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = false;
          });

          await trashIfExists('combine-src');
          await trashIfExists('combine-src.md');

          await app.vault.createFolder('combine-src');
          await app.vault.createFolder('combine-src/sub');
          const alpha = await app.vault.create('combine-src/alpha.md', 'alpha body');
          await app.vault.create('combine-src/sub/bravo.md', 'bravo body');

          // Open a note inside the folder so the folder command resolves the active file's parent folder.
          await openFile(alpha);

          app.commands.executeCommandById(`${pluginId}:merge-folder-into-file`);

          // A single new note named after the folder appears, holding every descendant note's body.
          await waitUntil({
            message: 'merged single file was not created',
            predicate: () => app.vault.getAbstractFileByPath('combine-src.md') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const mergedFile = app.vault.getAbstractFileByPath('combine-src.md');
          const mergedContent = mergedFile && mergedFile instanceof obsidianModule.TFile
            ? await app.vault.read(mergedFile)
            : '';

          const hasAlpha = mergedContent.includes('alpha body');
          const hasBravo = mergedContent.includes('bravo body');
          const alphaSourceGone = app.vault.getAbstractFileByPath('combine-src/alpha.md') === null;
          const bravoSourceGone = app.vault.getAbstractFileByPath('combine-src/sub/bravo.md') === null;

          return { alphaSourceGone, bravoSourceGone, hasAlpha, hasBravo };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = originalShouldAsk;
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
          return typeof node.editAndSave === 'function' && typeof node.settings?.shouldAskBeforeMerging === 'boolean';
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

    // Both descendant notes were concatenated into the single new file.
    expect(result.hasAlpha).toBe(true);
    expect(result.hasBravo).toBe(true);
    // The source notes were deleted.
    expect(result.alphaSourceGone).toBe(true);
    expect(result.bravoSourceGone).toBe(true);
  });

  it('names the merged note from the template and turns sub-folders into demoted headings (issue #160)', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = false;
            settings.mergeFolderIntoFileNoteNameTemplate = '{{folderName}} summary';
            settings.shouldConvertFoldersToHeadingsWhenMergingFolder = true;
            settings.emptyFolderBehaviorAfterMergingFolder = 'Keep';
          });

          await trashIfExists('headings-src');
          await trashIfExists('headings-src summary.md');

          await app.vault.createFolder('headings-src');
          await app.vault.createFolder('headings-src/api');
          await app.vault.createFolder('headings-src/api/v2');
          const intro = await app.vault.create('headings-src/intro.md', '# Intro\nintro body');
          await app.vault.create('headings-src/api/get.md', '# Get\nget body');
          await app.vault.create('headings-src/api/v2/put.md', '# Put\nput body');

          await openFile(intro);

          app.commands.executeCommandById(`${pluginId}:merge-folder-into-file`);

          await waitUntil({
            message: 'the templated merged note was not created',
            predicate: () => app.vault.getAbstractFileByPath('headings-src summary.md') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const merged = app.vault.getAbstractFileByPath('headings-src summary.md');
          const mergedContent = merged && merged instanceof obsidianModule.TFile ? await app.vault.read(merged) : '';

          return {
            defaultNameUnused: app.vault.getAbstractFileByPath('headings-src.md') === null,
            hasDemotedGet: mergedContent.includes('## Get'),
            hasDemotedPut: mergedContent.includes('### Put'),
            hasFolderHeading: mergedContent.includes('# api'),
            hasNestedFolderHeading: mergedContent.includes('## v2'),
            hasUntouchedIntro: mergedContent.includes('# Intro')
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = original.shouldAskBeforeMerging;
            settings.mergeFolderIntoFileNoteNameTemplate = original.mergeFolderIntoFileNoteNameTemplate;
            settings.shouldConvertFoldersToHeadingsWhenMergingFolder = original.shouldConvertFoldersToHeadingsWhenMergingFolder;
            settings.emptyFolderBehaviorAfterMergingFolder = original.emptyFolderBehaviorAfterMergingFolder;
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
          return typeof node.editAndSave === 'function' && typeof node.settings?.shouldAskBeforeMerging === 'boolean';
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

    // The template named the note, so the default `<Folder Name>.md` was never used.
    expect(result.defaultNameUnused).toBe(true);
    // A note directly in the merged folder keeps its own heading level; each sub-folder is headed at its
    // Depth and the notes inside it are demoted to match.
    expect(result.hasUntouchedIntro).toBe(true);
    expect(result.hasFolderHeading).toBe(true);
    expect(result.hasDemotedGet).toBe(true);
    expect(result.hasNestedFolderHeading).toBe(true);
    expect(result.hasDemotedPut).toBe(true);
  });

  it('heads a sub-folder that holds no notes at all (issue #168)', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = false;
            settings.shouldConvertFoldersToHeadingsWhenMergingFolder = true;
            settings.mergeFolderIntoFileNoteNameTemplate = '';
            // The reporter's own setting - and the folder cleanup it triggers is this test's completion
            // Signal, since the merged note EXISTS (empty) before the merge writes anything into it.
            settings.emptyFolderBehaviorAfterMergingFolder = 'Delete';
          });

          await trashIfExists('empty-headings-src');
          await trashIfExists('empty-headings-src.md');

          // The reporter's own tree: sibling `3` holds nothing at all, so no note path mentions it and
          // Its heading has no source note to be written in front of.
          await app.vault.createFolder('empty-headings-src');
          await app.vault.createFolder('empty-headings-src/1');
          await app.vault.createFolder('empty-headings-src/1/1 1');
          await app.vault.createFolder('empty-headings-src/1/1 1/1 1 1');
          await app.vault.createFolder('empty-headings-src/2');
          await app.vault.createFolder('empty-headings-src/3');
          const root = await app.vault.create('empty-headings-src/Note.md', 'root body');
          await app.vault.create('empty-headings-src/1/Note.md', 'one body');
          await app.vault.create('empty-headings-src/1/1 1/Note.md', 'one-one body');
          await app.vault.create('empty-headings-src/1/1 1/1 1 1/Note.md', 'one-one-one body');
          await app.vault.create('empty-headings-src/2/Note.md', 'two body');

          await openFile(root);

          app.commands.executeCommandById(`${pluginId}:merge-folder-into-file`);

          await waitUntil({
            message: 'merged single file was not created',
            predicate: () => app.vault.getAbstractFileByPath('empty-headings-src.md') !== null
          });
          /*
           * The target note is created EMPTY before the merge and filled inside the transaction, so its
           * mere existence says nothing about the content - and the trailing heading for the empty folder
           * is the very last thing written. The folder cleanup runs only after the transaction commits,
           * so the merged folder disappearing is the signal that everything has been written.
           */
          await waitUntil({
            message: 'the emptied folder tree was not deleted, so the merge had not committed',
            predicate: () => app.vault.getAbstractFileByPath('empty-headings-src') === null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const merged = app.vault.getAbstractFileByPath('empty-headings-src.md');
          const mergedContent = merged && merged instanceof obsidianModule.TFile ? await app.vault.read(merged) : '';

          // No source note carries a heading of its own, so every `#` line in the result is a folder
          // Heading. Compared as whole lines: `# 1` is also a substring of `## 1 1`.
          return { headingLines: mergedContent.split('\n').filter((line) => line.startsWith('#')) };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = original.shouldAskBeforeMerging;
            settings.shouldConvertFoldersToHeadingsWhenMergingFolder = original.shouldConvertFoldersToHeadingsWhenMergingFolder;
            settings.mergeFolderIntoFileNoteNameTemplate = original.mergeFolderIntoFileNoteNameTemplate;
            settings.emptyFolderBehaviorAfterMergingFolder = original.emptyFolderBehaviorAfterMergingFolder;
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
          return typeof node.editAndSave === 'function' && typeof node.settings?.shouldAskBeforeMerging === 'boolean';
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

    // The whole folder tree is mirrored, in walk order - including `3`, which the reporter saw dropped.
    expect(result.headingLines).toEqual(['# 1', '## 1 1', '### 1 1 1', '# 2', '# 3']);
  });

  it('keeps the merged folder and deletes only the folders under it (issue #167)', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = false;
            settings.emptyFolderBehaviorAfterMergingFolder = 'DeleteSubFoldersOnly';
          });

          await trashIfExists('keep-src');
          await trashIfExists('keep-src.md');

          await app.vault.createFolder('keep-src');
          await app.vault.createFolder('keep-src/sub');
          const alpha = await app.vault.create('keep-src/alpha.md', 'alpha body');
          await app.vault.create('keep-src/sub/bravo.md', 'bravo body');

          await openFile(alpha);

          app.commands.executeCommandById(`${pluginId}:merge-folder-into-file`);

          await waitUntil({
            message: 'merged single file was not created',
            predicate: () => app.vault.getAbstractFileByPath('keep-src.md') !== null
          });
          // The folder cleanup runs after the transaction commits, so the sub-folder goes away strictly
          // After the merged note appears - wait for that rather than for the note alone.
          await waitUntil({
            message: 'the emptied sub-folder was not deleted',
            predicate: () => app.vault.getAbstractFileByPath('keep-src/sub') === null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const merged = app.vault.getAbstractFileByPath('keep-src.md');
          const mergedContent = merged && merged instanceof obsidianModule.TFile ? await app.vault.read(merged) : '';

          return {
            hasAlpha: mergedContent.includes('alpha body'),
            hasBravo: mergedContent.includes('bravo body'),
            mergedFolderKept: app.vault.getAbstractFileByPath('keep-src') !== null,
            subFolderGone: app.vault.getAbstractFileByPath('keep-src/sub') === null
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = original.shouldAskBeforeMerging;
            settings.emptyFolderBehaviorAfterMergingFolder = original.emptyFolderBehaviorAfterMergingFolder;
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
          return typeof node.editAndSave === 'function' && typeof node.settings?.shouldAskBeforeMerging === 'boolean';
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

    // Both notes were merged into the single new note beside the folder.
    expect(result.hasAlpha).toBe(true);
    expect(result.hasBravo).toBe(true);
    // The merged folder itself survives even though it is now empty; the folder under it does not.
    expect(result.mergedFolderKept).toBe(true);
    expect(result.subFolderGone).toBe(true);
  });

  it('excludes an Excalidraw drawing, moves attachments over, and deletes the emptied folders (issues #160, #161)', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        const originalAttachmentFolderPath = app.vault.getConfig('attachmentFolderPath');
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = false;
            settings.shouldMoveAttachmentsWhenMergingFolder = true;
            settings.attachmentExtensions = ['.excalidraw.md'];
            settings.emptyFolderBehaviorAfterMergingFolder = 'Delete';
          });
          // Obsidian's own default: attachments live at the vault root, which is where the merged note's
          // Attachments belong once it is created beside the folder.
          app.vault.setConfig('attachmentFolderPath', '/');

          await trashIfExists('attach-src');
          await trashIfExists('attach-src.md');
          await trashIfExists('pic.png');
          await trashIfExists('sketch.excalidraw.md');

          await app.vault.createFolder('attach-src');
          await app.vault.createFolder('attach-src/sub');
          await app.vault.createBinary('attach-src/sub/pic.png', new ArrayBuffer(4));
          await app.vault.create('attach-src/sketch.excalidraw.md', 'raw excalidraw payload');
          // The note sits directly in the merged folder: the command resolves the folder from the ACTIVE
          // File's parent, so opening a note in `sub` would merge `sub` instead.
          const note = await app.vault.create('attach-src/note.md', '![[pic.png]]\nnote body');

          await openFile(note);
          await waitUntil({
            message: 'embed cache not ready',
            predicate: () => (app.metadataCache.getFileCache(note)?.embeds ?? []).length === 1
          });

          app.commands.executeCommandById(`${pluginId}:merge-folder-into-file`);

          await waitUntil({
            message: 'merged single file was not created',
            predicate: () => app.vault.getAbstractFileByPath('attach-src.md') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const merged = app.vault.getAbstractFileByPath('attach-src.md');
          const mergedContent = merged && merged instanceof obsidianModule.TFile ? await app.vault.read(merged) : '';

          return {
            drawingKept: app.vault.getAbstractFileByPath('attach-src/sketch.excalidraw.md') !== null
              || app.vault.getAbstractFileByPath('sketch.excalidraw.md') !== null,
            drawingNotMerged: !mergedContent.includes('raw excalidraw payload'),
            hasNoteBody: mergedContent.includes('note body'),
            picMoved: app.vault.getAbstractFileByPath('pic.png') !== null,
            subFolderGone: app.vault.getAbstractFileByPath('attach-src/sub') === null
          };
        } finally {
          app.vault.setConfig('attachmentFolderPath', originalAttachmentFolderPath);
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAskBeforeMerging = original.shouldAskBeforeMerging;
            settings.shouldMoveAttachmentsWhenMergingFolder = original.shouldMoveAttachmentsWhenMergingFolder;
            settings.attachmentExtensions = original.attachmentExtensions;
            settings.emptyFolderBehaviorAfterMergingFolder = original.emptyFolderBehaviorAfterMergingFolder;
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
          return typeof node.editAndSave === 'function' && typeof node.settings?.shouldAskBeforeMerging === 'boolean';
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

    // The ordinary note was merged; the Excalidraw drawing's raw payload was not, and the drawing lives on.
    expect(result.hasNoteBody).toBe(true);
    expect(result.drawingNotMerged).toBe(true);
    expect(result.drawingKept).toBe(true);
    // The referenced image followed the notes into the merged note's attachment folder (the vault root),
    // Which is what lets the emptied sub-folder be deleted.
    expect(result.picMoved).toBe(true);
    expect(result.subFolderGone).toBe(true);
  });
});
