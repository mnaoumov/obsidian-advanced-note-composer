import type { HeadingCache } from 'obsidian';

import {
  flattenHeadingTree,
  splitIntoReorderableSections
} from './heading-sections.ts';

/**
 * The deepest heading level markdown supports (`######`). A heading of this level can have no
 * sub-headings, so the recursive split never descends past it.
 */
export const MAX_HEADING_LEVEL = 6;

/**
 * One line of the preview shown in the recursive split's confirmation dialog: the heading that becomes a
 * note, and how deeply it will be nested.
 */
export interface RecursiveSplitPreviewRow {
  /**
   * The nesting depth of the note that will be created (0 for the shallowest headings).
   */
  readonly depth: number;

  /**
   * The heading text, which is also the name of the note and of the folder holding it.
   */
  readonly headingText: string;
}

/**
 * Builds the list of notes a recursive split will create, in document order, each annotated with the depth
 * it will be nested at. Reuses the note's heading tree, so a skipped level (an `H1` whose only
 * sub-headings are `H3`s) is shown at the depth it will actually get, not at its heading level.
 *
 * @param content - The full note content.
 * @param headings - The note's headings, in document order (from `metadataCache`).
 * @returns The preview rows, in document order.
 */
export function buildRecursiveSplitPreviewRows(content: string, headings: readonly HeadingCache[]): RecursiveSplitPreviewRow[] {
  const split = splitIntoReorderableSections(content, headings);
  return flattenHeadingTree(split).map((row) => ({
    depth: row.depth,
    headingText: row.section.headingText
  }));
}

/**
 * Finds the heading a recursive split should extract next: among the headings at or below `minLevel`
 * (that is, `level >= minLevel`), the first one at the shallowest such level.
 *
 * Choosing the shallowest level present rather than a fixed one keeps the produced tree faithful when
 * levels are skipped (an `H1` whose only sub-headings are `H3`s) or used out of order, and returning the
 * first heading at that level lets the caller loop: each extraction takes that heading and its whole
 * subtree out of the note, so the next call returns the next sibling.
 *
 * `minLevel` is what stops the recursion from eating itself. An extracted note still begins with the
 * heading it was named after, so recursing into it with `minLevel` left at 1 would extract the note's
 * entire content into a nested copy of itself, forever. Callers pass the parent heading's level plus one.
 *
 * @param headings - The note's headings, in document order (from `metadataCache`).
 * @param minLevel - The shallowest heading level that may be extracted (inclusive).
 * @returns The heading to extract next, or `null` when the note has no heading at or below `minLevel`.
 */
export function findNextHeadingToSplit(headings: readonly HeadingCache[], minLevel: number): HeadingCache | null {
  const candidates = headings.filter((heading) => heading.level >= minLevel);
  const shallowestLevel = Math.min(...candidates.map((heading) => heading.level));
  return candidates.find((heading) => heading.level === shallowestLevel) ?? null;
}
