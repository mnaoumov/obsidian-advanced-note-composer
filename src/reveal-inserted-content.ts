/**
 * @file
 *
 * The ONE place that knows how to find the content an operation just wrote into a note, and how to put the
 * user on it.
 *
 * Two flows need exactly this. A smart cut & paste move lands the cursor on the moved text in the freshly
 * opened destination (issue #144), and the destination link of an extract's completion notice lands the user
 * on the extracted text instead of at the top of the note (issue #232). Both start from the same pair
 * {@link ComposerBase} captures at insert time — the exact string written and the offset it went to — and
 * both have to wait for the destination's editor to actually show up before they can apply an offset to it.
 *
 * A third flow shares only that waiting half: a note CREATED from a template opens with its caret where the
 * template's `{{content}}` was (issue #244). It locates nothing, because there is nothing to find — the
 * caret is arithmetic on the note's own end — so it is a sibling of the pair above rather than another
 * caller of them.
 *
 * The locating half is deliberately pure and separately testable: it is where issue #175 was fixed, and
 * "which of the two identical-looking copies is the one we just wrote" is not a question a DOM-coupled poll
 * loop should be answering.
 */

import type {
  App,
  Editor,
  EditorPosition,
  TFile
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';

import { MarkdownView } from 'obsidian';

/**
 * How long to wait between polls for the destination note's editor.
 */
const POLL_INTERVAL_IN_MILLISECONDS = 50;

/**
 * How long to keep polling before giving up on the destination note's editor, when the caller has ALREADY
 * opened it — the smart cut & paste move, which awaits its own `openFileAfterOperation` first. All that is
 * left to wait for there is the editor loading its content, so the budget is short.
 */
const POLL_TIMEOUT_IN_MILLISECONDS = 2000;

/**
 * How long to keep polling when the caller has NOT opened the destination itself and the open is only
 * beginning — clicking a notice's destination link hands the open to Obsidian and returns immediately
 * (issue #232). The budget therefore has to cover the open as well as the editor load; measured against a
 * freshly created note, the 2 s above lost the jump two runs in three.
 */
export const POLL_TIMEOUT_WHILE_OPENING_IN_MILLISECONDS = 10_000;

/**
 * The editor positions the inserted content occupies, with the template's own leading/trailing whitespace
 * already trimmed off.
 */
export interface InsertedContentRange {
  readonly endPos: EditorPosition;
  readonly startPos: EditorPosition;
}

/**
 * The destination's editor together with where the inserted content sits in it.
 */
export interface LocatedInsertedContent {
  readonly editor: Editor;
  readonly range: InsertedContentRange;

  /**
   * The view the editor belongs to, so a caller can put the user back IN it (issue #263) — focusing the
   * editor alone does not make its leaf the active one.
   */
  readonly view: MarkdownView;
}

/**
 * Parameters for {@link placeCaretFromEnd}.
 */
export interface PlaceCaretFromEndParams {
  readonly app: App;

  /**
   * Where the give-up is reported, for the same reason {@link PollForInsertedContentParams} logs its own:
   * "the cursor did not land where the template said" is a bug report, not an acceptable silence.
   */
  readonly consoleDebugComponent: ConsoleDebugComponent;

  /**
   * The note the caret goes into. The active view must be showing THIS file before an offset is applied to
   * it.
   */
  readonly file: TFile;

  /**
   * The text the note ENDS with — everything the template wrote after its `{{content}}` token. The caret
   * goes immediately before it, and its presence at the end of the editor is also what proves the editor
   * has finished loading the note rather than showing an empty buffer.
   */
  readonly tail: string;
}

/**
 * Parameters for {@link pollForInsertedContent}.
 */
export interface PollForInsertedContentParams {
  readonly app: App;

  /**
   * Where the give-up is reported. A silent no-op is exactly the failure a user files as "the cursor did
   * not jump" (issue #175), so it is logged rather than passed over.
   */
  readonly consoleDebugComponent: ConsoleDebugComponent;

  /**
   * The note the content was written into. The active view must be showing THIS file before an offset is
   * applied to it — the open is asynchronous, and applying the offset to whatever note happens to be on
   * screen would select arbitrary text in the wrong file.
   */
  readonly file: TFile;

  /**
   * The exact string the operation wrote ({@link ComposerBase.insertedContent}).
   */
  readonly insertedContent: string;

  /**
   * Where that string went ({@link ComposerBase.insertedContentOffset}), or `null` when the writing route
   * could not name one offset.
   */
  readonly insertedContentOffset: null | number;

  /**
   * How long to keep polling.
   *
   * The default suits a caller that has already opened the destination and is only waiting for its editor
   * to load. A caller that starts the poll while the open is still BEGINNING has to allow for the open
   * itself — clicking a notice link hands the open to Obsidian and returns immediately, and 2 s was not
   * enough for a freshly created note on a busy machine (two runs in three lost the jump).
   *
   * @default `2000`
   */
  readonly timeoutInMilliseconds?: number;
}

/**
 * Parameters for {@link resolveInsertedContentRange}.
 */
export interface ResolveInsertedContentRangeParams {
  readonly editor: Editor;
  readonly insertedContent: string;
  readonly insertedContentOffset: null | number;
}

/**
 * Parameters for {@link resolveInsertedTextStartOffset}.
 */
export interface ResolveInsertedTextStartOffsetParams {
  readonly editorValue: string;
  readonly insertedContent: string;
  readonly insertedContentOffset: null | number;
}

/**
 * Parameters for {@link revealInsertedContent}.
 */
export interface RevealInsertedContentParams extends PollForInsertedContentParams {
  /**
   * Whether the inserted content is left SELECTED, rather than the cursor merely collapsed onto its start.
   *
   * @default `true`
   */
  readonly shouldSelect?: boolean;
}

/**
 * Waits for a created note's editor to show up and puts the caret where its template's `{{content}}` was
 * (issue #244).
 *
 * The caret is placed by measuring BACKWARDS from the end of the note, because that is the only anchor a
 * template can promise: its frontmatter is hoisted out and merged into whatever the note already carried,
 * so everything above `{{content}}` may have moved, while everything below it was written verbatim at the
 * tail. The same tail doubles as the readiness signal — an editor that is up but has not yet loaded the
 * note holds an empty buffer, and applying the arithmetic to that would silently park the caret at the top.
 *
 * @param params - The parameters.
 * @returns A {@link Promise} that resolves once the caret has been placed, or the poll has given up.
 */
/* v8 ignore start -- polls a live Obsidian workspace for a MarkdownView; verified via integration. */
export async function placeCaretFromEnd(params: PlaceCaretFromEndParams): Promise<void> {
  const {
    app,
    consoleDebugComponent,
    file,
    tail
  } = params;

  for (let elapsed = 0; elapsed <= POLL_TIMEOUT_IN_MILLISECONDS; elapsed += POLL_INTERVAL_IN_MILLISECONDS) {
    const view = app.workspace.getActiveViewOfType(MarkdownView);
    if (view?.file?.path === file.path) {
      const { editor } = view;
      const editorValue = editor.getValue();
      // An editor that is up but still loading holds an empty buffer, so the tail being there is what
      // Proves the note itself arrived.
      if (editorValue.length > 0 && editorValue.endsWith(tail)) {
        const position = editor.offsetToPos(editorValue.length - tail.length);
        editor.setCursor(position);
        editor.scrollIntoView({ from: position, to: position }, true);
        return;
      }
    }

    await sleep(POLL_INTERVAL_IN_MILLISECONDS);
  }

  consoleDebugComponent.consoleDebug(
    `Could not place the caret in ${file.path}: its editor never showed up holding the templated content ending with ${JSON.stringify(tail)}.`
  );
}
/* v8 ignore stop */

/**
 * Waits for the destination note's editor to show up and locates the inserted content in it.
 *
 * The editor needs a moment to load its content and apply its own default cursor, so this polls rather than
 * guessing a fixed delay — and it polls for BOTH conditions at once, because an editor that is up but has
 * not yet received the written content is just as unusable as no editor at all.
 *
 * @param params - The parameters.
 * @returns A {@link Promise} resolving to the editor and range, or `null` when the destination never showed
 * up or the content could not be located in it.
 */
/* v8 ignore start -- polls a live Obsidian workspace for a MarkdownView; verified via integration. */
export async function pollForInsertedContent(params: PollForInsertedContentParams): Promise<LocatedInsertedContent | null> {
  const {
    app,
    consoleDebugComponent,
    file,
    insertedContent,
    insertedContentOffset
  } = params;
  const timeoutInMilliseconds = params.timeoutInMilliseconds ?? POLL_TIMEOUT_IN_MILLISECONDS;

  for (let elapsed = 0; elapsed <= timeoutInMilliseconds; elapsed += POLL_INTERVAL_IN_MILLISECONDS) {
    const view = app.workspace.getActiveViewOfType(MarkdownView);
    // A view still loading (no file yet) simply fails the check and is retried on the next poll.
    if (view?.file?.path === file.path) {
      const range = resolveInsertedContentRange({ editor: view.editor, insertedContent, insertedContentOffset });
      if (range) {
        return { editor: view.editor, range, view };
      }
    }

    await sleep(POLL_INTERVAL_IN_MILLISECONDS);
  }

  consoleDebugComponent.consoleDebug(
    `Could not locate the inserted content in ${file.path} to jump to it: ${JSON.stringify(insertedContent)} at offset ${String(insertedContentOffset)}`
  );
  return null;
}
/* v8 ignore stop */

/**
 * Resolves the {@link InsertedContentRange} the inserted content occupies in `editor`, or `null` when it
 * cannot be located there (yet).
 *
 * @param params - The parameters.
 * @returns The range, or `null`.
 */
export function resolveInsertedContentRange(params: ResolveInsertedContentRangeParams): InsertedContentRange | null {
  const { editor, insertedContent, insertedContentOffset } = params;
  const editorValue = editor.getValue();
  const startOffset = resolveInsertedTextStartOffset({ editorValue, insertedContent, insertedContentOffset });
  if (startOffset === null) {
    return null;
  }

  // Clamp to the document, mirroring `computeHighlightRangesForFile`: the editor is read live, so it
  // Can be a revision behind the content the offsets were computed against.
  const endOffset = Math.min(startOffset + insertedContent.trim().length, editorValue.length);
  return {
    endPos: editor.offsetToPos(endOffset),
    startPos: editor.offsetToPos(startOffset)
  };
}

/**
 * Resolves where the inserted TEXT starts in `editorValue` — the template's own leading whitespace already
 * skipped, so the cursor lands on the text rather than on the blank lines wrapping it.
 *
 * Exported for its own sake: this cascade IS the fix for issue #175, and every one of its branches is a
 * case a real note produced.
 *
 * @param params - The parameters.
 * @returns The offset, or `null` when the inserted content cannot be located.
 */
export function resolveInsertedTextStartOffset(params: ResolveInsertedTextStartOffsetParams): null | number {
  const { editorValue, insertedContent, insertedContentOffset } = params;
  const leadingWhitespaceLength = insertedContent.length - insertedContent.trimStart().length;

  // The recorded offset pins the inserted region exactly, so it is the only candidate that cannot pick the
  // Wrong copy (issue #175). Trusted only when the editor really does hold the inserted content there — a
  // Later write (the frontmatter merge) can shift the body under it.
  if (insertedContentOffset !== null && editorValue.startsWith(insertedContent, insertedContentOffset)) {
    return insertedContentOffset + leadingWhitespaceLength;
  }

  // Fallbacks for a shifted body. Both take the FIRST occurrence, so on a note that already contains
  // The same text they can land on the earlier copy — a last resort, never the primary path.
  const index = editorValue.indexOf(insertedContent);
  if (index !== -1) {
    return index + leadingWhitespaceLength;
  }

  const trimmedContent = insertedContent.trim();
  if (trimmedContent === '') {
    // Whitespace-only insert: `indexOf('')` would answer 0 and send the cursor to the top of the note.
    return null;
  }

  const trimmedIndex = editorValue.indexOf(trimmedContent);
  return trimmedIndex === -1 ? null : trimmedIndex;
}

/**
 * Waits for the destination note's editor and puts the user on the inserted content there — scrolled into
 * view, and selected unless a collapsed caret was asked for.
 *
 * A no-op when the destination never showed up or the content could not be located, which
 * {@link pollForInsertedContent} logs.
 *
 * @param params - The parameters.
 * @returns A {@link Promise} that resolves once the content has been revealed, or the poll has given up.
 */
/* v8 ignore start -- drives a live Obsidian editor; verified via integration. */
export async function revealInsertedContent(params: RevealInsertedContentParams): Promise<void> {
  const located = await pollForInsertedContent(params);
  if (!located) {
    return;
  }

  const { editor, range, view } = located;
  if (!(params.shouldSelect ?? true)) {
    editor.setCursor(range.startPos);
    editor.scrollIntoView({ from: range.startPos, to: range.endPos }, true);
    return;
  }

  // NOTE: do NOT follow this with `setEphemeralState({ line })` — that repositions the caret and
  // Collapses the selection.
  editor.setSelection(range.startPos, range.endPos);
  editor.scrollIntoView({ from: range.startPos, to: range.endPos }, true);

  /*
   * Issue #263: put the FOCUS in that editor too, or a repeat click leaves the selection invisible.
   *
   * The selection itself was never the problem — it is re-applied on every click, which a desktop probe
   * confirmed. What differs is where the focus is. The FIRST click opens the note, so the editor takes
   * focus and the selection is drawn. On a repeat click the note is already open and the notice's link
   * only REVEALS it in the file explorer, which ends up the active leaf — the editor keeps a selection
   * nobody can see, and the reporter reads that as "the content is not highlighted any more".
   *
   * Harmless on the paths that do not need it: the smart cut & paste move already has the user in this
   * editor, so this is what is already true there.
   *
   * TWO things had to be right, and each was found by probing rather than by reading:
   * - `setActiveLeaf`, not `editor.focus()`. Focusing the editor does not make its leaf the ACTIVE one,
   *   so the workspace still answers the file explorer and the highlight still is not what the user is
   *   looking at.
   * - DEFERRED by a tick. Obsidian's own reveal lands after this handler, so an immediate activation is
   *   simply overwritten — the same ordering as the picker's focus in issue #262.
   */
  await sleep(POLL_INTERVAL_IN_MILLISECONDS);
  params.app.workspace.setActiveLeaf(view.leaf, { focus: true });
}
/* v8 ignore stop */
