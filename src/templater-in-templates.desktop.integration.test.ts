import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

/*
 * Issue #284: Templater syntax was honored in `Create folder content template` and not in the two templates the
 * reporter's screenshots name — `Split template` as the notes `Create empty note in folder...` makes are filled
 * with it, and `Folder note aliases template` as `Rename folder...` writes it.
 *
 * Templater itself is not installed in the test vault, and what is under test is what the plugin HANDS it, so a
 * fake `templater-obsidian` stands in: its `overwrite_file_commands` rewrites the note on disk the way the real
 * one does (sees the template's raw command, writes the result back), and its `parse_template` evaluates the one
 * expression these templates use out of the `TOKENS` prelude the plugin generates — a fake returning a constant
 * would pass while the binding was broken. The fake is removed again in a `finally`, as are the settings, since
 * the whole aggregate run shares one `data.json`.
 *
 * Isolation: `npx vitest run --project integration-tests:desktop src/templater-in-templates.desktop.integration.test.ts`.
 */

const PLUGIN_ID = 'advanced-note-composer';

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: TemplaterSettings;
}

interface MenuItemLike {
  callback?: (this: void) => unknown;
  dom?: HTMLElement;
}

interface MenuLike {
  hide: () => unknown;
  items: MenuItemLike[];
}

interface SettingsCarrier {
  editAndSave: (editor: (settings: TemplaterSettings) => void) => Promise<void>;
  settings: TemplaterSettings;
}

interface TemplaterSettings {
  folderNoteAliasesTemplate: string;
  shouldAddCommandsToSubmenu: boolean;
  shouldRunTemplaterOnDestinationFile: boolean;
  splitTemplate: string;
}

