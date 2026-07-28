/**
 * Parameters for {@link buildFolderHeadingPlan}.
 */
export interface BuildFolderHeadingPlanParams {
  /**
   * The paths of the notes about to be merged, in the order they will be merged. They must already be in
   * folder-grouped depth-first order (a folder's own notes contiguous, then each sub-folder's subtree) —
   * otherwise a folder would be re-entered and its heading emitted more than once.
   */
  readonly filePaths: readonly string[];

  /**
   * The path of the folder being merged. Depth is measured below this.
   */
  readonly rootPath: string;
}

/**
 * What to emit into the merged note immediately before one source note.
 */
export interface FolderHeadingPlanEntry {
  /**
   * How many folders below the merged folder the note lives (`0` for a note directly inside it). This is
   * both the heading level its folder got and the number of levels the note's own headings are demoted
   * by, which is what keeps the merged outline well-formed.
   */
  readonly depth: number;

  /**
   * The note's path, as given in {@link BuildFolderHeadingPlanParams.filePaths}.
   */
  readonly filePath: string;

  /**
   * The heading lines to emit before this note — one per folder entered since the previous note, in
   * outer-to-inner order. Empty when the note lives in the same folder as the previous one.
   */
  readonly headings: readonly string[];
}

/**
 * The fence currently held open while scanning content, so its contents are left untouched.
 */
interface OpenFence {
  /**
   * The fence character (a backtick or a tilde).
   */
  readonly character: string;

  /**
   * How many times it was repeated. A closing fence must repeat it at least as many times.
   */
  readonly length: number;
}

/*
 * Deliberately `#+` rather than markdown's `#{1,6}`: {@link buildFolderHeadingPlan} emits more than six
 * hashes for a folder deeper than six levels, so a merged note carries such lines, and re-merging that
 * note has to demote them along with everything else — reading back exactly what we write is what keeps
 * the relative outline order intact across a second pass. The cost is that a note which merely *contains*
 * a literal `####### text` line (not a heading, as far as Obsidian is concerned) has it demoted too.
 */
const ATX_HEADING_REG_EXP = /^(?<Indent> {0,3})(?<Hashes>#+)(?<Rest>\s.*|)$/;
const FENCE_REG_EXP = /^ {0,3}(?<Fence>`{3,}|~{3,})/;

/**
 * Plans the folder-derived headings for a folder merge (issue #160): each sub-folder becomes a heading in
 * the merged note, at a level equal to its depth below the merged folder — a direct sub-folder gets `#`,
 * its child `##`, and so on. Notes directly inside the merged folder get no heading, because the merged
 * note itself already stands for that folder.
 *
 * This is the exact inverse of the recursive split (issue #156), where `# A` produces the folder `A` and
 * `## B` inside it produces `A/B` — so a note split into a tree and merged back agrees on the levels.
 *
 * A heading is emitted only for a folder that was not already open at the previous note, so a folder
 * holding several notes is headed once.
 *
 * **Past six levels the level keeps growing** — a folder seven deep gets `#######`, which markdown does
 * not define and Obsidian renders as literal text rather than a heading. That is the deliberate choice
 * (issue #160, the reporter's own first suggestion), because the alternative — clamping at six — is
 * strictly worse: it made every folder from depth 6 downward share `######`, so an ancestor and its own
 * descendants became indistinguishable siblings, and it collided with the note's own outline, which
 * {@link demoteHeadings} clamped onto that same level. Encoding the depth honestly loses the outline
 * entry for those folders but never loses the hierarchy. Nothing else in the plugin caps to
 * `MAX_HEADING_LEVEL` in this direction; the recursive split still does, since it *reads* real headings.
 *
 * @param params - The notes to be merged and the folder they are merged from.
 * @returns One entry per input path, in the same order.
 */
export function buildFolderHeadingPlan(params: BuildFolderHeadingPlanParams): FolderHeadingPlanEntry[] {
  const { filePaths, rootPath } = params;
  const entries: FolderHeadingPlanEntry[] = [];
  let previousSegments: string[] = [];

  for (const filePath of filePaths) {
    const segments = getFolderSegmentsBelowRoot(filePath, rootPath);
    const headings: string[] = [];
    let commonCount = 0;
    while (
      commonCount < segments.length
      && commonCount < previousSegments.length
      && segments[commonCount] === previousSegments[commonCount]
    ) {
      commonCount++;
    }

    for (let index = commonCount; index < segments.length; index++) {
      /* v8 ignore next -- defensive ?? on an index the loop bounds keep inside the array. */
      headings.push(`${'#'.repeat(index + 1)} ${segments[index] ?? ''}`);
    }

    previousSegments = segments;
    entries.push({ depth: segments.length, filePath, headings });
  }

  return entries;
}

/**
 * Demotes every ATX heading in the content by `shift` levels, so a merged note's own outline nests under
 * the heading its folder became instead of competing with it. Headings inside fenced code blocks are left
 * alone — a `# comment` line in a shell snippet is not a heading.
 *
 * **Not capped at {@link MAX_HEADING_LEVEL}**, matching {@link buildFolderHeadingPlan}: a note six folders
 * deep is shifted by six, so its own `#` becomes `#######`. Clamping instead put the note's top heading at
 * the very level its folder heading already occupied, making the note's outline a sibling of its own
 * folder — and that started at depth six, inside the range markdown does support. Growing past six keeps
 * the nesting truthful at the cost of those lines rendering as literal text.
 *
 * @param content - The note content to demote.
 * @param shift - How many levels to demote by. `0` or less returns the content untouched.
 * @returns The content with its headings demoted.
 */
export function demoteHeadings(content: string, shift: number): string {
  if (shift <= 0) {
    return content;
  }

  let openFence: null | OpenFence = null;

  return content.split('\n').map((line) => {
    const fence = FENCE_REG_EXP.exec(line)?.groups?.['Fence'];

    if (openFence !== null) {
      // A fence closes only on the same character, repeated at least as many times as it was opened.
      if (fence !== undefined && fence.startsWith(openFence.character) && fence.length >= openFence.length) {
        openFence = null;
      }
      return line;
    }

    if (fence !== undefined) {
      openFence = { character: fence.charAt(0), length: fence.length };
      return line;
    }

    const groups = ATX_HEADING_REG_EXP.exec(line)?.groups;
    if (!groups) {
      return line;
    }

    /* v8 ignore start -- defensive optional access on always-present named regex groups. */
    const indent = groups['Indent'] ?? '';
    const hashes = groups['Hashes'] ?? '';
    const rest = groups['Rest'] ?? '';
    /* v8 ignore stop */
    return `${indent}${'#'.repeat(hashes.length + shift)}${rest}`;
  }).join('\n');
}

function getFolderSegmentsBelowRoot(filePath: string, rootPath: string): string[] {
  const relativePath = filePath.startsWith(`${rootPath}/`) ? filePath.slice(rootPath.length + 1) : filePath;
  // Drop the file name: only the folders between the merged folder and the note become headings.
  return relativePath.split('/').slice(0, -1);
}
