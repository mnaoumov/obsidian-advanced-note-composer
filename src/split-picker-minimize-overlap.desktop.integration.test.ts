import type {
  Editor,
  TFile
} from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

/*
 * Issue #236: the split/extract picker's `Create` / `Merge` switch (issue #227) is prepended to the picker's
 * `modalEl`, and the minimize button the picker gets from `openMinimizableModal` is positioned absolutely in
 * that same top-right corner - so the switch rendered UNDERNEATH the button. A `SuggestModal` has no native
 * close button, so nothing else was holding that corner open.
 *
 * This pins the two apart geometrically rather than by asserting a CSS value: the row's content box must
 * clear the button's box, whatever padding or button size the styles end up using.
 *
 * Isolation: `npx vitest run --project integration-tests:desktop src/split-picker-minimize-overlap.desktop.integration.test.ts`.
 */

const PLUGIN_ID = 'advanced-note-composer';

interface OverlapObservations {
  readonly atDefaultWidth: PickerGeometry;
  readonly atNarrowWidth: PickerGeometry;
}

interface PickerGeometry {
  readonly minimizeButton: null | Rect;
  readonly switchControl: null | Rect;
  readonly switchRow: null | Rect;
}

interface Rect {
  readonly bottom: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly width: number;
}

describe('the split/extract picker\'s create/merge switch and minimize button (issue #236)', () => {
  it('should keep the switch row clear of the minimize button', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, obsidianModule, pluginId }): Promise<OverlapObservations> {
        const RENDER_DELAY_IN_MILLISECONDS = 400;
        const NARROW_PROMPT_WIDTH_IN_PIXELS = 320;
        const SOURCE_PATH = 'split-picker-overlap-source.md';
        const SOURCE_CONTENT = 'alpha bravo charlie\n';
        const SELECTED_WORD = 'bravo';

        try {
          const source = await resetFile(SOURCE_PATH, SOURCE_CONTENT);
          const editor = await openAndGetEditor(source);
          // Reset through the EDITOR: an open buffer wins over `vault.modify`, so an offset-based selection
          // Against a stale buffer would grab the previous run's text.
          editor.setValue(SOURCE_CONTENT);
          await waitUntil({
            message: 'the source editor did not catch up with the reset content',
            predicate: () => editor.getValue() === SOURCE_CONTENT
          });
          const selectionStart = SOURCE_CONTENT.indexOf(SELECTED_WORD);
          editor.setSelection(editor.offsetToPos(selectionStart), editor.offsetToPos(selectionStart + SELECTED_WORD.length));

          app.commands.executeCommandById(`${pluginId}:extract-current-selection`);
          await waitUntil({
            message: 'the split picker did not open',
            predicate: () => document.querySelector('.prompt') !== null
          });
          // Both are rendered by the picker itself: the switch in `onOpen`, the button by the minimizable
          // Wrapper. Waiting for them is what makes a missing element a readable failure rather than a null
          // Rect.
          await waitUntil({
            message: 'the create/merge switch never rendered',
            predicate: () => document.querySelector('.advanced-note-composer-split-target-mode .setting-item') !== null
          });
          await waitUntil({
            message: 'the picker has no minimize button',
            predicate: () => document.querySelector('.prompt .minimize-button') !== null
          });
          // The rects are only meaningful once layout has settled.
          await sleep(RENDER_DELAY_IN_MILLISECONDS);

          const atDefaultWidth = readGeometry();

          // Both the button and the reserved corner are anchored to the modal's right edge, so a narrow
          // Window is where a reservation measured against the wide layout would break. The prompt's width
          // Is what the window width decides, so narrowing the element itself is the same test without
          // Resizing Obsidian out from under the other suites.
          const promptEl = document.querySelector('.prompt');
          if (!(promptEl instanceof HTMLElement)) {
            throw new TypeError('No split picker prompt element.');
          }
          const originalWidth = promptEl.style.width;
          promptEl.style.width = `${String(NARROW_PROMPT_WIDTH_IN_PIXELS)}px`;
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          const atNarrowWidth = readGeometry();
          promptEl.style.width = originalWidth;

          return { atDefaultWidth, atNarrowWidth };
        } finally {
          // Cancelling the setup flow closes the locked picker and releases the source-file lock, leaving no
          // Lingering modal or lock behind.
          app.commands.executeCommandById(`${pluginId}:unlock-active-note`);
          await waitUntil({
            message: 'the split picker did not close',
            predicate: () => document.querySelector('.prompt') === null
          });
          await trashIfExists(SOURCE_PATH);
        }

        async function openAndGetEditor(file: TFile): Promise<Editor> {
          const leaf = app.workspace.getLeaf(false);
          await leaf.openFile(file);
          await app.workspace.revealLeaf(leaf);
          await waitUntil({
            message: `the editor for ${file.path} did not open`,
            predicate: () => app.workspace.getActiveViewOfType(obsidianModule.MarkdownView)?.file?.path === file.path
          });
          const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
          if (!view) {
            throw new Error('No active markdown view.');
          }
          await view.setState({ ...view.getState(), mode: 'source', source: true }, { history: false });
          await sleep(RENDER_DELAY_IN_MILLISECONDS);
          return view.editor;
        }

        function readGeometry(): PickerGeometry {
          return {
            // The absolutely-positioned button, and the row's CONTENT box - the padded container itself
            // Spans the whole modal width and is expected to sit behind the button.
            minimizeButton: readRect('.prompt .minimize-button'),
            switchControl: readRect('.advanced-note-composer-split-target-mode .checkbox-container'),
            switchRow: readRect('.advanced-note-composer-split-target-mode .setting-item')
          };
        }

        function readRect(selector: string): null | Rect {
          const el = document.querySelector(selector);
          if (!(el instanceof HTMLElement)) {
            return null;
          }
          const rect = el.getBoundingClientRect();
          return {
            bottom: rect.bottom,
            height: rect.height,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            width: rect.width
          };
        }

        async function resetFile(path: string, content: string): Promise<TFile> {
          const existing = app.vault.getAbstractFileByPath(path);
          if (existing instanceof obsidianModule.TFile) {
            await app.vault.modify(existing, content);
            return existing;
          }
          return app.vault.create(path, content);
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

    expectClearOfMinimizeButton(result.atDefaultWidth, 'at the default width');
    expectClearOfMinimizeButton(result.atNarrowWidth, 'at a narrow width');
  });
});