describe('Templater in the split and folder-note templates (issue #284)', () => {
  it('runs the split template\'s Templater commands in the note Create empty note in folder... makes', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const WAIT_TIMEOUT_IN_MILLISECONDS = 6000;
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const FOLDER_PATH = 'templater-in-templates-folder';
        const NOTE_NAME = 'templater-in-templates-note';
        const NOTE_PATH = `${FOLDER_PATH}/${NOTE_NAME}.md`;

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        const pluginsRecord: Record<string, unknown> = app.plugins.plugins;
        const originalTemplaterPlugin = pluginsRecord['templater-obsidian'];
        const contentsSeenByTemplater: string[] = [];
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAddCommandsToSubmenu = false;
            settings.shouldRunTemplaterOnDestinationFile = true;
            settings.splitTemplate = '# {{newTitle}}\n\n{{content}}\n\nstamp: <% "RENDERED" %>';
          });
          pluginsRecord['templater-obsidian'] = {
            templater: {
              // eslint-disable-next-line camelcase -- Templater's own API method name.
              overwrite_file_commands: async (file: TFile): Promise<void> => {
                const content = await app.vault.read(file);
                contentsSeenByTemplater.push(content);
                await app.vault.modify(file, content.replaceAll('<% "RENDERED" %>', 'RENDERED'));
              }
            }
          };

          await trashIfExists(NOTE_PATH);
          const folder = app.vault.getFolderByPath(FOLDER_PATH) ?? await app.vault.createFolder(FOLDER_PATH);

          const menu = new obsidianModule.Menu();
          app.workspace.trigger('file-menu', menu, folder, 'file-explorer-context-menu');
          const menuItem = findMenuItem(menu, (text) => text.includes('Create empty note in folder...'));
          if (menuItem?.callback) {
            menuItem.callback();
          } else {
            menuItem?.dom?.click();
          }
          menu.hide();

          await waitUntil({
            message: 'the note name prompt did not open',
            predicate: () => document.querySelector('.prompt-modal .text-box') !== null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const nameInput = document.querySelector('.prompt-modal .text-box');
          if (!(nameInput instanceof HTMLInputElement)) {
            throw new TypeError('No note name prompt input.');
          }
          nameInput.value = NOTE_NAME;
          nameInput.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: 'the typed note name never became valid',
            predicate: () => nameInput.checkValidity(),
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          const okButton = document.querySelector('.prompt-modal .ok-button');
          if (!(okButton instanceof HTMLElement)) {
            throw new TypeError('No note name prompt OK button.');
          }
          okButton.click();

          // A throwing wait would discard what the fake recorded, so give up quietly and assert outside.
          try {
            await waitUntil({
              message: 'the note was never rendered by Templater',
              predicate: async () => {
                const note = app.vault.getFileByPath(NOTE_PATH);
                if (!note) {
                  return false;
                }
                const content = await app.vault.read(note);
                return content.includes('stamp: RENDERED');
              },
              timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
            });
          } catch {
            // Reported below.
          }

          const note = app.vault.getFileByPath(NOTE_PATH);
          return {
            contentsSeenByTemplater,
            noteContent: note ? await app.vault.read(note) : null
          };
        } finally {
          pluginsRecord['templater-obsidian'] = originalTemplaterPlugin;
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAddCommandsToSubmenu = original.shouldAddCommandsToSubmenu;
            settings.shouldRunTemplaterOnDestinationFile = original.shouldRunTemplaterOnDestinationFile;
            settings.splitTemplate = original.splitTemplate;
          });
          await trashIfExists(FOLDER_PATH);
        }

        function findMenuItem(menuLike: MenuLike, isMatch: (text: string) => boolean): MenuItemLike | undefined {
          return menuLike.items.find((item) => isMatch(item.dom?.textContent ?? ''));
        }

        function findSettingsComponent(): SettingsCarrier {
          const plugin = app.plugins.getPlugin(pluginId) as ComponentTreeNode | null;
          const queue: ComponentTreeNode[] = plugin ? [plugin] : [];
          while (queue.length > 0) {
            const node = queue.shift();
            if (!node) {
              continue;
            }
            if (typeof node.editAndSave === 'function' && typeof node.settings?.splitTemplate === 'string') {
              return node as SettingsCarrier;
            }
            if (node._children) {
              queue.push(...node._children);
            }
          }
          throw new Error('Settings component was not found.');
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // Templater was handed the note once it held the template, raw command and all...
    expect(result.contentsSeenByTemplater).toEqual(['# templater-in-templates-note\n\n\n\nstamp: <% "RENDERED" %>']);
    // ...and what it rendered is what the note ends up holding.
    expect(result.noteContent).toBe('# templater-in-templates-note\n\n\n\nstamp: RENDERED');
  });

  it('renders the folder note aliases template through Templater when Rename folder... writes it', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const WAIT_TIMEOUT_IN_MILLISECONDS = 6000;
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const ROOT = 'templater-in-templates-rename';
        const OLD_FOLDER_NAME = '1. Alpha';
        const NEW_FOLDER_NAME = '1. Beta';
        const NEW_NOTE_PATH = `${ROOT}/${NEW_FOLDER_NAME}/${NEW_FOLDER_NAME}.md`;

        const settingsComponent = findSettingsComponent();
        const original = { ...settingsComponent.settings };
        const pluginsRecord: Record<string, unknown> = app.plugins.plugins;
        const originalTemplaterPlugin = pluginsRecord['templater-obsidian'];
        const recordedTargetPaths: string[] = [];
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.shouldAddCommandsToSubmenu = false;
            settings.folderNoteAliasesTemplate = '<% TOKENS.safeFolderName.toUpperCase() %>';
          });
          pluginsRecord['templater-obsidian'] = {
            templater: {
              /* eslint-disable camelcase -- Templater's own API method names. */
              create_running_config: (_templateFile: unknown, targetFile: TFile): unknown => {
                recordedTargetPaths.push(targetFile.path);
                return {};
              },
              // Evaluates the one expression the template holds, out of the prelude the plugin generated.
              parse_template: (_config: unknown, content: string): Promise<string> => {
                const match = /"safeFolderName":"(?<safeFolderName>[^"]*)"/.exec(content);
                return Promise.resolve((match?.groups?.['safeFolderName'] ?? '').toUpperCase());
              }
              /* eslint-enable camelcase -- Templater's own API method names. */
            }
          };

          await trashIfExists(ROOT);
          await app.vault.createFolder(ROOT);
          await app.vault.createFolder(`${ROOT}/${OLD_FOLDER_NAME}`);
          await app.vault.create(`${ROOT}/${OLD_FOLDER_NAME}/${OLD_FOLDER_NAME}.md`, '---\naliases:\n  - "ALPHA"\n  - "my own alias"\n---\n\nbody\n');
          const folder = app.vault.getFolderByPath(`${ROOT}/${OLD_FOLDER_NAME}`);
          if (!folder) {
            throw new TypeError('No folder to rename.');
          }

          const menu = new obsidianModule.Menu();
          app.workspace.trigger('file-menu', menu, folder, 'file-explorer-context-menu');
          const itemEl = findMenuItem(menu, (text) => text === 'Rename folder...')?.dom;
          if (!itemEl) {
            throw new TypeError('No Rename folder... menu item.');
          }
          itemEl.click();
          menu.hide();

          await waitUntil({
            message: 'rename prompt did not open',
            predicate: () => document.querySelector('.prompt-modal .text-box') !== null,
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const nameInput = document.querySelector('.prompt-modal .text-box');
          if (!(nameInput instanceof HTMLInputElement)) {
            throw new TypeError('No folder name prompt input.');
          }
          nameInput.value = 'Beta';
          nameInput.dispatchEvent(new Event('input', { bubbles: true }));
          await waitUntil({
            message: 'the typed folder name never became valid',
            predicate: () => nameInput.checkValidity(),
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
          const okButton = document.querySelector('.prompt-modal .ok-button');
          if (!(okButton instanceof HTMLElement)) {
            throw new TypeError('No folder name prompt OK button.');
          }
          okButton.click();

          try {
            await waitUntil({
              message: 'the folder note never got its rendered alias',
              predicate: async () => {
                const note = app.vault.getFileByPath(NEW_NOTE_PATH);
                if (!note) {
                  return false;
                }
                const content = await app.vault.read(note);
                return content.includes('BETA');
              },
              timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
            });
          } catch {
            // Reported below.
          }

          const note = app.vault.getFileByPath(NEW_NOTE_PATH);
          return {
            noteContent: note ? await app.vault.read(note) : null,
            recordedTargetPaths: [...new Set(recordedTargetPaths)]
          };
        } finally {
          pluginsRecord['templater-obsidian'] = originalTemplaterPlugin;
          await settingsComponent.editAndSave((settings) => {
            settings.folderNoteAliasesTemplate = original.folderNoteAliasesTemplate;
            settings.shouldAddCommandsToSubmenu = original.shouldAddCommandsToSubmenu;
          });
          await trashIfExists(ROOT);
        }

        function findMenuItem(menuLike: MenuLike, isMatch: (text: string) => boolean): MenuItemLike | undefined {
          return menuLike.items.find((item) => isMatch(item.dom?.textContent ?? ''));
        }

        function findSettingsComponent(): SettingsCarrier {
          const plugin = app.plugins.getPlugin(pluginId) as ComponentTreeNode | null;
          const queue: ComponentTreeNode[] = plugin ? [plugin] : [];
          while (queue.length > 0) {
            const node = queue.shift();
            if (!node) {
              continue;
            }
            if (typeof node.editAndSave === 'function' && typeof node.settings?.folderNoteAliasesTemplate === 'string') {
              return node as SettingsCarrier;
            }
            if (node._children) {
              queue.push(...node._children);
            }
          }
          throw new Error('Settings component was not found.');
        }

        async function trashIfExists(path: string): Promise<void> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The OLD alias was rendered through Templater too, which is why `ALPHA` is found and swapped for `BETA`
    // while the hand-written alias survives.
    expect(result.noteContent).toContain('- BETA');
    expect(result.noteContent).not.toContain('ALPHA');
    expect(result.noteContent).toContain('- my own alias');
    // `tp.file` was the folder note, under its new name.
    expect(result.recordedTargetPaths).toEqual(['templater-in-templates-rename/1. Beta/1. Beta.md']);
  });
});
