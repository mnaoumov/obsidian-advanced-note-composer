import type {
  TFile,
  TFolder
} from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

/*
 * Issue #218: with a Templater `Name transform template` configured and NO note open, every command that
 * names something refused — `Create folder with notes...` reported it in its name prompt, `Merge folder
 * contents into a single file...` as a notice, both of them the one refusal. A folder command has no note of
 * its own to offer Templater, and Templater insists on a file, so the fix is a fallback chain that finds one.
 *
 * Desktop-only: the whole point is a REAL workspace with nothing open, driven through the real name prompt.
 * Templater itself is not installed in the test vault and installing it is not what is under test — which
 * note is handed over is — so a fake `templater-obsidian` records the `target_file` it is given and evaluates
 * the reporter's own template out of the `TOKENS` prelude the plugin builds. That also keeps the assertion
 * honest about what it proves: the plugin reaches Templater with a resolvable note instead of refusing;
 * whether real Templater accepts it is verified by hand against a vault that has it.
 *
 * Isolation: `npx vitest run --project integration-tests:desktop src/name-transform-no-open-note.desktop.integration.test.ts`.
 */
const PLUGIN_ID = 'advanced-note-composer';

// The reporter's own transform, verbatim.
const NAME_TRANSFORM_TEMPLATE = '<% TOKENS.rawString.replaceAll(": ", " - ") %>';

/**
 * The same mapping over `_`, for the folder-merge half. The merged note's name comes from a note-name
 * template, and `validateNoteNameTemplate` refuses a literal `:` there (a file name cannot hold one), so the
 * reporter's own mapping has nothing to bite on — while any non-empty transform still has to RUN, which is
 * the refusal issue #218 was about.
 */
const MERGE_NAME_TRANSFORM_TEMPLATE = '<% TOKENS.rawString.replaceAll("_", " - ") %>';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: NameTransformSettings;
}

interface MenuItemLike {
  /**
   * Set by whatever registered the item — a submenu PARENT has none, which is what distinguishes it from the
   * leaf that actually runs the command.
   */
  callback?(): void;

  dom?: HTMLElement;

  /**
   * Present when the plugin's items are nested under one entry, which is the default.
   */
  submenu?: MenuLike;
}

interface MenuLike {
  hide(): void;
  items: MenuItemLike[];
}

interface NameTransformSettings {
  mergeFolderIntoFileNoteNameTemplate: string;
  nameTransformTemplate: string;
  newFolderContentTemplate: string;
  newFolderNameTemplate: string;
  shouldAskBeforeCreatingFolder: boolean;
  shouldAskBeforeMerging: boolean;
  shouldOpenNoteAfterCreatingFolder: boolean;
  shouldRunTemplaterOnDestinationFile: boolean;
  shouldTitleCaseCreatedFolderName: boolean;
}

interface SettingsCarrier {
  editAndSave(editor: (settings: NameTransformSettings) => void): Promise<void>;
  settings: NameTransformSettings;
}