/**
 * Reports whether two rects overlap, as text rather than a boolean, so a failure prints WHERE the two
 * boxes are instead of just `true !== false`.
 *
 * @param first - One rect.
 * @param second - The other rect.
 * @returns `'no overlap'`, or a description of both boxes.
 */
function describeOverlap(first: Rect, second: Rect): string {
  const doesOverlap = first.left < second.right
    && second.left < first.right
    && first.top < second.bottom
    && second.top < first.bottom;
  if (!doesOverlap) {
    return 'no overlap';
  }
  return `overlap: ${formatRect(first)} vs ${formatRect(second)}`;
}

/**
 * Asserts that one measurement of the picker really rendered both controls and that they do not share any
 * pixels.
 *
 * @param geometry - The rects measured in Obsidian.
 * @param where - How this measurement was taken, named in every failure message.
 */
function expectClearOfMinimizeButton(geometry: PickerGeometry, where: string): void {
  // Every element the geometry is read from is really on screen, so an absent one cannot pass vacuously.
  const minimizeButton = expectVisibleRect(geometry.minimizeButton, `minimize button ${where}`);
  const switchRow = expectVisibleRect(geometry.switchRow, `create/merge switch row ${where}`);
  const switchControl = expectVisibleRect(geometry.switchControl, `create/merge toggle ${where}`);

  // The row's name + description share the row's content box, so clearing it clears the label too.
  expect(describeOverlap(minimizeButton, switchRow), `switch row ${where}`).toBe('no overlap');
  expect(describeOverlap(minimizeButton, switchControl), `toggle ${where}`).toBe('no overlap');
}

function expectVisibleRect(rect: null | Rect, name: string): Rect {
  if (!rect) {
    throw new Error(`The ${name} was not rendered.`);
  }
  expect(rect.width, `${name} width`).toBeGreaterThan(0);
  expect(rect.height, `${name} height`).toBeGreaterThan(0);
  return rect;
}

function formatRect(rect: Rect): string {
  return `[left=${String(rect.left)} right=${String(rect.right)} top=${String(rect.top)} bottom=${String(rect.bottom)}]`;
}
