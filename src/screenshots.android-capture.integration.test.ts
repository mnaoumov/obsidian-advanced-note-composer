/**
 * @file
 *
 * Produces the seven mobile screenshots the community-store listing needs,
 * driving a staged note in Obsidian Mobile on a real Android
 * emulator and writing `images/screenshots/screenshot-mobile-N.png`.
 *
 * The mobile counterpart of the desktop capture suite, in the same order where
 * the two sets overlap: the note the flow starts from, the `Extract` picker, the
 * dialogs, and the `Merge` picker last. On a phone the dialogs fill nearly the
 * whole screen and grow a row of touch controls the desktop build never shows,
 * which is why the mobile set carries more frames than the desktop one.
 *
 * **The two pickers are taken with the soft keyboard UP, and nothing else is.**
 * `Extract` and `Merge` are Obsidian suggesters, whose field is anchored to the
 * bottom of the viewport and whose list grows upward from it: without a keyboard
 * the list renders as a full-height empty band, which is why this suite used to
 * leave both out. The harness can raise a real IME now
 * (`withSoftKeyboardEnabled` + `raiseSoftKeyboard`), so those two frames go
 * through {@link shootWithSoftKeyboard} and the device framebuffer. The five
 * dialog frames stay on `captureObsidianScreenshot`, which photographs the page:
 * the rename-heading frame was measured WITH a keyboard and came back worse,
 * because Android's own selection toolbar covers the dialog title (the repo's
 * `AGENTS.md` has the detail).
 *
 * **The two keyboard frames are NOT byte-reproducible**: a device capture
 * carries the status bar, and its clock and battery change between runs. The
 * harness's `paintOutStatusBar`, which the link picker's suite uses to fix
 * exactly that, arrived in a later `obsidian-integration-testing` major than
 * this repo is on; adopting it is part of that bump, not of these frames. The
 * blinking caret, which the same suite also found, is simply not drawn.
 *
 * There is no mobile equivalent of the desktop viewport override, so the capture
 * is always the device's own framebuffer. The fix is to make the DEVICE the
 * right size: this runs on a dedicated `obsidian_screenshots` AVD built at
 * exactly 900x1600, so the frame already IS the store's size — no crop, no
 * rescale, no letterbox. That AVD needs ONE-TIME provisioning, and both steps
 * are non-obvious; they are written out beside `SCREENSHOT_AVD_NAME` in
 * `scripts/vitest-config.ts`.
 */

import {
  mkdirSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as sleepInNode } from 'node:timers/promises';
import {
  captureDeviceScreenshot,
  captureObsidianScreenshot,
  evalInObsidian,
  labelScreenshot,
  parseInputMethodState,
  raiseSoftKeyboard,
  readPngDimensions,
  resolveEmulatorDeviceId,
  runAdbText,
  withSoftKeyboardEnabled
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
  setCursor: (this: void, line: number, ch: number) => void;
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
  updateFontSize: (this: void) => void;
}

/**
 * `App`, reduced to the inline-title toggle that `obsidian-typings` does not
 * declare.
 */
interface InlineTitleApp {
  updateInlineTitleDisplay: (this: void) => void;
}

interface OpenCommandDialogParams {
  readonly commandId: string;

  /**
   * Whether to apply the no-keyboard workaround for a suggester — see the
   * comment where it is applied.
   */
  readonly shouldRevealSuggester: boolean;
}

/**
 * What {@link openCommandDialog} saw once the command's dialog was on screen.
 */
interface OpenedDialog {
  readonly suggestionCount: number;
  readonly title: string;
  readonly wasExecuted: boolean;
}

const PLUGIN_ID = 'advanced-note-composer';
const WIDTH_IN_PIXELS = 900;
const HEIGHT_IN_PIXELS = 1600;

/**
 * The AVD these shots are taken on, matched by name.
 *
 * Never the first device `adb devices` lists: a physical phone is routinely
 * plugged into the same machine, and the shared `obsidian_test` AVD the
 * cross-platform suites drive is a different size.
 */
