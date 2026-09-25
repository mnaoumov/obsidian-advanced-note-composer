import type { TFile } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

const PLUGIN_ID = 'advanced-note-composer';

interface DropOutcome {
  readonly isDropAccepted: boolean;
}

interface Point {
  readonly clientX: number;
  readonly clientY: number;
}

// The reporter's own sample note (issue #295): two parents with two children each. The preamble links to
// `A1` through its nested path, which is the link a move under `B` would otherwise break.
const TARGET_CONTENT = 'See [[#A#A1]].\n\n# A\na\n\n## A1\na1\n\n## A2\na2\n\n# B\nb\n\n## B1\nb1\n\n## B2\nb2\n';

// Issue #295: `Reorder headings` used to refuse every drop outside a heading's own parent — the reporter's
// video shows the no-drop cursor over `B`'s children. These drive the real modal in a real Obsidian: a drag
// under another parent, an indent through the arrow buttons, and the links the move would break.
describe('reorder headings across parents', () => {
  it('should drag a sub-heading under another parent, and rewrite the nested links to it', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId, targetContent }) {
        // Four waits share this ceiling, so the closure declares 20 s against the transport's 30 s cap.
        const WAIT_TIMEOUT_IN_MILLISECONDS = 5000;

        const file = await resetFile('reorder-across-parents.md', targetContent);
        const linker = await resetFile('reorder-across-parents-linker.md', 'Nested [[reorder-across-parents#A#A1]] and plain [[reorder-across-parents#A1]].\n');
        await app.workspace.getLeaf(false).openFile(file);
        await waitUntil({
          message: 'the note did not open with its heading cache and backlink ready',
          predicate: () =>
            app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
            && (app.metadataCache.getFileCache(file)?.headings?.length ?? 0) === 6
            && (app.metadataCache.getFileCache(linker)?.links?.length ?? 0) === 2,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        app.commands.executeCommandById(`${pluginId}:reorder-headings`);
        await waitUntil({
          message: 'reorder modal did not open',
          predicate: () => document.querySelector('.advanced-note-composer-reorder-item[data-row-label="B2"]') !== null,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        // Hover over the MIDDLE of `B1` first: a nestable list offers a drop INSIDE a heading there.
        const insideClasses = hoverOnly('A1', 'B1', 0.5);
        // Then drop `A1` on the TOP of `B2`: before it, under `B`.
        const drop = dragRowOnto('A1', 'B2', 0.15);
        const rowsAfterDrop = readRows();
        clickReorder();

        await waitUntil({
          message: 'the note was not rewritten',
          predicate: async () => {
            const content = await app.vault.read(file);
            return content.indexOf('## A1') > content.indexOf('## B1');
          },
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        let linkerError = '';
        try {
          await waitUntil({
            message: 'the linker was not rewritten',
            predicate: async () => {
              const content = await app.vault.read(linker);
              return content.includes('#B#A1');
            },
            timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
          });
        } catch (error) {
          linkerError = String(error);
        }
        const cache = app.metadataCache.getFileCache(file);
        const probe = ['#A#A1', '#B#A1', '#A1'].map((subpath) => {
          const resolved = cache ? obsidianModule.resolveSubpath(cache, subpath) : null;
          return `${subpath} -> ${resolved?.type === 'heading' ? resolved.current.heading : String(resolved?.type)}`;
        });
        return {
          drop,
          insideClasses,
          linker: await app.vault.read(linker),
          linkerError,
          note: await app.vault.read(file),
          probe,
          rowsAfterDrop
        };

        function clickReorder(): void {
          const button = [...document.querySelectorAll('.modal-button-container button')].find((el) => el.textContent === 'Reorder');
          if (!(button instanceof HTMLButtonElement)) {
            throw new TypeError('No Reorder button.');
          }
          button.click();
        }

        // A drag has no trusted equivalent (`sendInputEvent` cannot express one), so the same synthetic
        // sequence `reorder-drag.desktop.integration.test.ts` uses drives Obsidian's drag manager here.
        /* eslint-disable obsidian-dev-utils/no-untrusted-input-events -- A drag has no trusted equivalent: sendInputEvent cannot express one. */
        function dragRowOnto(sourceLabel: string, targetLabel: string, heightFraction: number): DropOutcome {
          const sourceEl = getRow(sourceLabel);
          const targetEl = getRow(targetLabel);
          const dataTransfer = new DataTransfer();
          const point = pointAt(targetEl, heightFraction);
          sourceEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
          targetEl.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, ...point }));
          const dropEvent = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, ...point });
          targetEl.dispatchEvent(dropEvent);
          sourceEl.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));
          return { isDropAccepted: dropEvent.defaultPrevented };
        }

        function hoverOnly(sourceLabel: string, targetLabel: string, heightFraction: number): string[] {
          const sourceEl = getRow(sourceLabel);
          const targetEl = getRow(targetLabel);
          const dataTransfer = new DataTransfer();
          sourceEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
          targetEl.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, ...pointAt(targetEl, heightFraction) }));
          const classes = [...targetEl.classList];
          sourceEl.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));
          return classes;
        }
        /* eslint-enable obsidian-dev-utils/no-untrusted-input-events -- The rest of the suite drives the UI with trusted input. */

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

        async function resetFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          return app.vault.create(path, content);
        }
      },
      input: { pluginId: PLUGIN_ID, targetContent: TARGET_CONTENT },
      vaultPath: getTemporaryVault().path
    });

    expect(result.linkerError).toBe('');
    // Measured, and the reason the rewrite cannot key on resolution alone: Obsidian matches a nested path
    // segment by segment in document order without checking nesting, so the stale `#A#A1` still reaches
    // `A1` sitting under `B`.
    expect(result.probe).toEqual(['#A#A1 -> A1', '#B#A1 -> A1', '#A1 -> A1']);
    expect(result.insideClasses).toContain('advanced-note-composer-reorder-drag-over-inside');
    expect(result.drop.isDropAccepted).toBe(true);
    expect(result.rowsAfterDrop).toEqual(['# A', '## A2', '# B', '## B1', '## A1', '## B2']);
    expect(result.note).toBe('See [[#B#A1]].\n\n# A\na\n\n## A2\na2\n\n# B\nb\n\n## B1\nb1\n\n## A1\na1\n\n## B2\nb2\n');
    // The nested link is re-pathed; the plain one still reaches `A1` wherever it sits, so it is untouched.
    expect(result.linker).toBe('Nested [[reorder-across-parents#B#A1]] and plain [[reorder-across-parents#A1]].\n');
  });

  it('should indent a heading under the one above it with the arrow button, re-leveling its subtree', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId, targetContent }) {
        // Three waits share this ceiling, so the closure declares 15 s against the transport's 30 s cap.
        const WAIT_TIMEOUT_IN_MILLISECONDS = 5000;

        const path = 'reorder-indent.md';
        const existing = app.vault.getAbstractFileByPath(path);
        const file = existing instanceof obsidianModule.TFile ? existing : await app.vault.create(path, targetContent);
        await app.vault.modify(file, targetContent);
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
          message: 'reorder modal did not open',
          predicate: () => document.querySelector('.advanced-note-composer-reorder-item[data-row-label="B"]') !== null,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });

        const indentButton = document.querySelector('.advanced-note-composer-reorder-item[data-row-label="B"] .advanced-note-composer-reorder-indent');
        const outdentButton = document.querySelector('.advanced-note-composer-reorder-item[data-row-label="B"] .advanced-note-composer-reorder-outdent');
        if (!(indentButton instanceof HTMLButtonElement) || !(outdentButton instanceof HTMLButtonElement)) {
          throw new TypeError('No indent/outdent buttons on row "B".');
        }
        const isOutdentDisabled = outdentButton.disabled;
        indentButton.click();
        const confirmButton = [...document.querySelectorAll('.modal-button-container button')].find((el) => el.textContent === 'Reorder');
        if (!(confirmButton instanceof HTMLButtonElement)) {
          throw new TypeError('No Reorder button.');
        }
        confirmButton.click();

        await waitUntil({
          message: 'the note was not re-leveled',
          predicate: async () => {
            const content = await app.vault.read(file);
            return content.includes('### B1');
          },
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        return { isOutdentDisabled, note: await app.vault.read(file) };
      },
      input: { pluginId: PLUGIN_ID, targetContent: TARGET_CONTENT },
      vaultPath: getTemporaryVault().path
    });

    // A top-level heading has no parent to leave.
    expect(result.isOutdentDisabled).toBe(true);
    expect(result.note).toBe('See [[#A#A1]].\n\n# A\na\n\n## A1\na1\n\n## A2\na2\n\n## B\nb\n\n### B1\nb1\n\n### B2\nb2\n');
  });
});
