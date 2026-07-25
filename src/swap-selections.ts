/**
 * Parameters for {@link swapContents}.
 */
export interface SwapContentsParams {
  /**
   * The full content of the source note.
   */
  readonly sourceContent: string;

  /**
   * The range in the source note to swap.
   */
  readonly sourceRegion: SwapRegion;

  /**
   * The full content of the target note.
   */
  readonly targetContent: string;

  /**
   * The range in the target note to swap.
   */
  readonly targetRegion: SwapRegion;
}

/**
 * The two rewritten note contents produced by {@link swapContents}.
 */
export interface SwapContentsResult {
  /**
   * The source note content with its region replaced by the target region's text.
   */
  readonly newSourceContent: string;

  /**
   * The target note content with its region replaced by the source region's text.
   */
  readonly newTargetContent: string;
}

/**
 * A half-open `[startOffset, endOffset)` character range within a note's content.
 */
export interface SwapRegion {
  /**
   * The exclusive end offset of the range.
   */
  readonly endOffset: number;

  /**
   * The inclusive start offset of the range.
   */
  readonly startOffset: number;
}

/**
 * Parameters for {@link swapSameFileContent}.
 */
export interface SwapSameFileContentParams {
  /**
   * The full content of the note whose two regions are exchanged.
   */
  readonly content: string;

  /**
   * The first region to swap.
   */
  readonly regionA: SwapRegion;

  /**
   * The second region to swap.
   */
  readonly regionB: SwapRegion;
}

/**
 * Checks whether two regions overlap (share at least one character). Adjacent regions (one ending
 * exactly where the other begins) do NOT overlap.
 *
 * @param a - The first region.
 * @param b - The second region.
 * @returns Whether the regions overlap.
 */
export function doRegionsOverlap(a: SwapRegion, b: SwapRegion): boolean {
  return a.startOffset < b.endOffset && b.startOffset < a.endOffset;
}

/**
 * Exchanges the text of two regions living in two DIFFERENT notes: the source region's text is written
 * into the target note in place of the target region, and vice versa. Length differences are handled
 * because each note is rewritten independently.
 *
 * @param params - The two note contents and their regions.
 * @returns The two rewritten note contents.
 */
export function swapContents(params: SwapContentsParams): SwapContentsResult {
  const sourceText = sliceRegion(params.sourceContent, params.sourceRegion);
  const targetText = sliceRegion(params.targetContent, params.targetRegion);
  return {
    newSourceContent: replaceRegion(params.sourceContent, params.sourceRegion, targetText),
    newTargetContent: replaceRegion(params.targetContent, params.targetRegion, sourceText)
  };
}

/**
 * Exchanges the text of two NON-overlapping regions inside a single note. The later region is rewritten
 * first so the earlier region's offsets stay valid regardless of any length difference between the two.
 *
 * @param params - The note content and the two regions.
 * @returns The rewritten note content.
 */
export function swapSameFileContent(params: SwapSameFileContentParams): string {
  const [first, second] = params.regionA.startOffset <= params.regionB.startOffset
    ? [params.regionA, params.regionB]
    : [params.regionB, params.regionA];
  const firstText = sliceRegion(params.content, first);
  const secondText = sliceRegion(params.content, second);
  const afterSecond = replaceRegion(params.content, second, firstText);
  return replaceRegion(afterSecond, first, secondText);
}

function replaceRegion(content: string, region: SwapRegion, replacement: string): string {
  return content.slice(0, region.startOffset) + replacement + content.slice(region.endOffset);
}

function sliceRegion(content: string, region: SwapRegion): string {
  return content.slice(region.startOffset, region.endOffset);
}
