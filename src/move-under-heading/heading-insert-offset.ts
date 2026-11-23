import type { HeadingCache } from 'obsidian';

import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';

import { InsertMode } from '../composers/insert-mode.ts';

/**
 * The inputs of {@link resolveHeadingInsertOffset}.
 */
export interface ResolveHeadingInsertOffsetParams {
  /**
   * The target note's content.
   */
  readonly content: string;

  /**
   * The index of the chosen heading in {@link headings}.
   */
  readonly headingIndex: number;

  /**
   * The target note's headings, in document order, as the metadata cache reports them for {@link content}.
   */
  readonly headings: readonly HeadingCache[];

  /**
   * `Prepend` puts the content right under the heading line, `Append` at the end of the heading's own body.
   */
  readonly insertMode: InsertMode;
}

/**
 * Resolves where content moved under a heading is inserted.
 *
 * The heading's section here is its OWN body: the text between its line and the next heading of ANY level,
 * the same bound `Text Mover` uses. Ending it at the next heading of the same or a higher level instead would
 * put appended content under the heading's last sub-heading, which is not the heading that was chosen.
 *
 * `Prepend` inserts at the end of the heading line, so the content lands directly under the heading. `Append`
 * inserts after the last non-blank character of the body, so the blank lines that separate the body from the
 * next heading stay below the inserted content. An empty body makes both the end of the heading line.
 *
 * @param params - The parameters.
 * @returns The offset in {@link ResolveHeadingInsertOffsetParams.content}.
 */
export function resolveHeadingInsertOffset(params: ResolveHeadingInsertOffsetParams): number {
  const { content, headingIndex, headings, insertMode } = params;
  const heading = ensureNonNullable(headings[headingIndex]);
  const headingLineEnd = heading.position.end.offset;
  if (insertMode === InsertMode.Prepend) {
    return headingLineEnd;
  }

  const sectionEnd = headings[headingIndex + 1]?.position.start.offset ?? content.length;
  return headingLineEnd + content.slice(headingLineEnd, sectionEnd).trimEnd().length;
}
