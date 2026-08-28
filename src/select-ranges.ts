/**
 * @file
 *
 * The range logic the `Select ...` commands need and no other command already owns (issue #266).
 *
 * The five per-shape select commands reuse the finders the matching `Extract ...` commands compute their
 * ranges with — `getEnclosingHeadingLine` / `getSelectionUnderHeading` (`composers/composer-base.ts`) and
 * `getSelectionBetweenHorizontalRules` (`horizontal-rules.ts`) — because a select IS an extract's opening
 * `editor.setSelection` with the split tail cut off. Only the two helpers here are new, and both are pure
 * so they can be unit-tested without a CodeMirror editor.
 */

import type { HeadingInfo } from '@obsidian-typings/obsidian-public-latest/implementations';
import type {
  App,
  Editor,
  EditorPosition,
  TFile
} from 'obsidian';

import {
  getEnclosingHeadingLine,
  getSelectionUnderHeading
} from './composers/composer-base.ts';

/**
 * Parameters for {@link getHeadingContentSelection}.
 */
export interface GetHeadingContentSelectionParams {
  /**
   * The editor the heading lives in, read to tell a body of blank lines from a real one.
   */
  readonly editor: Editor;

  /**
   * The heading's own range, as {@link getSelectionUnderHeading} returns it — the `#` line included.
   */
  readonly headingInfo: HeadingInfo;
}

/**
 * A `[fromOffset, toOffset]` pair, ordered.
 */
export interface NormalizedSelectionRange {
  readonly fromOffset: number;
  readonly toOffset: number;
}

/**
 * Parameters for {@link resolveEnclosingHeadingInfo}.
 */
export interface ResolveEnclosingHeadingInfoParams {
  readonly app: App;
  readonly editor: Editor;
  readonly file: TFile;
}

/**
 * An editor range, in the `{ start, end }` shape `Editor.setSelection` takes.
 */
export interface SelectionRange {
  readonly end: EditorPosition;
  readonly start: EditorPosition;
}

/**
 * The heading's section WITHOUT its `#` line — the `Select this heading's content` command, the one
 * variant of the reporter's list that had no counterpart anywhere in the plugin (issue #266).
 *
 * Derived from the full heading range rather than found separately, so the two commands can never disagree
 * about where a section ends: the start simply moves to the line below the heading.
 *
 * Returns `null` when there is nothing to select, which is what keeps the command out of the palette on a
 * heading with no body. BOTH ways that happens are checked, because `getSelectionUnderHeading` reports
 * them differently: a heading followed by another one collapses to a single line (its `end` is walked back
 * over the blank lines between them), while the LAST heading of a note keeps the document's final line as
 * its `end` even when everything below it is blank.
 *
 * @param params - The parameters.
 * @returns The content range, or `null` when the heading has no non-blank body.
 */
export function getHeadingContentSelection(params: GetHeadingContentSelectionParams): null | SelectionRange {
  const { editor, headingInfo } = params;
  const start: EditorPosition = {
    ch: 0,
    line: headingInfo.start.line + 1
  };
  if (start.line > headingInfo.end.line) {
    return null;
  }

  const end = headingInfo.end;
  if (!editor.getRange(start, end).trim()) {
    return null;
  }

  return { end, start };
}

/**
 * Orders an anchor and a cursor offset into a `from`/`to` pair (issue #266).
 *
 * `Selection anchor: End selection` must work in both directions: anchoring a point and then moving the
 * caret BACKWARDS is as reasonable as moving it forwards, and on a phone — where placing a caret by tap is
 * the reliable gesture and dragging a handle is not — it is the ordinary case rather than an edge one.
 *
 * @param anchorOffset - The anchored offset.
 * @param cursorOffset - The cursor's offset.
 * @returns The two offsets, lower first.
 */
export function normalizeSelectionRange(anchorOffset: number, cursorOffset: number): NormalizedSelectionRange {
  if (anchorOffset <= cursorOffset) {
    return {
      fromOffset: anchorOffset,
      toOffset: cursorOffset
    };
  }

  return {
    fromOffset: cursorOffset,
    toOffset: anchorOffset
  };
}

/**
 * The range of the heading ENCLOSING the cursor — its `#` line, its body, and everything nested under it.
 *
 * The two heading select commands (`Select this heading` and `Select this heading's content`) both start
 * here, so they can never disagree about which heading the cursor is in or where its section ends. It is
 * the same two-step lookup `Extract this heading...` performs, which is what makes the selection the two
 * commands produce identical to the one the extract makes before opening its modal.
 *
 * Enclosing rather than on-the-line, so it works from anywhere inside the section (issue #143), not only
 * with the cursor parked on the `#`.
 *
 * @param params - The parameters.
 * @returns The heading's range, or `null` when the cursor is not under a heading.
 */
export function resolveEnclosingHeadingInfo(params: ResolveEnclosingHeadingInfoParams): HeadingInfo | null {
  const { app, editor, file } = params;
  const headingLine = getEnclosingHeadingLine({
    app,
    cursorLine: editor.getCursor().line,
    file
  });
  if (headingLine === null) {
    return null;
  }

  return getSelectionUnderHeading({
    app,
    editor,
    file,
    lineNumber: headingLine
  });
}
