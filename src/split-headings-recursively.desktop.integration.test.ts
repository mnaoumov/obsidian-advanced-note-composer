import type {
  Editor,
  TFile
} from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTempVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsTab } from './plugin-settings-tab.ts';

const PLUGIN_ID = 'advanced-note-composer';

/*
 * A deliberately non-trivial split template: a header ABOVE `{{content}}` and a trailer BELOW it. The
 * trailer is the load-bearing half — anything the template writes after `{{content}}` sits under the note's
 * last heading, so it is what an unfixed recursion drags out of a parent and into its last child (issue
 * #172).
 */
const TEMPLATE_SPLIT_TEMPLATE = '# {{newTitle}}\n\n{{content}}\n\n---\nFrom: [[{{fromTitle}}]]';
const TEMPLATE_SOURCE_PATH = 'split-headings-recursively-template-source.md';

// Minimal shape of the plugin's settings component reached at runtime, used to set `Split template` (which
// Renders as a CodeMirror code highlighter, so driving it from the DOM is not practical) — the same walker
// `exclude-paths-typing.desktop.integration.test.ts` and `merge-folder-skips-ignored…` use.
interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: TemplateSettings;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: TemplateSettings) => void): Promise<void>;
  settings: TemplateSettings;
}

interface TemplateSettings {
  excludePaths: string[];
  shouldAskBeforeSplitting: boolean;
  shouldSplitHeadingsAutomatically: boolean;
  shouldSplitIntoFolder: boolean;
  splitTemplate: string;
}