const AVD_NAME = 'obsidian_screenshots';

/**
 * The suggester's field, which is what a thumb touches to bring the keyboard up.
 */
const PROMPT_INPUT_SELECTOR = '.modal-container .prompt-input';

/**
 * The flag `dumpsys input_method` sets while an IME is showing. Nothing in the
 * page reports the keyboard, so the device's own answer is the only one there is.
 */
const INPUT_SHOWN_STATE = 'mInputShown=true';

const KEYBOARD_RETRACT_DELAY_IN_MILLISECONDS = 900;
const KEYBOARD_SETTLE_DELAY_IN_MILLISECONDS = 900;
const TEST_TIMEOUT_IN_MILLISECONDS = 300_000;

/**
 * The staged note every shot operates on — the same one the desktop suite uses,
 * so the two sets show the same flow on the two platforms.
 */
const SUBJECT_NOTE_PATH = 'Screenshots/Project plan.md';

/**
 * The other notes, so the `Merge` picker has more than one destination to offer
 * and the vault the shots are taken in is not a single file.
 */
const OTHER_NOTES: Readonly<Record<string, string>> = {
  'Screenshots/Archive.md': '# Archive\n\nA note to merge into.\n',
  'Screenshots/Meeting notes.md': '# Meeting notes\n\nWhat was decided, and by whom.\n',
  'Screenshots/Reading list.md': '# Reading list\n\nArticles to get through this month.\n'
};

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

let deviceId = '';

