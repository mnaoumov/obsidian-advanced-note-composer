import type {
  Editor,
  HeadingCache
} from 'obsidian';

import type { Level } from './markdown-heading-document.ts';

/**
 * Parameters for {@link doesSelectionIntersectHeadingOfLevel}.
 */
export interface DoesSelectionIntersectHeadingOfLevelParams {
  /**
   * The note's headings, in document order (from `metadataCache`).
   */
  readonly headings: readonly HeadingCache[];

  /**
   * The heading level to test for.
   */
  readonly level: Level;

  /**
   * The last (inclusive) line of the current editor selection/cursor.
   */
  readonly selectionEndLine: number;

  /**
   * The first (inclusive) line of the current editor selection/cursor.
   */
  readonly selectionStartLine: number;
}

/**
 * Checks whether the current selection/cursor range intersects the section governed by at least one
 * heading of the given level. A heading's section spans from its own line until the line before the
 * next heading of an equal-or-higher level (or the end of the note when there is none), so a cursor
 * nested anywhere under a heading of that level counts as intersecting it.
 *
 * @param params - The parameters.
 * @returns Whether the selection intersects a heading of the given level.
 */
export function doesSelectionIntersectHeadingOfLevel(params: DoesSelectionIntersectHeadingOfLevelParams): boolean {
  const {
    headings,
    level,
    selectionEndLine,
    selectionStartLine
  } = params;
  return headings.some((heading, index) => {
    if (heading.level !== level) {
      return false;
    }
    const sectionStartLine = heading.position.start.line;
    const nextBoundaryHeading = headings.slice(index + 1).find((candidate) => candidate.level <= level);
    const sectionEndLine = nextBoundaryHeading ? nextBoundaryHeading.position.start.line - 1 : Number.POSITIVE_INFINITY;
    return sectionStartLine <= selectionEndLine && sectionEndLine >= selectionStartLine;
  });
}

export function extractHeading(editor: Editor): string {
  const selectedLines = editor.getSelection().split('\n');
  /* v8 ignore start -- split('\n') always returns at least one element. */
  if (selectedLines.length > 0) {
    /* v8 ignore stop */
    /* v8 ignore start -- selectedLines[0] is always defined when length > 0. */
    const extractedHeading = extractHeadingFromLine(selectedLines[0] ?? '');
    /* v8 ignore stop */
    return extractedHeading ?? '';
  }

  /* v8 ignore start -- unreachable dead code after split('\n'). */
  return '';
  /* v8 ignore stop */
}

function extractHeadingFromLine(line: string): null | string {
  const match = /^#{1,6} (?<Heading>.*)/m.exec(line);
  return match?.groups?.['Heading'] ?? null;
}