describe('split headings recursively', () => {
  it('should mirror the heading hierarchy as a folder tree', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const ROOT_FOLDER = 'RecA';
        const SOURCE_PATH = 'split-headings-recursively-source.md';
        const SOURCE_CONTENT = [
          'Intro text',
          '',
          '# RecA',
          '',
          'body of RecA',
          '',
          '## RecB',
          '',
          'body of RecB',
          '',
          '### RecC',
          '',
          'body of RecC',
          '',
          '## RecD',
          '',
          'body of RecD',
          ''
        ].join('\n');

        /*
         * `Should split into folder` stays OFF on purpose: the recursive split builds the folder tree
         * itself, because a recursive split without folders cannot express a hierarchy. This is the
         * load-bearing setting of the whole test.
         *
         * `Should ask before splitting` stays ON so the up-front confirmation dialog is part of the flow
         * being driven, and `Should split headings automatically` stays OFF to show the recursive command
         * does not lean on it.
         */
        const originalShouldSplitIntoFolder = await setToggle('Should split into folder', false);
        const originalShouldSplitHeadingsAutomatically = await setToggle('Should split headings automatically', false);
        const originalShouldAsk = await setToggle('Should ask before splitting', true);
        try {
          // Clean up any leftover from a previous run so no folder name is de-duplicated.
          await removeIfExists(ROOT_FOLDER);

          const sourceFile = await resetFile(SOURCE_PATH, SOURCE_CONTENT);
          const editor = await openAndGetEditor(sourceFile);
          editor.setCursor({ ch: 0, line: 0 });

          await waitUntil({
            message: 'metadata cache did not index the source headings',
            predicate: () => (app.metadataCache.getFileCache(sourceFile)?.headings ?? []).length === 4
          });

          app.commands.executeCommandById(`${pluginId}:split-note-by-headings-recursively`);

          // The whole restructure is confirmed once, up front — drive that real dialog.
          await waitUntil({
            message: 'the recursive split confirmation dialog did not open',
            predicate: () => Array.from(document.querySelectorAll('.modal-title')).some((el) => el.textContent === 'Split note recursively')
          });
          // Scope to THIS dialog: a fresh vault also shows the plugin's release-notes modal, and reading
          // `.modal-content` document-wide picks that one up instead.
          const confirmationModalEl = Array.from(document.querySelectorAll('.modal'))
            .find((el) => el.querySelector('.modal-title')?.textContent === 'Split note recursively');
          if (!confirmationModalEl) {
            throw new Error('The recursive split confirmation modal was not found.');
          }
          const confirmationText = confirmationModalEl.querySelector('.modal-content')?.textContent ?? '';
          const confirmButtonEl = Array.from(confirmationModalEl.querySelectorAll('.modal-button-container button'))
            .find((el) => el.textContent === 'Split');
          if (!(confirmButtonEl instanceof HTMLElement)) {
            throw new Error('The "Split" button was not found.');
          }
          confirmButtonEl.click();

          const expectedPaths = [
            'RecA/RecA.md',
            'RecA/RecB/RecB.md',
            'RecA/RecB/RecC/RecC.md',
            'RecA/RecD/RecD.md'
          ];

          let wasPerNoteConfirmationShown = false;
          await waitUntil({
            message: 'the heading hierarchy was not mirrored as a folder tree',
            predicate: () => {
              wasPerNoteConfirmationShown ||= Array.from(document.querySelectorAll('.modal-title')).some((el) => el.textContent === 'Split file');
              return expectedPaths.every((path) => app.vault.getAbstractFileByPath(path) instanceof obsidianModule.TFile);
            }
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const contents: Record<string, string> = {};
          for (const path of expectedPaths) {
            const file = app.vault.getAbstractFileByPath(path);
            contents[path] = file instanceof obsidianModule.TFile ? await app.vault.read(file) : '';
          }

          const activePath = app.workspace.getActiveFile()?.path ?? '';

          return {
            activePath,
            confirmationText,
            contents,
            wasPerNoteConfirmationShown
          };
        } finally {
          await setToggle('Should split into folder', originalShouldSplitIntoFolder);
          await setToggle('Should split headings automatically', originalShouldSplitHeadingsAutomatically);
          await setToggle('Should ask before splitting', originalShouldAsk);
        }

        async function removeIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }

        async function resetFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          return app.vault.create(path, content);
        }

        async function openAndGetEditor(file: TFile): Promise<Editor> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: 'markdown editor did not open',
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor !== undefined
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          return view.editor;
        }

        async function setToggle(name: string, value: boolean): Promise<boolean> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          (tab as PluginSettingsTab).displayLegacy();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const item = Array.from(tab.containerEl.querySelectorAll('.setting-item'))
            .find((el) => el.querySelector('.setting-item-name')?.textContent === name);
          const toggle = item?.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new Error(`"${name}" toggle was not found.`);
          }
          const wasEnabled = toggle.classList.contains('is-enabled');
          if (wasEnabled !== value) {
            toggle.click();
            await sleep(RENDER_DELAY_IN_MILLISECONDS);
          }
          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return wasEnabled;
        }
      },
      vaultPath: getTempVault().path
    });

    // The confirmation listed every note it was about to create, indented by nesting depth.
    expect(result.confirmationText).toContain('Notes that will be created');
    expect(result.confirmationText).toContain('RecC');

    // The heading hierarchy became a folder hierarchy, with `Should split into folder` OFF throughout.
    expect(result.contents['RecA/RecA.md']).toContain('body of RecA');
    expect(result.contents['RecA/RecB/RecB.md']).toContain('body of RecB');
    expect(result.contents['RecA/RecB/RecC/RecC.md']).toContain('body of RecC');
    expect(result.contents['RecA/RecD/RecD.md']).toContain('body of RecD');

    // Each note owns only its own body — its sub-headings moved into their own notes below it.
    expect(result.contents['RecA/RecA.md']).not.toContain('body of RecB');
    expect(result.contents['RecA/RecB/RecB.md']).not.toContain('body of RecC');

    // A parent links to its children, so the tree stays navigable.
    expect(result.contents['RecA/RecA.md']).toContain('RecB');

    // The confirmation is asked once, not once per note.
    expect(result.wasPerNoteConfirmationShown).toBe(false);

    // The run walks the leaf through every note it creates, then hands it back to the source note.
    expect(result.activePath).toBe('split-headings-recursively-source.md');
  });

  it('should apply the split template to every note it creates, exactly once (issue #172)', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID, sourcePath: TEMPLATE_SOURCE_PATH, splitTemplate: TEMPLATE_SPLIT_TEMPLATE },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId, sourcePath, splitTemplate }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const ROOT_FOLDER = 'TplA';
        const SOURCE_CONTENT = [
          'Intro text',
          '',
          '# TplA',
          '',
          'body of TplA',
          '',
          '## TplB',
          '',
          'body of TplB',
          '',
          '### TplC',
          '',
          'body of TplC',
          '',
          '## TplD',
          '',
          'body of TplD',
          ''
        ].join('\n');

        const settingsComponent = findSettingsComponent();
        const originalSplitTemplate = settingsComponent.settings.splitTemplate;
        const originalShouldAsk = settingsComponent.settings.shouldAskBeforeSplitting;
        const originalShouldSplitIntoFolder = settingsComponent.settings.shouldSplitIntoFolder;
        const originalShouldSplitHeadingsAutomatically = settingsComponent.settings.shouldSplitHeadingsAutomatically;
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.splitTemplate = splitTemplate;
            // The confirmation dialog is already covered by the first case; skip it so this one only
            // Exercises the templating.
            settings.shouldAskBeforeSplitting = false;
            // `Should split into folder` stays OFF: the recursive split builds the folder tree itself.
            settings.shouldSplitIntoFolder = false;
            settings.shouldSplitHeadingsAutomatically = false;
          });

          // Clean up any leftover from a previous run so no folder name is de-duplicated.
          await removeIfExists(ROOT_FOLDER);

          const sourceFile = await resetFile(sourcePath, SOURCE_CONTENT);
          const editor = await openAndGetEditor(sourceFile);
          editor.setCursor({ ch: 0, line: 0 });

          await waitUntil({
            message: 'metadata cache did not index the source headings',
            predicate: () => (app.metadataCache.getFileCache(sourceFile)?.headings ?? []).length === 4
          });

          app.commands.executeCommandById(`${pluginId}:split-note-by-headings-recursively`);

          const expectedPaths = [
            'TplA/TplA.md',
            'TplA/TplB/TplB.md',
            'TplA/TplB/TplC/TplC.md',
            'TplA/TplD/TplD.md'
          ];

          await waitUntil({
            message: 'the heading hierarchy was not mirrored as a folder tree',
            predicate: () => expectedPaths.every((path) => app.vault.getAbstractFileByPath(path) instanceof obsidianModule.TFile)
          });
          // The deferred template pass runs after the whole tree is built, so give it time to land.
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const contents: Record<string, string> = {};
          for (const path of expectedPaths) {
            const file = app.vault.getAbstractFileByPath(path);
            contents[path] = file instanceof obsidianModule.TFile ? await app.vault.read(file) : '';
          }

          return { contents };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.splitTemplate = originalSplitTemplate;
            settings.shouldAskBeforeSplitting = originalShouldAsk;
            settings.shouldSplitIntoFolder = originalShouldSplitIntoFolder;
            settings.shouldSplitHeadingsAutomatically = originalShouldSplitHeadingsAutomatically;
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
          return typeof node.editAndSave === 'function' && Array.isArray(node.settings?.excludePaths);
        }

        async function openAndGetEditor(file: TFile): Promise<Editor> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: 'markdown editor did not open',
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor !== undefined
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          return view.editor;
        }

        async function removeIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
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
      vaultPath: getTempVault().path
    });

    // Every produced note OPENS with the template's header, naming itself.
    expect(result.contents['TplA/TplA.md']?.startsWith('# TplA\n')).toBe(true);
    expect(result.contents['TplA/TplB/TplB.md']?.startsWith('# TplB\n')).toBe(true);
    expect(result.contents['TplA/TplB/TplC/TplC.md']?.startsWith('# TplC\n')).toBe(true);
    expect(result.contents['TplA/TplD/TplD.md']?.startsWith('# TplD\n')).toBe(true);

    // And the template's trailer EXACTLY ONCE, naming the note it was split out of. Before the fix the
    // Trailer was dragged out of a parent into its last child, so a parent had none and that child had two.
    expect(countTrailers(result.contents['TplA/TplA.md'])).toBe(1);
    expect(countTrailers(result.contents['TplA/TplB/TplB.md'])).toBe(1);
    expect(countTrailers(result.contents['TplA/TplB/TplC/TplC.md'])).toBe(1);
    expect(countTrailers(result.contents['TplA/TplD/TplD.md'])).toBe(1);

    expect(result.contents['TplA/TplA.md']).toContain(`From: [[${TEMPLATE_SOURCE_PATH.replace('.md', '')}]]`);
    expect(result.contents['TplA/TplB/TplB.md']).toContain('From: [[TplA]]');
    expect(result.contents['TplA/TplB/TplC/TplC.md']).toContain('From: [[TplB]]');
    expect(result.contents['TplA/TplD/TplD.md']).toContain('From: [[TplA]]');

    // The last child must not inherit its parent's trailer.
    expect(result.contents['TplA/TplD/TplD.md']).not.toContain(TEMPLATE_SOURCE_PATH.replace('.md', ''));
    expect(result.contents['TplA/TplB/TplC/TplC.md']).not.toContain('From: [[TplA]]');

    // Each note still owns only its own body.
    expect(result.contents['TplA/TplA.md']).toContain('body of TplA');
    expect(result.contents['TplA/TplA.md']).not.toContain('body of TplB');
    expect(result.contents['TplA/TplB/TplB.md']).not.toContain('body of TplC');
  });

  it('should root the tree in Obsidian\'s default new note folder, keeping it nested (issue #173)', async () => {
    const result = await evalInObsidian({
      args: { pluginId: PLUGIN_ID },
      async fn({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        /*
         * The source lives in its OWN folder, which is what makes the assertion discriminating: without the
         * setting the tree would be built under `SOURCE_FOLDER`, and with `newFileLocation` left at its
         * `root` default a redirect would be indistinguishable from the vault root. Both wrong answers are
         * therefore distinct paths from the right one.
         */
        const SOURCE_FOLDER = 'RecDefaultSource';
        const DEFAULT_NEW_NOTE_FOLDER = 'RecDefaultTarget';
        const SOURCE_PATH = `${SOURCE_FOLDER}/split-headings-recursively-default-folder-source.md`;
        const SOURCE_CONTENT = [
          'Intro text',
          '',
          '# DefA',
          '',
          'body of DefA',
          '',
          '## DefB',
          '',
          'body of DefB',
          '',
          '### DefC',
          '',
          'body of DefC',
          '',
          '## DefD',
          '',
          'body of DefD',
          ''
        ].join('\n');

        const originalNewFileLocation = app.vault.getConfig('newFileLocation');
        const originalNewFileFolderPath = app.vault.getConfig('newFileFolderPath');
        // `Should split into folder` stays OFF here too: the recursive split builds the folder tree itself,
        // And the redirect must not quietly depend on that setting. The up-front dialog is covered by the
        // First case, so it is skipped here.
        const originalShouldSplitIntoFolder = await setToggle('Should split into folder', false);
        const originalShouldAsk = await setToggle('Should ask before splitting', false);
        const originalShouldSplitRecursivelyIntoDefaultNewNoteFolder = await setToggle('Should split recursively into the default new note folder', true);
        try {
          // Clean up any leftover from a previous run so no folder name is de-duplicated.
          await removeIfExists(DEFAULT_NEW_NOTE_FOLDER);
          await removeIfExists(SOURCE_FOLDER);
          await app.vault.createFolder(DEFAULT_NEW_NOTE_FOLDER);
          await app.vault.createFolder(SOURCE_FOLDER);

          app.vault.setConfig('newFileLocation', 'folder');
          app.vault.setConfig('newFileFolderPath', DEFAULT_NEW_NOTE_FOLDER);

          const sourceFile = await app.vault.create(SOURCE_PATH, SOURCE_CONTENT);
          const editor = await openAndGetEditor(sourceFile);
          editor.setCursor({ ch: 0, line: 0 });

          await waitUntil({
            message: 'metadata cache did not index the source headings',
            predicate: () => (app.metadataCache.getFileCache(sourceFile)?.headings ?? []).length === 4
          });

          app.commands.executeCommandById(`${pluginId}:split-note-by-headings-recursively`);

          const expectedPaths = [
            `${DEFAULT_NEW_NOTE_FOLDER}/DefA/DefA.md`,
            `${DEFAULT_NEW_NOTE_FOLDER}/DefA/DefB/DefB.md`,
            `${DEFAULT_NEW_NOTE_FOLDER}/DefA/DefB/DefC/DefC.md`,
            `${DEFAULT_NEW_NOTE_FOLDER}/DefA/DefD/DefD.md`
          ];

          await waitUntil({
            message: 'the tree was not rooted in the default new note folder',
            predicate: () => expectedPaths.every((path) => app.vault.getAbstractFileByPath(path) instanceof obsidianModule.TFile)
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const contents: Record<string, string> = {};
          for (const path of expectedPaths) {
            const file = app.vault.getAbstractFileByPath(path);
            contents[path] = file instanceof obsidianModule.TFile ? await app.vault.read(file) : '';
          }

          return {
            contents,
            // The negative half: nothing was created beside the source, and the source itself did not move.
            hasNoteBesideSource: app.vault.getAbstractFileByPath(`${SOURCE_FOLDER}/DefA`) !== null,
            hasNoteInVaultRoot: app.vault.getAbstractFileByPath('DefA') !== null,
            sourceContent: await app.vault.read(sourceFile),
            sourceStillInPlace: app.vault.getAbstractFileByPath(SOURCE_PATH) instanceof obsidianModule.TFile
          };
        } finally {
          app.vault.setConfig('newFileLocation', originalNewFileLocation);
          app.vault.setConfig('newFileFolderPath', originalNewFileFolderPath);
          await setToggle('Should split into folder', originalShouldSplitIntoFolder);
          await setToggle('Should ask before splitting', originalShouldAsk);
          await setToggle('Should split recursively into the default new note folder', originalShouldSplitRecursivelyIntoDefaultNewNoteFolder);
        }

        async function openAndGetEditor(file: TFile): Promise<Editor> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: 'markdown editor did not open',
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.editor !== undefined
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          return view.editor;
        }

        async function removeIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }

        async function setToggle(name: string, value: boolean): Promise<boolean> {
          app.setting.open();
          app.setting.openTabById(pluginId);
          const tab = app.setting.pluginTabs.find((pluginTab) => pluginTab.id === pluginId);
          if (!tab) {
            throw new Error('Settings tab was not found.');
          }
          (tab as PluginSettingsTab).displayLegacy();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const item = Array.from(tab.containerEl.querySelectorAll('.setting-item'))
            .find((el) => el.querySelector('.setting-item-name')?.textContent === name);
          const toggle = item?.querySelector('.checkbox-container');
          if (!(toggle instanceof HTMLElement)) {
            throw new Error(`"${name}" toggle was not found.`);
          }
          const wasEnabled = toggle.classList.contains('is-enabled');
          if (wasEnabled !== value) {
            toggle.click();
            await sleep(RENDER_DELAY_IN_MILLISECONDS);
          }
          app.setting.close();
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return wasEnabled;
        }
      },
      vaultPath: getTempVault().path
    });

    // The whole tree is rooted in Obsidian's `Default location for new notes`...
    expect(result.contents['RecDefaultTarget/DefA/DefA.md']).toContain('body of DefA');
    // ...and it is still a TREE: the sub-headings nest under their parent instead of flattening into it.
    expect(result.contents['RecDefaultTarget/DefA/DefB/DefB.md']).toContain('body of DefB');
    expect(result.contents['RecDefaultTarget/DefA/DefB/DefC/DefC.md']).toContain('body of DefC');
    expect(result.contents['RecDefaultTarget/DefA/DefD/DefD.md']).toContain('body of DefD');

    // Each note still owns only its own body.
    expect(result.contents['RecDefaultTarget/DefA/DefA.md']).not.toContain('body of DefB');
    expect(result.contents['RecDefaultTarget/DefA/DefB/DefB.md']).not.toContain('body of DefC');

    // Nothing was left beside the source (the pre-#173 location) or dropped in the vault root.
    expect(result.hasNoteBesideSource).toBe(false);
    expect(result.hasNoteInVaultRoot).toBe(false);

    // The source note itself is not moved — it stays put and links down into the redirected tree.
    expect(result.sourceStillInPlace).toBe(true);
    expect(result.sourceContent).toContain('Intro text');
    expect(result.sourceContent).toContain('DefA');
  });
});

/**
 * Counts how many times the split template's trailer appears in a produced note, which is what tells a
 * correctly templated note (exactly one) from one that also swallowed its parent's trailer (two).
 *
 * @param content - The produced note's content.
 * @returns The number of trailers.
 */
function countTrailers(content: string | undefined): number {
  return (content ?? '').split('From: [[').length - 1;
}