describe('name transform with no note open (issue #218)', () => {
  it('runs the templater transform against the note last opened instead of refusing the command', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, nameTransformTemplate, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const PARENT_PATH = 't430-no-open-note-parent';
        const CONTEXT_PATH = 't430-no-open-note-context.md';
        // A path in the recent list that no longer resolves — the chain has to walk past it, which is the
        // Half of the resolution a vault accumulates naturally over a session of renames and deletions.
        const DELETED_PATH = 't430-no-open-note-deleted.md';
        const TYPED_NAME = 'T430: Alpha';
        const EXPECTED_FOLDER_NAME = 'T430 - Alpha';
        const EXPECTED_FOLDER_PATH = `${PARENT_PATH}/${EXPECTED_FOLDER_NAME}`;

        const settingsComponent = findSettingsComponent();
        const originalSettings = { ...settingsComponent.settings };
        const originalNewFileLocation = app.vault.getConfig('newFileLocation');
        const originalNewFileFolderPath = app.vault.getConfig('newFileFolderPath');
        const originalGetRecentFiles = app.workspace.getRecentFiles;
        // The temporary vault has no Templater, so this is `undefined` — restoring it therefore restores the
        // "not installed" state, which is what the rest of the suite expects to find.
        const pluginsRecord: Record<string, unknown> = app.plugins.plugins;
        const originalTemplaterPlugin = pluginsRecord['templater-obsidian'];

        const noticeTexts = new Set<string>();
        const recordedTargetPaths: string[] = [];
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.nameTransformTemplate = nameTransformTemplate;
            // One note named after the folder, no numbering, no Title Case pass: the created path is then
            // Exactly what the transform produced, with nothing else able to have rewritten it.
            settings.newFolderNameTemplate = '{{safeFolderName}}';
            settings.newFolderContentTemplate = '';
            settings.shouldAskBeforeCreatingFolder = false;
            settings.shouldOpenNoteAfterCreatingFolder = false;
            settings.shouldTitleCaseCreatedFolderName = false;
            // The created notes are not what this test is about, and the fake below would run over them too.
            settings.shouldRunTemplaterOnDestinationFile = false;
          });

          pluginsRecord['templater-obsidian'] = createFakeTemplaterPlugin();

          await trashIfExists(PARENT_PATH);
          await trashIfExists(CONTEXT_PATH);
          await app.vault.createFolder(PARENT_PATH);
          await app.vault.create(CONTEXT_PATH, 'the note the run should report on');
          app.vault.setConfig('newFileLocation', 'folder');
          app.vault.setConfig('newFileFolderPath', PARENT_PATH);

          /*
           * Obsidian's own recent list is fed by whatever the rest of the aggregate happened to open, so it
           * is replaced for the duration: the chain's ORDER and its "walk past what no longer resolves" step
           * are what is under test here, not `RecentFileTracker`.
           */
          app.workspace.getRecentFiles = (): string[] => [DELETED_PATH, CONTEXT_PATH];

          // The reporter's scenario, and the reason the command used to refuse.
          app.workspace.detachLeavesOfType('markdown');
          await waitUntil({
            message: 'a note stayed open',
            predicate: () => app.workspace.getActiveFile() === null
          });

          app.commands.executeCommandById(`${pluginId}:create-folder-with-notes`);

          await waitUntil({
            message: 'folder name prompt did not open',
            predicate: () => document.querySelector('.prompt-modal .text-box') !== null
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const nameInput = document.querySelector('.prompt-modal .text-box');
          if (!(nameInput instanceof HTMLInputElement)) {
            throw new TypeError('No folder name prompt input.');
          }
          nameInput.value = TYPED_NAME;
          // The modal tracks its value through the component's change handler, so a bare `value` assignment
          // Would be submitted as an empty name.
          nameInput.dispatchEvent(new Event('input', { bubbles: true }));

          /*
           * The prompt validates ASYNCHRONOUSLY and refuses to submit while invalid — and before #218 the
           * validator is exactly where the refusal landed, so this wait never settling IS the bug: the typed
           * name could not become valid while no note was open.
           */
          let isTypedNameValid = false;
          try {
            await waitUntil({
              message: 'the typed folder name never became valid',
              predicate: () => {
                collectNotices();
                return nameInput.checkValidity();
              }
            });
            isTypedNameValid = true;
          } catch {
            // Reported by the assertions outside, together with whatever the validator said.
          }

          if (isTypedNameValid) {
            const okButton = document.querySelector('.prompt-modal .ok-button');
            if (!(okButton instanceof HTMLElement)) {
              throw new TypeError('No folder name prompt OK button.');
            }
            okButton.click();

            // A throwing wait would discard the notices and the recorded target, so give up quietly.
            try {
              await waitUntil({
                message: 'the folder and its note were not created',
                predicate: () => {
                  collectNotices();
                  return app.vault.getAbstractFileByPath(`${EXPECTED_FOLDER_PATH}/${EXPECTED_FOLDER_NAME}.md`) !== null;
                }
              });
            } catch {
              // Reported below.
            }
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          collectNotices();

          return {
            isTypedNameValid,
            noticeTexts: [...noticeTexts],
            parentChildren: app.vault.getFolderByPath(PARENT_PATH)?.children.map((child) => child.path).sort() ?? [],
            promptValidationMessage: nameInput.validationMessage,
            recordedTargetPaths: [...new Set(recordedTargetPaths)].sort(),
            wasTemplaterCalled: recordedTargetPaths.length > 0
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            Object.assign(settings, originalSettings);
          });
          app.vault.setConfig('newFileLocation', originalNewFileLocation);
          app.vault.setConfig('newFileFolderPath', originalNewFileFolderPath);
          app.workspace.getRecentFiles = originalGetRecentFiles;
          pluginsRecord['templater-obsidian'] = originalTemplaterPlugin;
          await trashIfExists(PARENT_PATH);
          await trashIfExists(CONTEXT_PATH);
        }

        function collectNotices(): void {
          // Notices auto-hide and render into `activeDocument`, so they are gathered on every poll.
          for (const noticeEl of activeDocument.querySelectorAll('.notice')) {
            const text = noticeEl.textContent;
            if (text) {
              noticeTexts.add(text);
            }
          }
        }

        function createFakeTemplaterPlugin(): unknown {
          return {
            templater: {
              /* eslint-disable camelcase -- Templater's own API method names. */
              create_running_config: (templateFile: unknown, targetFile: null | TFile | undefined, runMode: number): unknown => {
                recordedTargetPaths.push(targetFile?.path ?? '<no target file>');
                return {
                  active_file: null,
                  run_mode: runMode,
                  target_file: targetFile,
                  template_file: templateFile
                };
              },
              /*
               * The reporter's template, evaluated the only way a fake can honestly evaluate it: by reading
               * `TOKENS.rawString` back out of the prelude the plugin generated. A fake returning a constant
               * would still pass while the binding was broken.
               */
              parse_template: (_config: unknown, content: string): Promise<string> => {
                const rawStringMatch = /"rawString":"(?<rawString>[^"]*)"/.exec(content);
                return Promise.resolve((rawStringMatch?.groups?.['rawString'] ?? '').replaceAll(': ', ' - '));
              }
              /* eslint-enable camelcase -- Templater's own API method names. */
            }
          };
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
          return typeof node.editAndSave === 'function' && typeof node.settings?.nameTransformTemplate === 'string';
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }
      },
      input: { nameTransformTemplate: NAME_TRANSFORM_TEMPLATE, pluginId: PLUGIN_ID }
    });

    // The refusal is gone: before #218 the validator held the typed name invalid with this exact message.
    expect(result.promptValidationMessage).not.toContain('Name transform template uses Templater syntax');
    expect(result.noticeTexts.filter((text) => text.includes('Name transform template'))).toStrictEqual([]);
    expect(result.isTypedNameValid).toBe(true);

    // Templater ran, and against the note last opened — the deleted path ahead of it in the recent list was
    // Walked past rather than handed over.
    expect(result.wasTemplaterCalled).toBe(true);
    expect(result.recordedTargetPaths).toStrictEqual(['t430-no-open-note-context.md']);

    // And the transform actually produced the name, with `T430: Alpha` becoming `T430 - Alpha`.
    expect(result.parentChildren).toStrictEqual([
      't430-no-open-note-parent/T430 - Alpha'
    ]);
  });

  it('gets markdown paths back from Obsidian\'s own recent list for the options the fallback asks with', async () => {
    /*
     * The premise of the recent-note step, which the two tests around this one stub out so they can pin the
     * ORDER of the chain. If Obsidian ever stopped honouring these flags the way they read — most plausibly
     * `showNonAttachments`, whose name does not obviously exclude a note — the step would go quietly dead and
     * every fallback would silently become "the newest note", so it is worth one real check.
     */
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule }) {
        const FIRST_PATH = 't430-recent-first.md';
        const SECOND_PATH = 't430-recent-second.md';
        try {
          await trashIfExists(FIRST_PATH);
          await trashIfExists(SECOND_PATH);
          const firstFile = await app.vault.create(FIRST_PATH, 'first');
          const secondFile = await app.vault.create(SECOND_PATH, 'second');

          // Obsidian's `RecentFileTracker` collects the file you LEFT, so the first note only lands in the
          // List once the second one is opened.
          await openFile(firstFile);
          await openFile(secondFile);

          return {
            recentPaths: app.workspace.getRecentFiles({
              maxCount: 50,
              showCanvas: false,
              showImages: false,
              showMarkdown: true,
              showNonAttachments: false,
              showNonImageAttachments: false
            })
          };
        } finally {
          app.workspace.detachLeavesOfType('markdown');
          await trashIfExists(FIRST_PATH);
          await trashIfExists(SECOND_PATH);
        }

        async function openFile(file: TFile): Promise<void> {
          await app.workspace.getLeaf(false).openFile(file);
          await waitUntil({
            message: `${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
          });
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }
      }
    });

    expect(result.recentPaths).toContain('t430-recent-first.md');
  });

  it('merges a folder into a single file with no note open, where the notice used to say a note was needed', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, nameTransformTemplate, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const MENU_ITEM_TITLE = 'Merge folder contents into a single file...';
        const SOURCE_PATH = 't430-merge-no-open-note-src';
        const CONTEXT_PATH = 't430-merge-no-open-note-context.md';
        /*
         * A literal template, so the merged note's name comes out of the TRANSFORM and its own tokens are one
         * less thing able to explain the result. It maps `_` rather than the reporter's `: `, because
         * `validateNoteNameTemplate` rightly refuses a literal `:` in a note name — and a folder cannot hold
         * one either, so the reporter's own mapping can never fire on this path. What #218 was about is the
         * transform RUNNING at all here, which any non-empty template makes it do.
         */
        const NOTE_NAME_TEMPLATE = 'T430m_Merged';
        const EXPECTED_MERGED_PATH = 'T430m - Merged.md';

        const settingsComponent = findSettingsComponent();
        const originalSettings = { ...settingsComponent.settings };
        const originalGetRecentFiles = app.workspace.getRecentFiles;
        const pluginsRecord: Record<string, unknown> = app.plugins.plugins;
        const originalTemplaterPlugin = pluginsRecord['templater-obsidian'];

        const noticeTexts = new Set<string>();
        const recordedTargetPaths: string[] = [];
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.nameTransformTemplate = nameTransformTemplate;
            settings.mergeFolderIntoFileNoteNameTemplate = NOTE_NAME_TEMPLATE;
            settings.shouldAskBeforeMerging = false;
          });

          pluginsRecord['templater-obsidian'] = createFakeTemplaterPlugin();

          await trashIfExists(SOURCE_PATH);
          await trashIfExists(CONTEXT_PATH);
          await trashIfExists(EXPECTED_MERGED_PATH);
          await app.vault.createFolder(SOURCE_PATH);
          // Two notes: a single-note folder is not offered the merge at all (issue #209).
          await app.vault.create(`${SOURCE_PATH}/t430m-alpha.md`, 'alpha body');
          await app.vault.create(`${SOURCE_PATH}/t430m-bravo.md`, 'bravo body');
          await app.vault.create(CONTEXT_PATH, 'the note the run should report on');

          app.workspace.getRecentFiles = (): string[] => [CONTEXT_PATH];
          app.workspace.detachLeavesOfType('markdown');
          await waitUntil({
            message: 'a note stayed open',
            predicate: () => app.workspace.getActiveFile() === null
          });

          /*
           * The folder MENU, not the palette: a folder command's palette path resolves the active note's
           * parent folder, so with nothing open Obsidian hides it — which is a separate wall, deliberately
           * left standing, and the entry point the reporter actually used.
           */
          const menuItem = findPluginMenuItem(getFolder(SOURCE_PATH), MENU_ITEM_TITLE);
          if (!menuItem) {
            throw new Error(`"${MENU_ITEM_TITLE}" was not in the plugin's section of the folder menu.`);
          }
          menuItem.callback?.();

          // A throwing wait would discard the notices, and the notice IS the reported symptom.
          try {
            await waitUntil({
              message: 'the merged note was not created',
              predicate: () => {
                collectNotices();
                return app.vault.getAbstractFileByPath(EXPECTED_MERGED_PATH) !== null;
              }
            });
          } catch {
            // Reported by the assertions outside.
          }
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          collectNotices();

          const mergedFile = app.vault.getFileByPath(EXPECTED_MERGED_PATH);
          return {
            mergedContent: mergedFile ? await app.vault.read(mergedFile) : null,
            noticeTexts: [...noticeTexts],
            recordedTargetPaths: [...new Set(recordedTargetPaths)].sort(),
            // Every note this test is responsible for, so a merge that landed under another name says which
            // One instead of only reporting a `null` content.
            t430Paths: app.vault.getMarkdownFiles().map((file) => file.path).filter((path) => path.toLowerCase().includes('t430')).sort()
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            Object.assign(settings, originalSettings);
          });
          // eslint-disable-next-line require-atomic-updates -- Putting back the stub this test installed; nothing else is running.
          app.workspace.getRecentFiles = originalGetRecentFiles;
          pluginsRecord['templater-obsidian'] = originalTemplaterPlugin;
          await trashIfExists(SOURCE_PATH);
          await trashIfExists(CONTEXT_PATH);
          await trashIfExists(EXPECTED_MERGED_PATH);
        }

        function collectNotices(): void {
          for (const noticeEl of activeDocument.querySelectorAll('.notice')) {
            const text = noticeEl.textContent;
            if (text) {
              noticeTexts.add(text);
            }
          }
        }

        function createFakeTemplaterPlugin(): unknown {
          return {
            templater: {
              /* eslint-disable camelcase -- Templater's own API method names. */
              create_running_config: (templateFile: unknown, targetFile: null | TFile | undefined, runMode: number): unknown => {
                recordedTargetPaths.push(targetFile?.path ?? '<no target file>');
                return {
                  active_file: null,
                  run_mode: runMode,
                  target_file: targetFile,
                  template_file: templateFile
                };
              },
              // Emulates the template this test sets, by reading `TOKENS.rawString` back out of the prelude
              // The plugin generated — a fake returning a constant would pass with the binding broken.
              parse_template: (_config: unknown, content: string): Promise<string> => {
                const rawStringMatch = /"rawString":"(?<rawString>[^"]*)"/.exec(content);
                return Promise.resolve((rawStringMatch?.groups?.['rawString'] ?? '').replaceAll('_', ' - '));
              }
              /* eslint-enable camelcase -- Templater's own API method names. */
            }
          };
        }

        function findInMenu(menu: MenuLike, itemTitle: string): MenuItemLike | undefined {
          for (const item of menu.items) {
            // The title is enough to identify it — Obsidian core contributes no folder-menu item by this
            // Name — and the `callback` requirement is what skips the submenu parent that merely contains it.
            if (item.callback && (item.dom?.textContent ?? '').includes(itemTitle)) {
              return item;
            }
            // With the submenu setting on — the default — the plugin's items are one level down.
            const nested = item.submenu ? findInMenu(item.submenu, itemTitle) : undefined;
            if (nested) {
              return nested;
            }
          }
          return undefined;
        }

        function findPluginMenuItem(folder: TFolder, itemTitle: string): MenuItemLike | undefined {
          const menu = new obsidianModule.Menu();
          app.workspace.trigger('file-menu', menu, folder, 'file-explorer-context-menu');
          const item = findInMenu(menu as MenuLike, itemTitle);
          (menu as MenuLike).hide();
          return item;
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

        function getFolder(path: string): TFolder {
          const folder = app.vault.getFolderByPath(path);
          if (!folder) {
            throw new Error(`${path} was not created.`);
          }
          return folder;
        }

        function isSettingsComponent(node: ComponentTreeNode): node is SettingsCarrier {
          return typeof node.editAndSave === 'function' && typeof node.settings?.nameTransformTemplate === 'string';
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }
      },
      input: { nameTransformTemplate: MERGE_NAME_TRANSFORM_TEMPLATE, pluginId: PLUGIN_ID }
    });

    // The refusal the reporter saw as a notice is gone...
    expect(result.noticeTexts.filter((text) => text.includes('Name transform template'))).toStrictEqual([]);
    /*
     * ...and the merge ran under the name the TRANSFORM produced — `T430m_Merged` became `T430m - Merged`,
     * not the folder's own name, which is what `resolveTargetBasename` falls back to when the transform never
     * happens. Asserted before the content, because it names what happened when the rest fails.
     */
    expect(result.t430Paths).toStrictEqual(['T430m - Merged.md', 't430-merge-no-open-note-context.md']);
    expect(result.recordedTargetPaths).toStrictEqual(['t430-merge-no-open-note-context.md']);
    expect(result.mergedContent).toContain('alpha body');
    expect(result.mergedContent).toContain('bravo body');
  });
});
