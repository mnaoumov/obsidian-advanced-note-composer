/**
 * @file
 *
 * Produces the five mobile screenshots the community-store listing needs
 * (T461-P21), driving a staged note in Obsidian Mobile on a real Android
 * emulator and writing `images/screenshots/screenshot-mobile-N.png`.
 *
 * The mobile counterpart of the desktop capture suite. It shows a different cut
 * of the plugin, because the two platforms photograph differently: on a phone
 * these dialogs fill nearly the whole screen and grow a row of touch controls
 * the desktop build never shows, while the file pickers behind `Extract` and
 * `Merge` render as a full-height empty list unless a real on-screen keyboard
 * has focused them — which no script can arrange. So the mobile set drops those
 * two and opens instead on the note the flow starts from.
 *
 * There is no mobile equivalent of the desktop viewport override, so the capture
 * is always the device's own framebuffer. The fix is to make the DEVICE the
 * right size: this runs on a dedicated `obsidian_screenshots` AVD built at
 * exactly 900x1600, so the frame already IS the store's size — no crop, no
 * rescale, no letterbox, no post-processing at all. That AVD needs ONE-TIME
 * provisioning, and both steps are non-obvious — see [[T461-P21]].
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
 * `App`, reduced to the font-size applier that `obsidian-typings` does not
 * declare. Setting `baseFontSize` alone changes nothing on screen.
 */
interface FontSizeApp {
  updateFontSize(this: void): void;
}

/**
 * `App`, reduced to the inline-title toggle that `obsidian-typings` does not
 * declare.
 */
interface InlineTitleApp {
  updateInlineTitleDisplay(this: void): void;
}

const PLUGIN_ID = 'advanced-note-composer';
const WIDTH_IN_PIXELS = 900;
const HEIGHT_IN_PIXELS = 1600;

/**
 * The staged note every shot operates on — the same one the desktop suite uses,
 * so the two sets show the same flow on the two platforms.
 */
const SUBJECT_NOTE_PATH = 'Screenshots/Project plan.md';

/**
 * A second note, so the vault the shots are taken in is not a single file.
 */
const ARCHIVE_NOTE_PATH = 'Screenshots/Archive.md';

/**
 * Line of the `## Timeline` heading in the staged note. Counting from zero:
 * 0 `# Project plan`, 2 `## Goals`, 6 `## Timeline`. Pointing this at body text
 * instead makes the heading commands silently no-op.
 */
const HEADING_LINE = 6;

/**
 * Base font size for the mobile shots.
 *
 * Below Obsidian's own 16px default, because the screenshot AVD is 900x1600 at
 * density 320 — a 450x800 dp screen, on which the default type is large enough
 * that the recursive-split dialog's "Notes that will be created" list, the whole
 * point of that shot, falls off the bottom of the frame.
 */
const MOBILE_FONT_SIZE_IN_PIXELS = 13;

const IMAGES_DIRECTORY = join(process.cwd(), 'images', 'screenshots');

/**
 * Diagnostics from the setup closure, surfaced by the first test so a failed
 * mobile layout is readable instead of silent.
 */
let setupDiagnostics: unknown;

