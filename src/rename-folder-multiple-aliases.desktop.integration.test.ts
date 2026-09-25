import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

/**
 * Issue #294: the `Folder note aliases template` yields one alias per line of its rendered result, and a
 * rename swaps the whole SET the old name rendered for the set the new one renders, leaving hand-written
 * aliases alone.
 *
 * Only a real Obsidian can show that the list survives the round trip through the frontmatter writer as a
 * YAML list of separate entries, which is exactly what the reporter found broken: a multi-value render used
 * to land as one quoted string.
 *
 * The template written here is RESTORED in a `finally`: `data.json` is shared by the whole aggregate run.
 *
 * Isolation: `npx vitest run --project integration-tests:desktop src/rename-folder-multiple-aliases.desktop.integration.test.ts`.
 */

const PLUGIN_ID = 'advanced-note-composer';

const ALIASES_TEMPLATE = '{{safeFolderName}}\n{{parentFolder}} {{safeFolderName}}';

interface AliasSettings {
  defaultSplitTargetMode: string;
  folderNoteAliasesTemplate: string;
}

interface ComponentTreeNode {
  _children?: ComponentTreeNode[];
  editAndSave?: unknown;
  settings?: AliasSettings;
}

interface MenuItemLike {
  dom?: HTMLElement;
}

interface MenuLike {
  items: MenuItemLike[];
}

interface SettingsCarrier {
  editAndSave: (editor: (settings: AliasSettings) => void) => Promise<void>;
  settings: AliasSettings;
}

describe('rename folder with a multi-line aliases template (issue #294)', () => {
  it('should swap every alias the old name derived for every alias the new one derives', async () => {
    const result = await evalInObsidian({
      async callback({ aliasesTemplate, app, lib: { waitUntil }, obsidianModule, pluginId }) {
        // Every wait in this closure shares one ceiling, four of them in total, well under the transport's cap.
        const WAIT_TIMEOUT_IN_MILLISECONDS = 5000;
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        // Distinctive names: the whole aggregate run shares ONE vault.
        const ROOT = 'Rename folder aliases';
        const OLD_FOLDER_PATH = `${ROOT}/Alpha`;
        const NEW_NOTE_PATH = `${ROOT}/Beta/Beta.md`;

        const settingsComponent = findSettingsComponent();
        const originalTemplate = settingsComponent.settings.folderNoteAliasesTemplate;
        try {
          await settingsComponent.editAndSave((settings) => {
            settings.folderNoteAliasesTemplate = aliasesTemplate;
          });

          // Both derived aliases, with a hand-written one BETWEEN them, so the test tells "the new block goes
          // where the first old alias stood" from "the new aliases are appended".
          await app.vault.createFolder(ROOT);
          await app.vault.createFolder(OLD_FOLDER_PATH);
          await app.vault.create(
            `${OLD_FOLDER_PATH}/Alpha.md`,
            `---\naliases:\n  - Alpha\n  - my own alias\n  - ${ROOT} Alpha\n---\n\nAlpha body\n`
          );

          const folder = app.vault.getFolderByPath(OLD_FOLDER_PATH);
          if (!(folder instanceof obsidianModule.TFolder)) {
            throw new TypeError(`No folder at ${OLD_FOLDER_PATH}.`);
          }

          const menu = new obsidianModule.Menu();
          app.workspace.trigger('file-menu', menu, folder, 'file-explorer-context-menu');
          const itemEl = (menu as Partial<MenuLike>).items?.find((candidate) => candidate.dom?.textContent === 'Rename folder...')?.dom;
          if (!itemEl) {
            throw new TypeError('No "Rename folder..." menu item.');
          }
          itemEl.click();

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

          // The prompt validates ASYNCHRONOUSLY and silently refuses to submit while the input is invalid.
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

          // Waits for the LAST write of the operation, the properties; a throwing wait would discard the
          // evidence, so give up quietly and let the assertions outside report what actually landed.
          try {
            await waitUntil({
              message: 'the folder note aliases were not rewritten',
              predicate: async () => {
                const noteFile = app.vault.getFileByPath(NEW_NOTE_PATH);
                if (!noteFile) {
                  return false;
                }
                const noteContent = await app.vault.read(noteFile);
                return noteContent.includes('- Beta');
              },
              timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
            });
          } catch {
            // Diagnostics are returned below.
          }

          const noteFile = app.vault.getFileByPath(NEW_NOTE_PATH);
          const content = noteFile ? await app.vault.read(noteFile) : null;
          const yaml = content === null ? null : /^---\n(?<Yaml>[\s\S]*?)\n---/.exec(content)?.groups?.['Yaml'] ?? null;
          return {
            aliases: yaml === null ? null : (obsidianModule.parseYaml(yaml) as Record<string, unknown>)['aliases'],
            content
          };
        } finally {
          await settingsComponent.editAndSave((settings) => {
            settings.folderNoteAliasesTemplate = originalTemplate;
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
          return typeof node.editAndSave === 'function' && typeof node.settings?.defaultSplitTargetMode === 'string';
        }
      },
      input: { aliasesTemplate: ALIASES_TEMPLATE, pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // Two separate list entries, not one string holding a line break; the new block sits where the first old
    // alias stood, the second old alias is gone, and the hand-written one kept its place after the block.
    expect(result.aliases).toEqual(['Beta', 'Rename folder aliases Beta', 'my own alias']);
    expect(result.content).toContain('Alpha body');
  });
});
