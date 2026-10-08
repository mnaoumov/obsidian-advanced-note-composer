import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

const PLUGIN_ID = 'advanced-note-composer';

// The reporter's shape (issue #307): three numbered top-level headings, two of them with sub-headings.
const NUMBERED_CONTENT = '# 1. General\ng\n\n# 2. Projects\nk\n\n## 1. Due\nd\n\n# 3. Travel\nt\n\n## 1. Due A\nda\n\n## 2. Due B\ndb\n';

// Two parents with two children each, the issue #295 sample.
const NESTED_CONTENT = '# A\na\n\n## A1\na1\n\n## A2\na2\n\n# B\nb\n\n## B1\nb1\n\n## B2\nb2\n';

interface Point {
  readonly clientX: number;
  readonly clientY: number;
}

// Issue #307: a numbered note could not be put in reverse order in one step, and no drop moved the first
// top-level heading below the last one, because a drop below the last row lands inside its subtree. These
// drive the real modal: the sort row's `Reverse` button, and the drop zone under the list.
describe('reorder headings: reverse and the end drop zone (issue #307)', () => {
  it('should reverse the top-level headings of a numbered note and renumber them', async () => {
    const result = await evalInObsidian({
      async callback({ app, content, lib: { waitUntil }, obsidianModule, pluginId }) {
        // Four waits share the transport's 30 s cap, each a fast modal or one-note step.
        const WAIT_TIMEOUT_IN_MILLISECONDS = 5000;

        const file = await resetFile('reorder-headings-reverse.md', content);
        await app.workspace.getLeaf(false).openFile(file);
        await waitUntil({
          message: 'the note did not open with its heading cache ready',
          predicate: () =>
            app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
            && (app.metadataCache.getFileCache(file)?.headings?.length ?? 0) === 6,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        app.commands.executeCommandById(`${pluginId}:reorder-headings`);
        await waitUntil({
          message: 'the sort row did not render',
          predicate: () => readRows().length === 6 && document.querySelector('.advanced-note-composer-reorder-sort-reverse') !== null,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        const button = document.querySelector('.advanced-note-composer-reorder-sort-reverse');
        if (!(button instanceof HTMLButtonElement)) {
          throw new TypeError('No Reverse button.');
        }
        button.click();
        await waitUntil({
          message: 'the rows were not reversed',
          predicate: () => readRows()[0] === '# 1. Travel',
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        const reversedRows = readRows();

        clickReorder();
        await waitUntil({
          message: 'the note was not rewritten',
          predicate: async () => {
            const note = await app.vault.read(file);
            return note.startsWith('# 1. Travel');
          },
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        return { note: await app.vault.read(file), reversedRows };

        function clickReorder(): void {
          const reorderButton = [...document.querySelectorAll('.modal-button-container button')].find((el) => el.textContent === 'Reorder');
          if (!(reorderButton instanceof HTMLButtonElement)) {
            throw new TypeError('No Reorder button.');
          }
          reorderButton.click();
        }

        function readRows(): string[] {
          return [...document.querySelectorAll<HTMLElement>('.advanced-note-composer-reorder-title')].map((el) => el.textContent);
        }

        async function resetFile(path: string, fileContent: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, fileContent);
            return existing;
          }
          return app.vault.create(path, fileContent);
        }
      },
      input: { content: NUMBERED_CONTENT, pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    // The scope starts on level 1, so the sub-headings keep their order under their parents.
    expect(result.reversedRows).toEqual(['# 1. Travel', '## 1. Due A', '## 2. Due B', '# 2. Projects', '## 1. Due', '# 3. General']);
    expect(result.note).toBe('# 1. Travel\nt\n\n## 1. Due A\nda\n\n## 2. Due B\ndb\n\n# 2. Projects\nk\n\n## 1. Due\nd\n\n# 3. General\ng\n');
  });

  it('should drag the first top-level heading onto the end drop zone, below the last one\'s subtree', async () => {
    const result = await evalInObsidian({
      async callback({ app, content, lib: { waitUntil }, obsidianModule, pluginId }) {
        // Three waits share the transport's 30 s cap, each a fast modal or one-note step.
        const WAIT_TIMEOUT_IN_MILLISECONDS = 5000;

        const file = await resetFile('reorder-headings-end-drop.md', content);
        await app.workspace.getLeaf(false).openFile(file);
        await waitUntil({
          message: 'the note did not open with its heading cache ready',
          predicate: () =>
            app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
            && (app.metadataCache.getFileCache(file)?.headings?.length ?? 0) === 6,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        app.commands.executeCommandById(`${pluginId}:reorder-headings`);
        await waitUntil({
          message: 'the reorder modal did not open with its end drop zone',
          predicate: () => readRows().length === 6 && document.querySelector('.advanced-note-composer-reorder-end-drop') !== null,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        const zoneEl = document.querySelector('.advanced-note-composer-reorder-end-drop');
        if (!(zoneEl instanceof HTMLElement)) {
          throw new TypeError('No end drop zone.');
        }
        const sourceEl = getRow('A');
        const lastRowEl = getRow('B2');

        /* eslint-disable obsidian-dev-utils/no-untrusted-input-events -- A drag has no trusted equivalent: sendInputEvent cannot express one. */
        // First the drop the reporter made: hovering the bottom of the last row promises a line under it,
        // which is inside `B`.
        let dataTransfer = new DataTransfer();
        sourceEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
        lastRowEl.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, ...pointAt(lastRowEl, 0.9) }));
        const lastRowClasses = [...lastRowEl.classList];
        sourceEl.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));

        // Then the drop zone under the list.
        dataTransfer = new DataTransfer();
        const point = pointAt(zoneEl, 0.5);
        sourceEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
        zoneEl.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, ...point }));
        const zoneClasses = [...zoneEl.classList];
        const dropEvent = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, ...point });
        zoneEl.dispatchEvent(dropEvent);
        sourceEl.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));
        /* eslint-enable obsidian-dev-utils/no-untrusted-input-events -- The rest of the suite drives the UI with trusted input. */
        const rowsAfterDrop = readRows();

        const reorderButton = [...document.querySelectorAll('.modal-button-container button')].find((el) => el.textContent === 'Reorder');
        if (!(reorderButton instanceof HTMLButtonElement)) {
          throw new TypeError('No Reorder button.');
        }
        reorderButton.click();
        await waitUntil({
          message: 'the note was not rewritten',
          predicate: async () => {
            const note = await app.vault.read(file);
            return note.startsWith('# B');
          },
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        return { isDropAccepted: dropEvent.defaultPrevented, lastRowClasses, note: await app.vault.read(file), rowsAfterDrop, zoneClasses };

        function getRow(rowLabel: string): HTMLElement {
          const itemEl = document.querySelector(`.advanced-note-composer-reorder-item[data-row-label="${CSS.escape(rowLabel)}"]`);
          if (!(itemEl instanceof HTMLElement)) {
            throw new TypeError(`No row "${rowLabel}".`);
          }
          return itemEl;
        }

        function pointAt(el: HTMLElement, heightFraction: number): Point {
          const CENTER_DIVISOR = 2;
          const bounds = el.getBoundingClientRect();
          return {
            clientX: Math.round(bounds.left + bounds.width / CENTER_DIVISOR),
            clientY: Math.round(bounds.top + bounds.height * heightFraction)
          };
        }

        function readRows(): string[] {
          return [...document.querySelectorAll<HTMLElement>('.advanced-note-composer-reorder-title')].map((el) => el.textContent);
        }

        async function resetFile(path: string, fileContent: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, fileContent);
            return existing;
          }
          return app.vault.create(path, fileContent);
        }
      },
      input: { content: NESTED_CONTENT, pluginId: PLUGIN_ID },
      vaultPath: getTemporaryVault().path
    });

    expect(result.lastRowClasses).toContain('advanced-note-composer-reorder-drag-over-after');
    expect(result.zoneClasses).toContain('advanced-note-composer-reorder-drag-over-before');
    expect(result.isDropAccepted).toBe(true);
    expect(result.rowsAfterDrop).toEqual(['# B', '## B1', '## B2', '# A', '## A1', '## A2']);
    expect(result.note).toBe('# B\nb\n\n## B1\nb1\n\n## B2\nb2\n\n# A\na\n\n## A1\na1\n\n## A2\na2\n');
  });
});
