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

describe('rename folder', () => {
  it('should rename the folder and keep its folder note\'s name, title and aliases in step', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const ROOT = 'Rename folder';
        const OLD_FOLDER_NAME = '1. Alpha';
        const NEW_FOLDER_NAME = '1. Beta';
        const TYPED_NAME = 'Beta';

        // A NUMBERED folder holding a folder note named after it (the `Auto` fallback layout), whose
        // `aliases` carry both a derived entry (the name without its number) and a hand-written one.
        await removeFolder(ROOT);
        await app.vault.createFolder(ROOT);
        await app.vault.createFolder(`${ROOT}/${OLD_FOLDER_NAME}`);
        await app.vault.create(
          `${ROOT}/${OLD_FOLDER_NAME}/${OLD_FOLDER_NAME}.md`,
          `---\ntitle: "${OLD_FOLDER_NAME}"\naliases:\n  - "Alpha"\n  - "my own alias"\n---\n\nAlpha body\n`
        );
        await app.vault.create(`${ROOT}/${OLD_FOLDER_NAME}/inner.md`, 'inner body\n');

        const folder = app.vault.getFolderByPath(`${ROOT}/${OLD_FOLDER_NAME}`);
        if (!(folder instanceof obsidianModule.TFolder)) {
          throw new TypeError(`No folder at ${ROOT}/${OLD_FOLDER_NAME}.`);
        }

        // Driven through the folder MENU, which is how the command is actually reached.
        const menu = new obsidianModule.Menu();
        app.workspace.trigger('file-menu', menu, folder, 'file-explorer-context-menu');
        clickMenuItem(menu, 'Rename folder...');

        await waitUntil({
          message: 'rename prompt did not open',
          predicate: () => document.querySelector('.prompt-modal .text-box') !== null
        });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        const nameInput = document.querySelector('.prompt-modal .text-box');
        if (!(nameInput instanceof HTMLInputElement)) {
          throw new TypeError('No folder name prompt input.');
        }

        // The prompt is seeded with the name WITHOUT its index — the number is the sequence's, not
        // Something to be retyped.
        const seededValue = nameInput.value;

        nameInput.value = TYPED_NAME;
        // The modal tracks its value through the component's change handler, so a bare `value` assignment
        // Would be accepted and then submitted as the seeded name.
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));

        // The prompt validates ASYNCHRONOUSLY and refuses to submit while the input is invalid, so clicking
        // Before the validation settles is silently ignored.
        await waitUntil({
          message: 'the typed folder name never became valid',
          predicate: () => nameInput.checkValidity()
        });

        const okButton = document.querySelector('.prompt-modal .ok-button');
        if (!(okButton instanceof HTMLElement)) {
          throw new TypeError('No folder name prompt OK button.');
        }
        okButton.click();

        // Waits for the LAST thing the operation does, not the first: the folder rename lands before the
        // Folder note is renamed and its properties rewritten, so waiting on the folder alone would read
        // The note mid-flight. A throwing wait would discard everything observed so far, so give up quietly
        // And let the assertions outside Obsidian report what actually happened.
        try {
          await waitUntil({
            message: 'the folder note was not renamed and rewritten',
            predicate: async () => {
              const noteFile = app.vault.getFileByPath(`${ROOT}/${NEW_FOLDER_NAME}/${NEW_FOLDER_NAME}.md`);
              if (!noteFile) {
                return false;
              }
              const content = await app.vault.read(noteFile);
              return content.includes(`title: ${NEW_FOLDER_NAME}`);
            }
          });
        } catch {
          // Diagnostics are returned below.
        }
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        const folderNoteFile = app.vault.getFileByPath(`${ROOT}/${NEW_FOLDER_NAME}/${NEW_FOLDER_NAME}.md`);
        const innerFile = app.vault.getFileByPath(`${ROOT}/${NEW_FOLDER_NAME}/inner.md`);

        return {
          folderNames: (app.vault.getFolderByPath(ROOT)?.children ?? [])
            .filter((child) => child instanceof obsidianModule.TFolder)
            .map((child) => child.name)
            .sort(),
          folderNoteContent: folderNoteFile ? await app.vault.read(folderNoteFile) : null,
          // The rest of the folder came along untouched, so the rename moved the folder rather than
          // Rebuilding it.
          innerContent: innerFile ? await app.vault.read(innerFile) : null,
          // Nothing is left under the old name.
          oldFolderExists: app.vault.getFolderByPath(`${ROOT}/${OLD_FOLDER_NAME}`) !== null,
          seededValue
        };

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

    // Seeded without the index, so the user edits the NAME and never the numbering.
    expect(result.seededValue).toBe('Alpha');

    // The index survived the rename: the folder keeps its place in the sequence.
    expect(result.folderNames).toEqual(['1. Beta']);
    expect(result.oldFolderExists).toBe(false);
    expect(result.innerContent).toBe('inner body\n');

    // The folder note was renamed with its folder, so it is still that folder's folder note.
    expect(result.folderNoteContent).not.toBeNull();

    // `title` takes the new name WITH its index. Written unquoted: `1. Beta` is a plain YAML scalar, so it
    // Reads back as that string with no quoting needed.
    expect(result.folderNoteContent).toContain('title: 1. Beta');

    // The DERIVED alias was swapped for the new name's, and the hand-written one survived untouched — the
    // Whole point of swapping one entry rather than rewriting the list.
    expect(result.folderNoteContent).toContain('- Beta');
    expect(result.folderNoteContent).not.toContain('- Alpha');
    expect(result.folderNoteContent).toContain('- my own alias');

    expect(result.folderNoteContent).toContain('Alpha body');
  });
});
