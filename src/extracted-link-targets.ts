import type {
  CachedMetadata,
  Pos
} from 'obsidian';

import { resolveSubpath } from 'obsidian';

/**
 * Parameters for {@link buildExtractedSubpathPredicate}.
 */
export interface BuildExtractedSubpathPredicateParams {
  /**
   * The source note's metadata, read BEFORE anything is taken out of it: a subpath is resolved against the
   * headings and blocks the note held when the ranges were captured.
   */
  readonly cache: CachedMetadata | null;

  /**
   * Whether the operation moves the WHOLE note, so a link to the note itself (no subpath) moves with it. A
   * merge does; a split leaves the note behind, so a plain link to it keeps pointing at what is left.
   */
  readonly isWholeNoteMoved: boolean;

  /**
   * The ranges the operation takes out of the source note.
   */
  readonly ranges: readonly ExtractedRange[];
}

/**
 * A range of the source note, in character offsets, that an operation takes out of it.
 */
export interface ExtractedRange {
  readonly endOffset: number;
  readonly startOffset: number;
}

/**
 * Builds the ONE answer to "does a link to this subpath of the source note follow the extracted content"
 * (issue #291).
 *
 * A heading or block link resolves through Obsidian's own `resolveSubpath`, which is what makes `#A b`
 * match a heading written `A: b` the way the app itself matches it — an exact `#${heading}` string compare
 * would silently leave every such link behind. The heading or block counts as extracted when its whole
 * position lies inside one of the ranges, the same containment rule a split applies to footnotes.
 *
 * @param params - The parameters.
 * @returns The predicate, taking a subpath with its leading `#` (or `''` for none).
 */
export function buildExtractedSubpathPredicate(params: BuildExtractedSubpathPredicateParams): (subpath: string) => boolean {
  const { cache, isWholeNoteMoved, ranges } = params;
  return (subpath: string): boolean => {
    if (subpath === '') {
      return isWholeNoteMoved;
    }

    if (!cache) {
      return false;
    }

    const result = resolveSubpath(cache, subpath);
    switch (result?.type) {
      case 'block': {
        return isInsideRanges(result.block.position, ranges);
      }
      case 'heading': {
        return isInsideRanges(result.current.position, ranges);
      }
      default: {
        return false;
      }
    }
  };
}

function isInsideRanges(position: Pos, ranges: readonly ExtractedRange[]): boolean {
  return ranges.some((range) => range.startOffset <= position.start.offset && position.end.offset <= range.endOffset);
}
