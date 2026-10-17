import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

// The `Try it` buttons of `demo-vault/`, checked for what they DO. The button suite next door only knows
// whether a button reported success, and every one of these would report success while doing the wrong
// thing: selecting text in the button's own source, opening a picker over the wrong note, or a reset that
// leaves a created note behind. One button of each helper `demoSetup.ts` offers is driven here, and the
// outcome its walkthrough promises is asserted.
//
// Isolation: `npx vitest run --project integration-tests:demo-vault src/demo-vault-try-it.demo-vault.integration.test.ts`.

const SNAPSHOT_FOLDER = '.demo-vault-snapshot';

interface ClickResult {
  readonly output: string;
  readonly status: 'error' | 'missing' | 'ok' | 'timeout';
}

interface NoteContents {
  readonly current: null | string;
  readonly shipped: null | string;
}

/**
 * Clicks one `code-button`, found by its caption, in a note opened in reading view — the way a reader
 * clicks it — and waits for `CodeScript Toolkit` to report the result.
 *
 * @param notePath - The note holding the button.
 * @param caption - The button's caption.
 * @returns How the button finished, and what it printed.
 */
async function clickButton(notePath: string, caption: string): Promise<ClickResult> {
  return await evalInObsidian({
    async callback({ app, caption: buttonCaption, lib: { waitUntil }, notePath: path, obsidianModule }) {
      const WAIT_TIMEOUT_IN_MILLISECONDS = 12_000;
      const SCROLL_STEP_IN_PIXELS = 400;
      const SCROLL_BOTTOM_TOLERANCE_IN_PIXELS = 4;
      await app.workspace.openLinkText(path.replace(/\.md$/, ''), '', false);
      await app.workspace.getLeaf(false).setViewState({ state: { file: path, mode: 'preview' }, type: 'markdown' });

      function findButton(): HTMLButtonElement | undefined {
        const view = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
        const scroller = view?.containerEl.querySelector<HTMLElement>('.markdown-preview-view');
        const found = [...view?.containerEl.querySelectorAll<HTMLButtonElement>(':scope .block-language-code-button button.mod-cta') ?? []]
          .find((candidate) => candidate.textContent === buttonCaption);
        if (!found && scroller) {
          const isAtBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - SCROLL_BOTTOM_TOLERANCE_IN_PIXELS;
          scroller.scrollTop = isAtBottom ? 0 : scroller.scrollTop + SCROLL_STEP_IN_PIXELS;
        }
        return found;
      }

      let button: HTMLButtonElement | undefined;
      try {
        await waitUntil({
          message: `button "${buttonCaption}" never rendered`,
          predicate: () => {
            button = findButton();
            return button !== undefined;
          },
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
      } catch {
        return { output: '', status: 'missing' as const };
      }
      const block = button?.closest('.block-language-code-button');
      button?.click();
      try {
        await waitUntil({
          message: `button "${buttonCaption}" never reported`,
          predicate: () => /Executed (?:successfully|with error)/.test(block?.textContent ?? ''),
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
      } catch {
        return { output: block?.textContent ?? '', status: 'timeout' as const };
      }
      const output = block?.textContent ?? '';
      return { output, status: output.includes('Executed with error') ? 'error' as const : 'ok' as const };
    },
    input: { caption, notePath },
    vaultPath: getTemporaryVault().path
  });
}

async function clickButtonOk(notePath: string, caption: string): Promise<void> {
  const result = await clickButton(notePath, caption);
  expect(result.status, `"${caption}" in ${notePath}: ${result.output}`).toBe('ok');
}

/**
 * Closes whatever a step left open — a modal or a menu — so the next test starts on a bare workspace.
 */
async function closeOverlays(): Promise<void> {
  await evalInObsidian({
    async callback({ lib: { pressKey } }) {
      for (let attempt = 0; attempt < 3 && activeDocument.querySelector('.modal-container, .menu'); attempt++) {
        await pressKey({ key: 'Escape' });
      }
    },
    vaultPath: getTemporaryVault().path
  });
}

/**
 * Reads notes from the vault and from the snapshot `startup.ts` takes, side by side.
 *
 * @param paths - The note paths to read.
 * @returns For each path, its content now (or `null` when missing) and as it shipped (or `null`).
 */
async function readNotes(paths: string[]): Promise<NoteContents[]> {
  return await evalInObsidian({
    async callback({ app, paths: notePaths, snapshotFolder }) {
      const adapter = app.vault.adapter;
      const result: NoteContents[] = [];
      for (const path of notePaths) {
        const file = app.vault.getFileByPath(path);
        const snapshotPath = `${snapshotFolder}/${path}`;
        result.push({
          current: file ? await app.vault.read(file) : null,
          shipped: await adapter.exists(snapshotPath) ? await adapter.read(snapshotPath) : null
        });
      }
      return result;
    },
    input: { paths, snapshotFolder: SNAPSHOT_FOLDER },
    vaultPath: getTemporaryVault().path
  });
}

describe('demo vault Try it buttons', () => {
  it('keeps a copy of the vault as it shipped, for the reset buttons', async () => {
    const [startNote] = await readNotes(['00 Start.md']);
    expect(startNote?.shipped).toContain('# Start here');
  });

  it('selects the range a selection step names, outside the button\'s own source', async () => {
    const notePath = '11 Selection/38 Select ranges.md';
    await clickButtonOk(notePath, 'Select this heading');
    const selection = await evalInObsidian({
      callback({ app }) {
        return app.workspace.activeEditor?.editor?.getSelection() ?? '';
      },
      vaultPath: getTemporaryVault().path
    });
    expect(selection.startsWith('## A section to select')).toBe(true);
    expect(selection).toContain('A heading with nothing under it has no content');
  });

  it('opens the picker a step names, on the section the walkthrough points at', async () => {
    await clickButtonOk('02 Extract/06 Extract heading.md', 'Extract the heading the cursor is in');
    const inputValue = await evalInObsidian({
      async callback({ lib: { waitUntil } }) {
        const WAIT_TIMEOUT_IN_MILLISECONDS = 5000;
        await waitUntil({
          message: 'the extract picker never opened',
          predicate: () => activeDocument.querySelector('.prompt-input') !== null,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        return activeDocument.querySelector<HTMLInputElement>('.prompt-input')?.value ?? '';
      },
      vaultPath: getTemporaryVault().path
    });
    await closeOverlays();
    expect(inputValue).toBe('Ideas worth their own note');
  });

  it('runs a smart cut and paste for real, and puts both notes back', async () => {
    const notePath = '07 Smart cut and paste/25 Smart cut and paste.md';
    const sourcePath = 'Materials/25 Smart cut and paste/Move source.md';
    const targetPath = 'Materials/25 Smart cut and paste/Paste target.md';
    const paragraph = 'Mark me, then move me somewhere else. While I am marked';
    await clickButtonOk(notePath, 'Cancel the move and put both notes back');
    // The button suite may have run first and left every note locked while a selection is marked.
    await clickButtonOk(notePath, 'Lock only the marked note again');

    await clickButtonOk(notePath, 'Mark the paragraph to move');
    await clickButtonOk(notePath, 'Move it to the bottom of Paste target');
    const [movedSource, movedTarget] = await readNotes([sourcePath, targetPath]);
    expect(movedSource?.current).not.toContain(paragraph);
    expect(movedTarget?.current).toContain(paragraph);

    await clickButtonOk(notePath, 'Cancel the move and put both notes back');
    const [resetSource, resetTarget] = await readNotes([sourcePath, targetPath]);
    expect(resetSource?.current).toBe(resetSource?.shipped);
    expect(resetTarget?.current).toBe(resetTarget?.shipped);
  });

  it('deletes what a step created when its reset runs, and turns its settings back off', async () => {
    const notePath = '03 Split/12 Split headings automatically.md';
    const sourcePath = 'Materials/12 Split headings automatically/Greek letters.md';
    await clickButtonOk(notePath, 'Turn on split headings automatically and split into folder');
    await clickButtonOk(notePath, 'Extract the Beta heading');
    const created = await evalInObsidian({
      async callback({ app }) {
        const data = await app.plugins.getPlugin('advanced-note-composer')?.loadData() as Record<string, unknown>;
        return { data: JSON.stringify(data), files: app.vault.getFiles().filter((file) => file.basename === 'Beta').map((file) => file.path) };
      },
      vaultPath: getTemporaryVault().path
    });
    expect(created.files, created.data).toEqual(['Beta/Beta.md']);

    await clickButtonOk(notePath, 'Put Greek letters back and turn both settings off');
    const after = await evalInObsidian({
      async callback({ app }) {
        const data = await app.plugins.getPlugin('advanced-note-composer')?.loadData() as Record<string, unknown>;
        return {
          remaining: app.vault.getFiles().filter((file) => file.basename === 'Beta').map((file) => file.path),
          shouldSplitHeadingsAutomatically: data['shouldSplitHeadingsAutomatically'],
          shouldSplitIntoFolder: data['shouldSplitIntoFolder']
        };
      },
      vaultPath: getTemporaryVault().path
    });
    expect(after).toEqual({ remaining: [], shouldSplitHeadingsAutomatically: false, shouldSplitIntoFolder: false });
    const [source] = await readNotes([sourcePath]);
    expect(source?.current).toBe(source?.shipped);
  });

  it('opens the file explorer\'s own menu for a folder, carrying the plugin\'s commands', async () => {
    await clickButtonOk('06 Folder operations/23 Reorder folders.md', 'Open the menu of the Reorder example folder');
    const menuText = await evalInObsidian({
      async callback({ lib: { clickElement, waitUntil } }) {
        const WAIT_TIMEOUT_IN_MILLISECONDS = 5000;
        // The plugin files its commands under a submenu of its own name, which a click opens.
        const submenuItem = [...activeDocument.querySelectorAll<HTMLElement>(':scope .menu .menu-item')]
          .find((item) => item.textContent === 'Advanced Note Composer');
        if (submenuItem) {
          await clickElement({ element: submenuItem });
        }
        await waitUntil({
          message: 'the plugin\'s submenu never opened',
          predicate: () => activeDocument.querySelectorAll('.menu').length > 1,
          timeoutInMilliseconds: WAIT_TIMEOUT_IN_MILLISECONDS
        });
        return [...activeDocument.querySelectorAll('.menu')].map((menu) => menu.textContent).join('\n');
      },
      vaultPath: getTemporaryVault().path
    });
    await closeOverlays();
    expect(menuText).toContain('Reorder child folders...');
  });

  it('reports which commands a path filter leaves offered', async () => {
    const notePath = '08 Include and exclude/26 Block commands on excluded paths.md';
    await clickButtonOk(notePath, 'Step 2: hide smart cut & paste in the folder');
    await clickButtonOk(notePath, 'Step 3: list the commands on a selection inside');
    const noticeText = await evalInObsidian({
      callback() {
        return [...activeDocument.querySelectorAll('.notice')].map((notice) => notice.textContent).join('\n');
      },
      vaultPath: getTemporaryVault().path
    });
    await clickButtonOk(notePath, 'Step 6: clear the smart cut & paste box');
    expect(noticeText).toContain('Offered: Extract current selection..., Merge current file with another file...');
    expect(noticeText).toContain('Not offered: Smart cut & paste: Mark selection to move');
  });
});