beforeAll(async () => {
  const vault = getTemporaryVault();

  vault.populate({
    [ARCHIVE_NOTE_PATH]: '# Archive\n\nA note to merge into.\n',
    [SUBJECT_NOTE_PATH]: buildSubjectNote()
  });
  await vault.syncToDevice();

  setupDiagnostics = await evalInObsidian({
    async callback({ app, fontSizeInPixels, lib: { waitUntil }, subjectNotePath }) {
      // A closure runs inside ONE Appium `execute/sync` call, which WebDriver
      // Caps around 30s. A longer wait in here dies as an opaque `script
      // Timeout` rather than a readable failure, so keep every wait under it.
      const SETTLE_TIMEOUT_IN_MILLISECONDS = 20_000;
      const SETTLE_DELAY_IN_MILLISECONDS = 1500;

      app.changeTheme('obsidian');

      await waitUntil({
        message: 'the staged note to appear in the vault',
        predicate: () => Boolean(app.vault.getFileByPath(subjectNotePath)),
        timeoutInMilliseconds: SETTLE_TIMEOUT_IN_MILLISECONDS
      });

      const file = app.vault.getFileByPath(subjectNotePath);
      if (!file) {
        throw new Error(`Note is missing from the vault: ${subjectNotePath}`);
      }

      await app.workspace.getLeaf(false).openFile(file);

      // Smaller type, so the taller dialogs fit the frame — see
      // `MOBILE_FONT_SIZE_IN_PIXELS`. Setting the config alone changes nothing
      // On screen; the applier is what re-renders.
      app.vault.setConfig('baseFontSize', fontSizeInPixels);
      const fontApp: unknown = app;
      (fontApp as FontSizeApp).updateFontSize();

      // The note's own `# Project plan` heading already titles it, so Obsidian's
      // Inline title renders the name twice.
      app.vault.setConfig('showInlineTitle', false);
      const inlineTitleApp: unknown = app;
      (inlineTitleApp as InlineTitleApp).updateInlineTitleDisplay();

      await sleep(SETTLE_DELAY_IN_MILLISECONDS);

      return { isNoteOpen: Boolean(app.workspace.getActiveFile()) };
    },
    input: { fontSizeInPixels: MOBILE_FONT_SIZE_IN_PIXELS, subjectNotePath: SUBJECT_NOTE_PATH },
    vaultPath: vaultPath()
  });
});

describe('mobile store screenshots', () => {
  it('opens the note the shots are framed on', () => {
    // Surfaced as an assertion because vitest swallows console output from an
    // Integration worker, and a silently-wrong layout produces five bad images
    // Without a single failure.
    expect(setupDiagnostics).toMatchObject({ isNoteOpen: true });
  });

  it('1 - the note the whole flow starts from', async () => {
    // The only shot that does not run a command, so it is the only one that does
    // Not go through the dismissal `runCommandAndCapture` does first — and this
    // Plugin greets a fresh install with a "Release notes" dialog, which is what
    // Got photographed instead of the note.
    await dismissDialogs();
    await shoot(1, 'One long note, five sections');
  });

  it('2 - the reorder-headings modal', async () => {
    await runCommandAndCapture('reorder-headings', 2, 'Reorder a note by moving whole sections');
  });

  it('3 - the rename-heading modal', async () => {
    await runCommandAndCapture('rename-heading', 3, 'Rename a heading and every link to it');
  });

  it('4 - the whole-note split preview', async () => {
    await runCommandAndCapture('split-note-by-headings-recursively', 4, 'Split it into one file per heading, nested');
  });

  it('5 - the single-heading split preview', async () => {
    // The same machinery scoped to ONE heading, which is the far more common
    // Everyday use. Every shot in this set escapes its dialog rather than
    // Confirming it: the harness pushes files into a vault that persists on the
    // Device between runs and is never cleared, so one confirmed split would
    // Leave its produced notes behind for every later run to trip over.
    await runCommandAndCapture('split-heading-recursively', 5, 'Or split just one heading, and all it contains');
  });
});

/**
 * Builds the note the dialogs operate on.
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
 * Closes every dialog currently on screen and waits for the last of them to go.
 *
 * A SYNTHETIC keydown rather than the harness's `pressKey`, which injects through
 * Electron's `sendInputEvent` and so exists on desktop only — on Android it dies
 * with `Cannot read properties of undefined (reading 'remote')`. Obsidian's
 * keymap listens on `document`, so a dispatched event dismisses a dialog just as
 * a real key would. Clicking the `.modal-close-button` is NOT an alternative: on
 * an `obsidian-dev-utils` alert it does not close the dialog at all (T503-P1).
 */
