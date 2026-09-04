/**
 * @file
 *
 * Produces the desktop screenshots the community-store listing needs
 * (T461-P21), driving a staged note in a real Obsidian and writing
 * `images/screenshots/screenshot-desktop-N.png`.
 *
 * Each shot shows a DIFFERENT capability, and each is CAPTIONED by
 * `labelScreenshot` after capture — a listing carousel shows screenshots one at
 * a time with no caption of its own, so an image has to say what it is showing.
 *
 * This plugin has 90-odd settings and two dozen commands, so the hard part is
 * choosing. The five below are its MODALS, because that is where the plugin
 * actually looks like something: a reader recognizes "split this note into one
 * file per heading" from the dialog far faster than from the result. Ordinary
 * modals render fine under CDP — only Obsidian's own settings modal does not.
 *
 * The note is staged rather than taken from the demo vault: the vault's notes
 * are documentation, full of prose about the feature, whereas these dialogs
 * read best over a short note whose headings are obviously headings.
 */

import {
  mkdirSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import {
  captureObsidianScreenshot,
  evalInObsidian,
  labelScreenshot,
  readPngDimensions
} from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

/**
 * The editor, reduced to cursor placement.
 */
interface CursorEditor {
  setCursor(this: void, line: number, ch: number): void;
}

/**
 * A Markdown view, reduced to the editor cursor call this storyboard needs.
 */
interface CursorEditorView {
  editor: CursorEditor;
}

/**
 * `App`, reduced to the inline-title toggle that `obsidian-typings` does not
 * declare.
 */
interface InlineTitleApp {
  updateInlineTitleDisplay(this: void): void;
}

const PLUGIN_ID = 'advanced-note-composer';
const WIDTH_IN_PIXELS = 1200;
const HEIGHT_IN_PIXELS = 800;

/**
 * The staged note every shot operates on.
 */
const SUBJECT_NOTE_PATH = 'Screenshots/Project plan.md';

/**
 * Line of the `## Timeline` heading in the staged note, for the commands that
 * act on the heading under the cursor. Counting from zero: 0 `# Project plan`,
 * 2 `## Goals`, 6 `## Timeline`. Pointing this at body text instead makes
 * heading commands silently no-op, and the shot becomes a plain editor.
 */
const HEADING_LINE = 6;

const IMAGES_DIRECTORY = join(process.cwd(), 'images', 'screenshots');

beforeAll(async () => {
  const vault = getTemporaryVault();

  vault.populate({
    'Screenshots/Archive.md': '# Archive\n\nA note to merge into.\n',
    [SUBJECT_NOTE_PATH]: buildSubjectNote()
  });
  await vault.syncToDevice();

  await evalInObsidian({
    async callback({ app, lib: { waitUntil }, subjectNotePath }) {
      const SETTLE_TIMEOUT_IN_MILLISECONDS = 30_000;
      const SETTLE_DELAY_IN_MILLISECONDS = 1000;

      app.changeTheme('obsidian');

      await waitUntil({
        message: 'the staged note to appear in the vault',
        predicate: () => Boolean(app.vault.getFileByPath(subjectNotePath)),
        timeoutInMilliseconds: SETTLE_TIMEOUT_IN_MILLISECONDS
      });

      // The dialogs are the subject; the file explorer and an empty right dock
      // Would otherwise take a third of the frame behind them.
      app.workspace.leftSplit.collapse();
      app.workspace.rightSplit.collapse();

      app.vault.setConfig('showInlineTitle', false);
      const inlineTitleApp: unknown = app;
      (inlineTitleApp as InlineTitleApp).updateInlineTitleDisplay();

      await sleep(SETTLE_DELAY_IN_MILLISECONDS);
    },
    input: { subjectNotePath: SUBJECT_NOTE_PATH },
    vaultPath: vaultPath()
  });
});

describe('desktop store screenshots', () => {
  it('1 - the recursive-split preview', async () => {
    // NOT `open-split-modal`, despite the name: that command is the smart-cut
    // Handoff and `canExecute()`s only while a selection is marked, so it opens
    // Nothing here. This one previews the whole folder tree the split will
    // Create, which is the plugin's argument in a single frame.
    await runCommandAndCapture('split-note-by-headings-recursively', 1, 'Split a note into one file per heading, nested');
  });

  it('2 - the extract modal', async () => {
    await runCommandAndCapture('extract-this-heading', 2, 'Extract a heading into its own note, linked in place');
  });

  it('3 - the reorder-headings modal', async () => {
    await runCommandAndCapture('reorder-headings', 3, 'Reorder a note by moving whole sections');
  });

  it('4 - the rename-heading modal', async () => {
    await runCommandAndCapture('rename-heading', 4, 'Rename a heading and every link to it');
  });

  it('5 - the merge modal', async () => {
    await runCommandAndCapture('merge-file', 5, 'Merge this note into another');
  });
});

/**
 * Builds the note the dialogs operate on.
 *
 * Short, with headings that read as headings at listing-thumbnail size, and
 * enough sections that "one file per heading" is obviously worth doing.
 *
 * @returns The note's Markdown.
 */
function buildSubjectNote(): string {
  return '# Project plan\n\n'
    + '## Goals\n\nShip the first release by the end of the quarter.\n\n'
    + '## Timeline\n\nDesign in June, build in July, review in August.\n\n'
    + '## Risks\n\nThe integration is the long pole, and it is not started.\n\n'
    + '## Open questions\n\nWho owns the migration, and when does it run?\n';
}

/**
 * Opens the staged note, puts the cursor on a heading, runs one of the plugin's
 * commands, captures the dialog it opens, then dismisses it.
 *
 * @param commandId - The plugin-relative command id.
 * @param index - The 1-based listing position.
 * @param caption - The caption drawn across the bottom of the frame.
 */
async function runCommandAndCapture(commandId: string, index: number, caption: string): Promise<void> {
  const modalTitle = await evalInObsidian({
    async callback({ app, command, headingLine, lib: { pressKey, waitUntil }, obsidianModule, pluginId, subjectNotePath }) {
      const MODAL_TIMEOUT_IN_MILLISECONDS = 15_000;

      // Close anything already open — on first load this plugin shows a release
      // Notes dialog, and waiting for "a modal" happily photographed THAT
      // Instead of the one the command opens. Waiting for the count to reach
      // Zero and then one is what ties the captured dialog to this command.
      await pressKey({ key: 'Escape' });

      await waitUntil({
        message: 'every previously-open dialog to close',
        predicate: () => document.querySelectorAll('.modal-container').length === 0,
        timeoutInMilliseconds: MODAL_TIMEOUT_IN_MILLISECONDS
      });

      // Let the PREVIOUS shot's capture finish settling before opening this
      // Shot's dialog. `captureObsidianScreenshot` overrides the device metrics
      // And clears them again, and the re-layout that lands afterwards closes a
      // Modal opened too soon after it — which is why every shot that followed a
      // Successful capture photographed an empty frame.
      const RESIZE_SETTLE_DELAY_IN_MILLISECONDS = 2000;
      await sleep(RESIZE_SETTLE_DELAY_IN_MILLISECONDS);

      const file = app.vault.getFileByPath(subjectNotePath);
      if (!file) {
        throw new Error(`Note is missing from the vault: ${subjectNotePath}`);
      }

      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(file);

      // Several of these commands act on the heading under the cursor, so the
      // Cursor has to be ON one or the command is a no-op and the shot is of an
      // Ordinary editor.
      const view: unknown = app.workspace.getActiveViewOfType(obsidianModule.MarkdownView);
      (view as CursorEditorView | null)?.editor.setCursor(headingLine, 0);

      const wasExecuted = app.commands.executeCommandById(`${pluginId}:${command}`);

      await waitUntil({
        message: `the ${command} dialog to open`,
        predicate: () => document.querySelectorAll('.modal-container').length === 1,
        timeoutInMilliseconds: MODAL_TIMEOUT_IN_MILLISECONDS
      });

      const SETTLE_DELAY_IN_MILLISECONDS = 900;
      await sleep(SETTLE_DELAY_IN_MILLISECONDS);

      // Returned so the test can assert WHICH dialog was captured. Without this
      // A command that silently does nothing photographs whatever is on screen.
      // Read from the CONTAINER, not `.modal`: several of these commands open an
      // Obsidian suggester, which renders `.prompt` markup and has no `.modal`
      // Element at all, so probing `.modal` reported an empty dialog.
      const container = document.querySelector('.modal-container');
      const heading = container?.querySelector('.modal-title, .prompt-title, h1, h2, .setting-item-name');
      const TITLE_LENGTH_LIMIT = 60;
      const headingText = (heading?.textContent ?? '').trim();
      const containerText = (container?.textContent ?? '').trim().slice(0, TITLE_LENGTH_LIMIT);
      return {
        title: headingText === '' ? (containerText === '' ? '(empty)' : containerText) : headingText,
        wasExecuted
      };
    },
    input: {
      command: commandId,
      headingLine: HEADING_LINE,
      pluginId: PLUGIN_ID,
      subjectNotePath: SUBJECT_NOTE_PATH
    },
    vaultPath: vaultPath()
  });

  expect(modalTitle).toMatchObject({ wasExecuted: true });
  expect(modalTitle.title).not.toBe('Release notes');
  expect(modalTitle.title).not.toBe('(empty)');

  await shoot(index, caption);

  await evalInObsidian({
    async callback({ lib: { pressKey } }) {
      const SETTLE_DELAY_IN_MILLISECONDS = 600;
      // Escape, never the confirm button: clicking a feature dialog's primary
      // Action would PERFORM it, and the next shot would open over a mutated vault.
      await pressKey({ key: 'Escape' });
      await sleep(SETTLE_DELAY_IN_MILLISECONDS);
    },
    vaultPath: vaultPath()
  });
}

/**
 * Captures the window, captions it, and writes it as
 * `images/screenshot-desktop-<index>.png`.
 *
 * @param index - The 1-based listing position.
 * @param caption - The caption drawn across the bottom of the frame.
 */
async function shoot(index: number, caption: string): Promise<void> {
  const bytes = await captureObsidianScreenshot({
    heightInPixels: HEIGHT_IN_PIXELS,
    vaultPath: vaultPath(),
    widthInPixels: WIDTH_IN_PIXELS
  });

  const labeled = await labelScreenshot(bytes, { text: caption });

  expect(readPngDimensions(labeled)).toStrictEqual({
    heightInPixels: HEIGHT_IN_PIXELS,
    widthInPixels: WIDTH_IN_PIXELS
  });

  mkdirSync(IMAGES_DIRECTORY, { recursive: true });
  writeFileSync(join(IMAGES_DIRECTORY, `screenshot-desktop-${String(index)}.png`), labeled);
}

function vaultPath(): string {
  return getTemporaryVault().path;
}