beforeAll(async () => {
  deviceId = await resolveEmulatorDeviceId({ avdName: AVD_NAME });

  const vault = getTemporaryVault();

  vault.populate({
    ...OTHER_NOTES,
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
    // Integration worker, and a silently-wrong layout produces bad images
    // Without a single failure.
    expect(setupDiagnostics).toMatchObject({ isNoteOpen: true });
  });

  it('1 - the note the whole flow starts from', async () => {
    // The only shot that does not run a command, so it is the only one that does
    // Not go through the dismissal `openCommandDialog` does first — and this
    // Plugin greets a fresh install with a "Release notes" dialog, which is what
    // Got photographed instead of the note.
    await dismissDialogs();
    await shoot(1, 'One long note, five sections');
  });

  it('2 - the extract picker', async () => {
    // Opened seeded with the heading's own name, which is what the new note will
    // Be called — the frame shows the name being chosen, not an empty search.
    await runPickerAndCapture('extract-this-heading', 2, 'Extract a heading into its own note, linked in place');
  }, TEST_TIMEOUT_IN_MILLISECONDS);

  it('3 - the reorder-headings modal', async () => {
    await runCommandAndCapture('reorder-headings', 3, 'Reorder a note by moving whole sections');
  });

  it('4 - the rename-heading modal', async () => {
    await runCommandAndCapture('rename-heading', 4, 'Rename a heading and every link to it');
  });

  it('5 - the whole-note split preview', async () => {
    await runCommandAndCapture('split-note-by-headings-recursively', 5, 'Split it into one file per heading, nested');
  });

  it('6 - the single-heading split preview', async () => {
    // The same machinery scoped to ONE heading, which is the far more common
    // Everyday use. Every shot in this set escapes its dialog rather than
    // Confirming it: the harness pushes files into a vault that persists on the
    // Device between runs and is never cleared, so one confirmed split would
    // Leave its produced notes behind for every later run to trip over.
    await runCommandAndCapture('split-heading-recursively', 6, 'Or split just one heading, and all it contains');
  });

  it('7 - the merge picker', async () => {
    // Nothing typed: the frame is the list of notes this one can be merged into.
    await runPickerAndCapture('merge-file', 7, 'Merge this note into another');
  }, TEST_TIMEOUT_IN_MILLISECONDS);
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
 * Asks the DEVICE whether an IME is showing, since nothing in the page reports one.
 *
 * @returns A {@link Promise} that resolves to whether the soft keyboard is up.
 */
async function checkIsSoftKeyboardShown(): Promise<boolean> {
  const dump = await runAdbText({
    commandArguments: ['shell', 'dumpsys', 'input_method'],
    deviceId
  });

  return parseInputMethodState(dump).includes(INPUT_SHOWN_STATE);
}

/**
 * Closes every dialog currently on screen and waits for the last of them to go.
 *
 * The in-renderer `pressKey` dispatches a SYNTHETIC keydown on Android, where
 * the harness's trusted input path does not exist. Obsidian's keymap listens on
 * `document`, so a dispatched event dismisses a dialog just as a real key would.
 * Clicking the `.modal-close-button` is NOT an alternative: on an
 * `obsidian-dev-utils` alert it does not close the dialog at all.
 */
async function dismissDialogs(): Promise<void> {
  await evalInObsidian({
    async callback({ lib: { pressKey, waitUntil } }) {
      const MODAL_TIMEOUT_IN_MILLISECONDS = 15_000;
      const SETTLE_DELAY_IN_MILLISECONDS = 600;

      await pressKey({ key: 'Escape' });

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
 * Stops the text caret in the open picker from being drawn.
 *
 * The caret BLINKS, so two captures of the same state disagree on a 2px column
 * whenever they land in opposite halves of the blink. The keyboard standing open
 * is what shows the field has focus, and it is in frame.
 */
async function hideCaret(): Promise<void> {
  await evalInObsidian({
    callback({ inputSelector }): void {
      const input = document.querySelector(inputSelector);
      if (!(input instanceof HTMLInputElement)) {
        throw new TypeError('The picker has no input.');
      }

      input.setCssStyles({ caretColor: 'transparent' });
    },
    input: { inputSelector: PROMPT_INPUT_SELECTOR },
    vaultPath: vaultPath()
  });
}

/**
 * Puts the soft keyboard down if one is up.
 *
 * Needed on both sides of a keyboard frame. Before it, because
 * `raiseSoftKeyboard` proves the lift as a DELTA against a baseline read just
 * before its touch, so a keyboard Obsidian's own focus already raised reads as a
 * field that never moved. After it, because the page-captured dialog frames that
 * follow would otherwise render into the viewport the IME shrank.
 *
 * `KEYCODE_BACK` retracts a showing IME and never reaches the app — which is why
 * the device is asked FIRST: with no IME showing, the same key would reach
 * Obsidian and close whatever is on screen.
 */
async function lowerSoftKeyboard(): Promise<void> {
  if (!await checkIsSoftKeyboardShown()) {
    return;
  }

  await pressBackAndSettle();
  if (!await checkIsSoftKeyboardShown()) {
    return;
  }

  // One retry, because the first BACK can land while the IME is still animating
  // Up from the focus that raised it, and an IME mid-animation swallows it.
  await pressBackAndSettle();
  if (await checkIsSoftKeyboardShown()) {
    throw new Error('The soft keyboard would not retract.');
  }
}

/**
 * Opens the staged note, puts the cursor on a heading, runs one of the plugin's
 * commands, and waits for the dialog it opens.
 *
 * @param params - The command, and whether its dialog is a suggester shot without a keyboard.
 * @returns What the dialog showed.
 */
async function openCommandDialog(params: OpenCommandDialogParams): Promise<OpenedDialog> {
  const opened = await evalInObsidian({
    async callback({ app, command, headingLine, lib: { pressKey, waitUntil }, obsidianModule, pluginId, shouldRevealSuggester, subjectNotePath }) {
      /**
       * Sized so the SUM of every wait this closure declares stays under the transport's ~30 s per-closure
       * cap, not at it. Two modal waits and the settling delay share the budget. Both waits are a modal
       * count changing, which an emulator still reaches within a second of the keystroke that causes it;
       * ten seconds is already far past the point where a missing modal means the command did not open one.
       */
      const MODAL_TIMEOUT_IN_MILLISECONDS = 10_000;
      const SETTLE_DELAY_IN_MILLISECONDS = 900;

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

      if (shouldRevealSuggester) {
        // Obsidian's phone suggester renders full height and expects the on-screen
        // Keyboard to have scrolled it into place. Without one the dialog sits off
        // The bottom of the frame with an empty list above it; re-dispatching
        // `input` makes it render its matches, and scrolling puts it back in frame.
        // The keyboard frames never take this path: with a real IME up it would
        // Fight the scroll the IME itself performs.
        const promptInput = document.querySelector('.prompt-input');
        if (promptInput instanceof HTMLInputElement) {
          promptInput.dispatchEvent(new Event('input'));
        }
        document.querySelector('.modal-container .prompt, .modal-container .modal')?.scrollIntoView({ block: 'center' });
      }

      await sleep(SETTLE_DELAY_IN_MILLISECONDS);

      // Returned so the test can assert WHICH dialog was captured. Read from the
      // CONTAINER, not `.modal`: a suggester renders `.prompt` markup and has no
      // `.modal-title` of its own.
      const container = document.querySelector('.modal-container');
      const heading = container?.querySelector('.modal-title, .prompt-title, h1, h2, .setting-item-name');
      const TITLE_LENGTH_LIMIT = 60;
      const headingText = (heading?.textContent ?? '').trim();
      const containerText = (container?.textContent ?? '').trim().slice(0, TITLE_LENGTH_LIMIT);
      return {
        suggestionCount: container?.querySelectorAll('.suggestion-item').length ?? 0,
        title: headingText === '' ? (containerText === '' ? '(empty)' : containerText) : headingText,
        wasExecuted
      };
    },
    input: {
      command: params.commandId,
      headingLine: HEADING_LINE,
      pluginId: PLUGIN_ID,
      shouldRevealSuggester: params.shouldRevealSuggester,
      subjectNotePath: SUBJECT_NOTE_PATH
    },
    vaultPath: vaultPath()
  });

  expect(opened).toMatchObject({ wasExecuted: true });
  expect(opened.title).not.toBe('Release notes');
  expect(opened.title).not.toBe('(empty)');
  return opened;
}

/**
 * Presses BACK on the device and gives the IME time to finish retracting.
 */
async function pressBackAndSettle(): Promise<void> {
  await runAdbText({
    commandArguments: ['shell', 'input', 'keyevent', 'KEYCODE_BACK'],
    deviceId
  });

  await sleepInNode(KEYBOARD_RETRACT_DELAY_IN_MILLISECONDS);
}

/**
 * Escapes the dialog on screen — never its confirm button: tapping a feature
 * dialog's primary action would PERFORM it, and the next shot would open over a
 * mutated vault.
 */
async function pressEscape(): Promise<void> {
  await evalInObsidian({
    async callback({ lib: { pressKey } }) {
      const SETTLE_DELAY_IN_MILLISECONDS = 600;
      await pressKey({ key: 'Escape' });
      await sleep(SETTLE_DELAY_IN_MILLISECONDS);
    },
    vaultPath: vaultPath()
  });
}

/**
 * Runs a command whose dialog is an ordinary modal, captures it, then escapes it.
 *
 * @param commandId - The plugin-relative command id.
 * @param index - The 1-based listing position.
 * @param caption - The caption drawn across the bottom of the frame.
 */
async function runCommandAndCapture(commandId: string, index: number, caption: string): Promise<void> {
  await openCommandDialog({ commandId, shouldRevealSuggester: true });
  await shoot(index, caption);
  await pressEscape();
}

/**
 * Runs a command whose dialog is a suggester, captures it with the soft keyboard
 * up, then escapes it and puts the keyboard away.
 *
 * @param commandId - The plugin-relative command id.
 * @param index - The 1-based listing position.
 * @param caption - The caption drawn across the bottom of the frame.
 */
async function runPickerAndCapture(commandId: string, index: number, caption: string): Promise<void> {
  // The wrapper spans the whole shot, so the device setting is live before the
  // Picker's field takes focus, and the device is put back exactly as it was
  // Found even if the capture throws.
  await withSoftKeyboardEnabled({
    async callback() {
      const opened = await openCommandDialog({ commandId, shouldRevealSuggester: false });
      expect(opened.suggestionCount).toBeGreaterThan(0);
      await shootWithSoftKeyboard(index, caption);
      await pressEscape();
      await lowerSoftKeyboard();
    },
    deviceId
  });
}

/**
 * Replaces the open suggester's text and lets it re-render its rows.
 *
 * @param value - The new text.
 * @returns The text the field held before.
 */
async function setPromptInputValue(value: string): Promise<string> {
  return await evalInObsidian({
    callback({ inputSelector, newValue }): string {
      const input = document.querySelector(inputSelector);
      if (!(input instanceof HTMLInputElement)) {
        throw new TypeError('The picker has no input.');
      }

      const oldValue = input.value;
      input.value = newValue;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return oldValue;
    },
    input: { inputSelector: PROMPT_INPUT_SELECTOR, newValue: value },
    vaultPath: vaultPath()
  });
}

/**
 * Captures the page, captions it, and writes it as
 * `images/screenshots/screenshot-mobile-<index>.png`.
 *
 * @param index - The 1-based listing position.
 * @param caption - The caption drawn across the bottom of the frame.
 */
async function shoot(index: number, caption: string): Promise<void> {
  await writeFrame(index, caption, await captureObsidianScreenshot({ vaultPath: vaultPath() }));
}

/**
 * Raises the soft keyboard on the open suggester, captures the DEVICE
 * framebuffer, captions it, and writes it as
 * `images/screenshots/screenshot-mobile-<index>.png`.
 *
 * The device capture, not the page one: `captureObsidianScreenshot` photographs
 * the WebView, and the IME is a system window that is no part of the page.
 *
 * @param index - The 1-based listing position.
 * @param caption - The caption drawn across the bottom of the frame.
 */
async function shootWithSoftKeyboard(index: number, caption: string): Promise<void> {
  await lowerSoftKeyboard();
  await hideCaret();

  // The touch that raises the IME lands in the middle of the field, and when it
  // Lands inside TEXT Chromium draws a selection handle under the caret, which
  // The framebuffer photographs. So the `Extract` picker's seeded name is taken
  // Out for the touch and put back afterwards (later harness versions do this
  // Themselves; 12.x does not).
  const query = await setPromptInputValue('');

  await raiseSoftKeyboard({
    deviceId,
    inputSelector: PROMPT_INPUT_SELECTOR,
    vaultPath: vaultPath()
  });

  await setPromptInputValue(query);

  // The write-back says nothing about the rows the suggester re-renders off it,
  // And the frame is the painted result, so it waits for the paint.
  await sleepInNode(KEYBOARD_SETTLE_DELAY_IN_MILLISECONDS);

  await writeFrame(index, caption, await captureDeviceScreenshot({ deviceId }));
}

function vaultPath(): string {
  return getTemporaryVault().path;
}

/**
 * Checks a frame's size, captions it, and writes it out.
 *
 * @param index - The 1-based listing position.
 * @param caption - The caption drawn across the bottom of the frame.
 * @param captured - The frame as captured, before its caption.
 */
async function writeFrame(index: number, caption: string, captured: Uint8Array): Promise<void> {
  // The AVD is 900x1600, so the device frame IS the store's size. Asserting it
  // Here is what keeps that true: run this against any other AVD and it fails
  // Loudly instead of quietly shipping an off-spec image.
  expect(readPngDimensions(captured)).toStrictEqual({
    heightInPixels: HEIGHT_IN_PIXELS,
    widthInPixels: WIDTH_IN_PIXELS
  });

  // Captioned AFTER capture, so the frame stays an untouched screenshot and
  // Rewording a label needs no re-shoot.
  const labeled = await labelScreenshot(captured, { text: caption });

  mkdirSync(IMAGES_DIRECTORY, { recursive: true });
  writeFileSync(join(IMAGES_DIRECTORY, `screenshot-mobile-${String(index)}.png`), labeled);
}
