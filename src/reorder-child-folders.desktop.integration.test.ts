import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

const PLUGIN_ID = 'advanced-note-composer';

interface MenuItemLike {
  dom?: HTMLElement;
}

interface MenuLike {
  hide(): void;
  items: MenuItemLike[];
}

describe('reorder child folders', () => {
  it('should renumber every sibling folder and rewrite each folder note\'s title', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const ROOT = 'Reorder child folders';

        // A folder whose children are numbered out of the order they will be left in, each holding a
        // Folder note named after its folder (the `Auto` fallback layout) with a `title` to rewrite.
        await removeFolder(ROOT);
        await app.vault.createFolder(ROOT);
        for (const [index, name] of ['Alpha', 'Beta', 'Gamma'].entries()) {
          const folderName = `${(index + 1).toString()}. ${name}`;
          await app.vault.createFolder(`${ROOT}/${folderName}`);
          await app.vault.create(`${ROOT}/${folderName}/${folderName}.md`, `---\ntitle: "${folderName}"\naliases:\n  - "${name}"\n---\n\n${name} body\n`);
        }

        const rootFolder = app.vault.getFolderByPath(ROOT);
        if (!(rootFolder instanceof obsidianModule.TFolder)) {
          throw new TypeError(`No folder at ${ROOT}.`);
        }

        // Driven through the folder MENU, which is how the command is actually reached: the palette path
        // Resolves the parent from Obsidian's own new-note location, not from this folder.
        const menu = new obsidianModule.Menu();
        app.workspace.trigger('file-menu', menu, rootFolder, 'file-explorer-context-menu');
        clickMenuItem(menu, 'Reorder child folders...');

        await waitUntil({
          message: 'reorder modal did not open',
          predicate: () => document.querySelector('.advanced-note-composer-reorder-list') !== null
        });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        const rowLabels = [...document.querySelectorAll<HTMLElement>('.advanced-note-composer-reorder-item')]
          .map((itemEl) => itemEl.dataset['rowLabel']);
        const indexBadges = [...document.querySelectorAll('.advanced-note-composer-reorder-index')]
          .map((indexEl) => indexEl.textContent);

        // Alpha down twice -> Beta, Gamma, Alpha.
        moveDown('Alpha');
        await sleep(RENDER_DELAY_IN_MILLISECONDS);
        moveDown('Alpha');
        await sleep(RENDER_DELAY_IN_MILLISECONDS);
        clickReorder();

        // Waits for the LAST thing the operation does, not the first: the folder renames land before the
        // Folder notes are renamed and retitled, so waiting on the folder alone reads the notes mid-flight
        // — which is exactly what made this flake in the aggregate run and pass on its own.
        await waitUntil({
          message: 'folders were not renumbered and retitled',
          predicate: async () => {
            const noteFile = app.vault.getFileByPath(`${ROOT}/3. Alpha/3. Alpha.md`);
            if (!noteFile) {
              return false;
            }
            const content = await app.vault.read(noteFile);
            return content.includes('title: 3. Alpha');
          }
        });

        const folderNames = (app.vault.getFolderByPath(ROOT)?.children ?? [])
          .filter((child) => child instanceof obsidianModule.TFolder)
          .map((child) => child.name)
          .sort();
        const titles = await Promise.all(folderNames.map(async (folderName) => {
          const noteFile = app.vault.getFileByPath(`${ROOT}/${folderName}/${folderName}.md`);
          if (!noteFile) {
            return `MISSING ${folderName}`;
          }
          const content = await app.vault.read(noteFile);
          return /^title: (?<Title>.*)$/m.exec(content)?.groups?.['Title'] ?? `NO TITLE ${folderName}`;
        }));
        const aliasesNote = app.vault.getFileByPath(`${ROOT}/3. Alpha/3. Alpha.md`);
        const aliasesContent = aliasesNote ? await app.vault.read(aliasesNote) : '';

        return {
          aliasesContent,
          folderNames,
          indexBadges,
          rowLabels,
          titles
        };

        function clickReorder(): void {
          const button = [...document.querySelectorAll('.modal-button-container button')]
            .find((el) => el.textContent === 'Reorder');
          if (!(button instanceof HTMLButtonElement)) {
            throw new TypeError('No Reorder button.');
          }
          button.click();
        }

        function clickMenuItem(menuToSearch: MenuLike, title: string): void {
          // Identified by its rendered text, the way the other folder-menu tests do — `MenuItem` exposes no
          // Title of its own.
          const itemEl = menuToSearch.items.find((candidate) => candidate.dom?.textContent === title)?.dom;
          if (!itemEl) {
            const available = menuToSearch.items.map((candidate) => candidate.dom?.textContent ?? '').join(' | ');
            throw new TypeError(`No menu item "${title}". Available: ${available}`);
          }
          itemEl.click();
        }

        function moveDown(rowLabel: string): void {
          const button = document.querySelector(
            `.advanced-note-composer-reorder-item[data-row-label="${CSS.escape(rowLabel)}"] .advanced-note-composer-reorder-down`
          );
          if (!(button instanceof HTMLButtonElement)) {
            throw new TypeError(`No move-down button for "${rowLabel}".`);
          }
          button.click();
        }

        async function removeFolder(path: string): Promise<void> {
          const existing = app.vault.getFolderByPath(path);
          if (existing) {
            await app.fileManager.trashFile(existing);
          }
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The modal lists the folders WITHOUT their numbers, badged with the number each will get.
    expect(result.rowLabels).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(result.indexBadges).toEqual(['1', '2', '3']);

    // The whole sequence is renumbered, not only the folder that moved.
    expect(result.folderNames).toEqual(['1. Beta', '2. Gamma', '3. Alpha']);

    // Each folder note's `title` follows its folder, index included. Written unquoted: `1. Beta` is a
    // Plain YAML scalar, so it reads back as that string with no quoting needed.
    expect(result.titles).toEqual(['1. Beta', '2. Gamma', '3. Alpha']);

    // `aliases` keep their VALUE — the reorder rewrites the title and nothing else. The quoting is
    // Normalized (`- "Alpha"` comes back as `- Alpha`) because writing one property re-serializes the
    // Whole frontmatter block, which is how every other property write in this plugin behaves.
    expect(result.aliasesContent).toContain('- Alpha');
    expect(result.aliasesContent).toContain('Alpha body');
  });
});
