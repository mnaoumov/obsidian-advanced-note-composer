import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

const PLUGIN_ID = 'advanced-note-composer';

interface DragOutcome {
  isDragOverAccepted: boolean;
  isDropAccepted: boolean;
  rowLabelsAfterDrop: (string | undefined)[];
  targetClassesWhileOver: string[];
  typesAfterDragStart: string[];
}

interface MenuItemLike {
  dom?: HTMLElement;
}

interface MenuLike {
  items: MenuItemLike[];
}

// Issue #231. The reorder modal offers TWO ways to move a row, and only the arrow buttons were ever
// Tested — so a drop that silently did nothing shipped in 5.9.0 and was reported by a user. Dragging
// Therefore gets its own behavioral test, driven through the real modal in a real Obsidian.
describe('reorder drag and drop', () => {
  it('should move a heading section when its row is dropped onto another row', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;

        const file = await resetFile('reorder-drag-headings.md', '# A\naaa\n\n# B\nbbb\n\n# C\nccc\n');
        await openFile(file);
        await waitUntil({
          message: 'heading cache not ready',
          predicate: () => (app.metadataCache.getFileCache(file)?.headings?.length ?? 0) === 3
        });

        app.commands.executeCommandById(`${pluginId}:reorder-headings`);
        await waitUntil({
          message: 'reorder modal did not open',
          predicate: () => document.querySelector('.advanced-note-composer-reorder-list') !== null
        });
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        // Drop "A" onto the LOWER half of "C" — i.e. after it -> B, C, A.
        const drag = dragRowOnto('A', 'C', true);
        await sleep(RENDER_DELAY_IN_MILLISECONDS);
        clickReorder();

        await waitUntil({
          message: 'note was not reordered',
          predicate: async () => {
            const value = await app.vault.read(file);
            return value.indexOf('# A') > value.indexOf('# C');
          }
        });
        return { drag, note: await app.vault.read(file) };

        function clickReorder(): void {
          const button = [...document.querySelectorAll('.modal-button-container button')]
            .find((el) => el.textContent === 'Reorder');
          if (!(button instanceof HTMLButtonElement)) {
            throw new TypeError('No Reorder button.');
          }
          button.click();
        }

        // A synthetic-but-complete drag: a real `DataTransfer` carried through the same
        // Dragstart -> dragover -> drop -> dragend sequence Obsidian's drag manager listens for, so every
        // Listener the modal registers runs exactly as it does under a real pointer drag.
        // These dispatches are a PERMANENT exception to the trusted-input convention: `sendInputEvent`
        // Can express a pointer move or a click, but it cannot express a drag, so there is no trusted
        // Equivalent of this sequence to convert to.
        function dragRowOnto(sourceLabel: string, targetLabel: string, shouldDropAfter: boolean): DragOutcome {
          const AFTER_FRACTION = 0.75;
          const BEFORE_FRACTION = 0.25;
          const CENTER_DIVISOR = 2;

          const sourceEl = getRow(sourceLabel);
          const targetEl = getRow(targetLabel);
          const dataTransfer = new DataTransfer();

          sourceEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
          const typesAfterDragStart = [...dataTransfer.types];

          const bounds = targetEl.getBoundingClientRect();
          const clientX = Math.round(bounds.left + bounds.width / CENTER_DIVISOR);
          const clientY = Math.round(bounds.top + bounds.height * (shouldDropAfter ? AFTER_FRACTION : BEFORE_FRACTION));

          const dragOverEvent = new DragEvent('dragover', { bubbles: true, cancelable: true, clientX, clientY, dataTransfer });
          targetEl.dispatchEvent(dragOverEvent);
          const targetClassesWhileOver = [...targetEl.classList];

          const dropEvent = new DragEvent('drop', { bubbles: true, cancelable: true, clientX, clientY, dataTransfer });
          targetEl.dispatchEvent(dropEvent);
          sourceEl.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));

          return {
            isDragOverAccepted: dragOverEvent.defaultPrevented,
            isDropAccepted: dropEvent.defaultPrevented,
            rowLabelsAfterDrop: readRowLabels(),
            targetClassesWhileOver,
            typesAfterDragStart
          };
        }

        function getRow(rowLabel: string): HTMLElement {
          const itemEl = document.querySelector(`.advanced-note-composer-reorder-item[data-row-label="${CSS.escape(rowLabel)}"]`);
          if (!(itemEl instanceof HTMLElement)) {
            throw new TypeError(`No row "${rowLabel}". Available: ${readRowLabels().join(' | ')}`);
          }
          return itemEl;
        }

        async function openFile(fileToOpen: TFile): Promise<void> {
          await app.workspace.getLeaf(false).openFile(fileToOpen);
          await waitUntil({
            message: `editor for ${fileToOpen.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === fileToOpen.path
          });
        }

        function readRowLabels(): (string | undefined)[] {
          return [...document.querySelectorAll<HTMLElement>('.advanced-note-composer-reorder-item')]
            .map((itemEl) => itemEl.dataset['rowLabel']);
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
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The drag is accepted on both passes: a `preventDefault`ed dragover is what makes the row a drop
    // Target at all, and a `preventDefault`ed drop is what claims the drop.
    expect(result.drag.isDragOverAccepted).toBe(true);
    expect(result.drag.isDropAccepted).toBe(true);

    // Obsidian's drag manager seeds the drag data store. An empty one is the state Obsidian explicitly
    // Guards against for its own drags, so assert we are on the guarded path rather than beside it.
    expect(result.drag.typesAfterDragStart).toContain('text/plain');

    // The row under the pointer shows WHERE the drop will land — below it, since the pointer is past its
    // Midpoint.
    expect(result.drag.targetClassesWhileOver).toContain('advanced-note-composer-reorder-drag-over-after');

    // The list re-renders in the dropped order immediately, before the operation is confirmed: the modal
    // Is the preview. This is the assertion issue #231 was about — the drop used to do nothing at all.
    expect(result.drag.rowLabelsAfterDrop).toEqual(['B', 'C', 'A']);

    // And confirming it writes that order to the note.
    expect(result.note.indexOf('# B')).toBeLessThan(result.note.indexOf('# C'));
    expect(result.note.indexOf('# C')).toBeLessThan(result.note.indexOf('# A'));
    expect(result.note).toContain('aaa');
  });

  it('should refuse a drop onto a row of another group', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule }) {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const ROOT = 'Reorder drag groups';

        const existing = app.vault.getFolderByPath(ROOT);
        if (existing) {
          await app.fileManager.trashFile(existing);
        }
        await app.vault.createFolder(ROOT);
        for (const folderName of ['Alpha', 'Beta']) {
          await app.vault.createFolder(`${ROOT}/${folderName}`);
          await app.vault.create(`${ROOT}/${folderName}/inner.md`, 'inner\n');
        }
        await app.vault.create(`${ROOT}/Draft.md`, 'Draft body\n');

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

        // Tick `Include files` so the modal holds two groups — folders, then files.
        const checkbox = document.querySelector('.advanced-note-composer-reorder-toggle input[type="checkbox"]');
        if (!(checkbox instanceof HTMLInputElement)) {
          throw new TypeError('No Include files checkbox.');
        }
        checkbox.click();
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        // The note can never join the folder sequence: the file explorer sorts folders above files, so a
        // Merged order could not be displayed as claimed.
        const drag = dragRowOnto('Draft', 'Alpha', true);
        await sleep(RENDER_DELAY_IN_MILLISECONDS);

        // Close it: this test confirms nothing, and a modal left open would block every suite that runs
        // After it in the shared instance.
        clickCancel();
        await waitUntil({
          message: 'reorder modal did not close',
          predicate: () => document.querySelector('.advanced-note-composer-reorder-list') === null
        });
        return { drag };

        function clickCancel(): void {
          const button = [...document.querySelectorAll('.modal-button-container button')]
            .find((el) => el.textContent === 'Cancel');
          if (!(button instanceof HTMLButtonElement)) {
            throw new TypeError('No Cancel button.');
          }
          button.click();
        }

        function clickMenuItem(menuToSearch: MenuLike, title: string): void {
          const itemEl = menuToSearch.items.find((candidate) => candidate.dom?.textContent === title)?.dom;
          if (!itemEl) {
            throw new TypeError(`No menu item "${title}".`);
          }
          itemEl.click();
        }

        // A PERMANENT exception to the trusted-input convention, as in the suite above: `sendInputEvent`
        // Can express a pointer move or a click, but it cannot express a drag, so this sequence has no
        // Trusted equivalent to convert to.
        function dragRowOnto(sourceLabel: string, targetLabel: string, shouldDropAfter: boolean): DragOutcome {
          const AFTER_FRACTION = 0.75;
          const BEFORE_FRACTION = 0.25;
          const CENTER_DIVISOR = 2;

          const sourceEl = getRow(sourceLabel);
          const targetEl = getRow(targetLabel);
          const dataTransfer = new DataTransfer();

          sourceEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
          const typesAfterDragStart = [...dataTransfer.types];

          const bounds = targetEl.getBoundingClientRect();
          const clientX = Math.round(bounds.left + bounds.width / CENTER_DIVISOR);
          const clientY = Math.round(bounds.top + bounds.height * (shouldDropAfter ? AFTER_FRACTION : BEFORE_FRACTION));

          const dragOverEvent = new DragEvent('dragover', { bubbles: true, cancelable: true, clientX, clientY, dataTransfer });
          targetEl.dispatchEvent(dragOverEvent);
          const targetClassesWhileOver = [...targetEl.classList];

          const dropEvent = new DragEvent('drop', { bubbles: true, cancelable: true, clientX, clientY, dataTransfer });
          targetEl.dispatchEvent(dropEvent);
          sourceEl.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));

          return {
            isDragOverAccepted: dragOverEvent.defaultPrevented,
            isDropAccepted: dropEvent.defaultPrevented,
            rowLabelsAfterDrop: readRowLabels(),
            targetClassesWhileOver,
            typesAfterDragStart
          };
        }

        function getRow(rowLabel: string): HTMLElement {
          const itemEl = document.querySelector(`.advanced-note-composer-reorder-item[data-row-label="${CSS.escape(rowLabel)}"]`);
          if (!(itemEl instanceof HTMLElement)) {
            throw new TypeError(`No row "${rowLabel}". Available: ${readRowLabels().join(' | ')}`);
          }
          return itemEl;
        }

        function readRowLabels(): (string | undefined)[] {
          return [...document.querySelectorAll<HTMLElement>('.advanced-note-composer-reorder-item')]
            .map((itemEl) => itemEl.dataset['rowLabel']);
        }
      },
      input: { pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // Neither pass is claimed, so the row is not a drop target and the pointer shows "no drop".
    expect(result.drag.isDragOverAccepted).toBe(false);
    expect(result.drag.isDropAccepted).toBe(false);
    expect(result.drag.targetClassesWhileOver).not.toContain('advanced-note-composer-reorder-drag-over-after');
    expect(result.drag.rowLabelsAfterDrop).toEqual(['Alpha', 'Beta', 'Draft']);
  });
});
