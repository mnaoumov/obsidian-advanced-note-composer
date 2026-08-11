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
  items: MenuItemLike[];
}

describe('reorder folders and files', () => {
  it('should number the notes as their own sequence once Include files is ticked', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const ROOT = 'Reorder folders and files';

        const existing = app.vault.getFolderByPath(ROOT);
        if (existing) {
          await app.fileManager.trashFile(existing);
        }
        await app.vault.createFolder(ROOT);
        for (const folderName of ['Alpha', 'Beta']) {
          await app.vault.createFolder(`${ROOT}/${folderName}`);
          await app.vault.create(`${ROOT}/${folderName}/inner.md`, 'inner\n');
        }
        for (const fileName of ['Draft', 'Notes']) {
          await app.vault.create(`${ROOT}/${fileName}.md`, `${fileName} body\n`);
        }

        const rootFolder = app.vault.getFolderByPath(ROOT);
        if (!(rootFolder instanceof obsidianModule.TFolder)) {
          throw new TypeError(`No folder at ${ROOT}.`);
        }

        const menu = new obsidianModule.Menu();
        app.workspace.trigger('file-menu', menu, rootFolder, 'file-explorer-context-menu');
        clickMenuItem(menu, 'Reorder child folders...');

        await waitUntil({
          message: 'reorder modal did not open',
          predicate: () => document.querySelector('.advanced-note-composer-reorder-list') !== null
        });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        // Only the folders are listed until the box is ticked.
        const rowLabelsBefore = readRowLabels();

        const checkbox = document.querySelector('.advanced-note-composer-reorder-toggle input[type="checkbox"]');
        if (!(checkbox instanceof HTMLInputElement)) {
          throw new TypeError('No Include files checkbox.');
        }
        checkbox.click();
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        const rowLabelsAfter = readRowLabels();
        const groupTitles = [...document.querySelectorAll('.advanced-note-composer-reorder-group-title')]
          .map((titleEl) => titleEl.textContent);

        clickReorder();

        await waitUntil({
          message: 'the notes were not renumbered',
          predicate: () => app.vault.getFileByPath(`${ROOT}/2. Notes.md`) !== null
        });

        const children = app.vault.getFolderByPath(ROOT)?.children ?? [];
        return {
          fileNames: children.filter((child) => !(child instanceof obsidianModule.TFolder)).map((child) => child.name).sort(),
          folderNames: children.filter((child) => child instanceof obsidianModule.TFolder).map((child) => child.name).sort(),
          groupTitles,
          rowLabelsAfter,
          rowLabelsBefore
        };

        function clickMenuItem(menuToSearch: MenuLike, title: string): void {
          const itemEl = menuToSearch.items.find((candidate) => candidate.dom?.textContent === title)?.dom;
          if (!itemEl) {
            throw new TypeError(`No menu item "${title}".`);
          }
          itemEl.click();
        }

        function clickReorder(): void {
          const button = [...document.querySelectorAll('.modal-button-container button')]
            .find((el) => el.textContent === 'Reorder');
          if (!(button instanceof HTMLButtonElement)) {
            throw new TypeError('No Reorder button.');
          }
          button.click();
        }

        function readRowLabels(): (string | undefined)[] {
          return [...document.querySelectorAll<HTMLElement>('.advanced-note-composer-reorder-item')]
            .map((itemEl) => itemEl.dataset['rowLabel']);
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    expect(result.rowLabelsBefore).toEqual(['Alpha', 'Beta']);
    // Ticking the box re-renders the list with the notes appended as their own group.
    expect(result.rowLabelsAfter).toEqual(['Alpha', 'Beta', 'Draft', 'Notes']);
    expect(result.groupTitles).toEqual(['Folders', 'Files']);

    // Two INDEPENDENT sequences, each numbered from 1 — the file explorer sorts folders above files, so a
    // Single merged numbering could never be shown in the order it claims.
    expect(result.folderNames).toEqual(['1. Alpha', '2. Beta']);
    expect(result.fileNames).toEqual(['1. Draft.md', '2. Notes.md']);
  });
});