async function dismissDialogs(): Promise<void> {
  await evalInObsidian({
    async callback({ lib: { waitUntil } }) {
      const MODAL_TIMEOUT_IN_MILLISECONDS = 15_000;
      const SETTLE_DELAY_IN_MILLISECONDS = 600;

      // `pressKey` is Electron-only and there is no `window.electron` on the phone, so this file is a
      // Permanent exception to the trusted-input convention (see the fuller note further down).
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));

      await waitUntil({
        message: 'every open dialog to close',
        predicate: () => document.querySelectorAll('.modal-container').length === 0,
        timeoutInMilliseconds: MODAL_TIMEOUT_IN_MILLISECONDS
      });

      await sleep(SETTLE_DELAY_IN_MILLISECONDS);
    },
    vaultPath: vaultPath()
  });
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
    async callback({ app, command, headingLine, lib: { waitUntil }, obsidianModule, pluginId, subjectNotePath }) {
      const MODAL_TIMEOUT_IN_MILLISECONDS = 15_000;
      const SETTLE_DELAY_IN_MILLISECONDS = 900;

      // Close anything already open — on first load this plugin shows a release
      // Notes dialog, and waiting for "a modal" happily photographed THAT
      // Instead of the one the command opens. Waiting for the count to reach
      // Zero and then one is what ties the captured dialog to this command.
      //
      // A SYNTHETIC keydown rather than the harness's `pressKey`, which injects
      // Through Electron's `sendInputEvent` and so exists on desktop only — on
      // Android it dies with `Cannot read properties of undefined (reading
      // 'remote')`. Obsidian's keymap listens on `document`, so a dispatched
      // Event dismisses the dialog just as a real key would. Clicking the
      // `.modal-close-button` is NOT an alternative: on an `obsidian-dev-utils`
      // Alert it does not close the dialog at all (see [[T503-P1]]).
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));

      await waitUntil({
        message: 'every previously-open dialog to close',
        predicate: () => document.querySelectorAll('.modal-container').length === 0,
        timeoutInMilliseconds: MODAL_TIMEOUT_IN_MILLISECONDS
      });

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

      // Obsidian's phone suggester renders full height and expects the on-screen
      // Keyboard to have scrolled it into place. Driven from a script there is no
      // Keyboard, so the dialog sits off the bottom of the frame with an empty
      // List above it. Re-dispatching `input` makes the suggester render its
      // Matches, and scrolling the dialog into view puts it back in frame.
      const promptInput = document.querySelector('.prompt-input');
      if (promptInput instanceof HTMLInputElement) {
        promptInput.dispatchEvent(new Event('input'));
      }
      document.querySelector('.modal-container .prompt, .modal-container .modal')?.scrollIntoView({ block: 'center' });

      await sleep(SETTLE_DELAY_IN_MILLISECONDS);

      // Returned so the test can assert WHICH dialog was captured. Read from the
      // CONTAINER, not `.modal`: several of these commands open an Obsidian
      // Suggester, which renders `.prompt` markup and has no `.modal` element.
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
    async callback() {
      const SETTLE_DELAY_IN_MILLISECONDS = 600;
      // Escape, never the confirm button: clicking a feature dialog's primary
      // Action would PERFORM it, and the next shot would open over a mutated vault.
      // Dispatched rather than pressed for the same reason as above: no `window.electron` on Android.
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
      await sleep(SETTLE_DELAY_IN_MILLISECONDS);
    },
    vaultPath: vaultPath()
  });
}

/**
 * Captures the device screen, captions it, and writes it as
 * `images/screenshot-mobile-<index>.png`.
 *
 * @param index - The 1-based listing position.
 * @param caption - The caption drawn across the bottom of the frame.
 */
async function shoot(index: number, caption: string): Promise<void> {
  const captured = await captureObsidianScreenshot({ vaultPath: vaultPath() });

  // The AVD is 900x1600, so the device frame IS the store's size. Asserting it
  // Here is what keeps that true: run this against any other AVD and it fails
  // Loudly instead of quietly shipping an off-spec image.
  expect(readPngDimensions(captured)).toStrictEqual({
    heightInPixels: HEIGHT_IN_PIXELS,
    widthInPixels: WIDTH_IN_PIXELS
  });

  // Captioned AFTER capture, so the frame stays an untouched device screenshot
  // And rewording a label needs no re-shoot.
  const labeled = await labelScreenshot(captured, { text: caption });

  mkdirSync(IMAGES_DIRECTORY, { recursive: true });
  writeFileSync(join(IMAGES_DIRECTORY, `screenshot-mobile-${String(index)}.png`), labeled);
}

function vaultPath(): string {
  return getTemporaryVault().path;
}
