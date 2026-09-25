import type { HeadingCache } from 'obsidian';

interface HeadingTreeStackEntry {
  readonly level: number;
  readonly node: HeadingTreeNode;
}

const MINIMUM_MOVABLE_HEADING_COUNT = 2;

/**
 * The deepest heading level markdown defines.
 */
export const MAX_REORDERED_HEADING_LEVEL = 6;

const ATX_HEADING_PREFIX_REG_EXP = /^ {0,3}#{1,6}(?=\s|$)/;
const SETEXT_HEADING_REG_EXP = /^[^\n]*\n {0,3}(?:=+|-+)[ \t]*(?=\r?\n|$)/;

/**
 * A single row of the flattened, indented heading list shown in the reorder modal.
 */
export interface FlatHeadingRow {
  /**
   * Whether the row has a same-parent sibling below it (so it can move down).
   */
  readonly canMoveDown: boolean;

  /**
   * Whether the row has a same-parent sibling above it (so it can move up).
   */
  readonly canMoveUp: boolean;

  /**
   * The nesting depth (0 for the shallowest siblings), used to indent the row.
   */
  readonly depth: number;

  /**
   * The index into {@link SplitReorderableSectionsResult.sections}.
   */
  readonly index: number;

  /**
   * The heading section this row represents.
   */
  readonly section: HeadingSection;
}

/**
 * A reorderable heading section of a note: its heading text/level plus the slice of note content it owns
 * directly — the heading line and its body up to the very next heading of any level (its nested
 * subheadings are separate sections, kept as its {@link HeadingTreeNode} children).
 */
export interface HeadingSection {
  /**
   * The heading text (without the leading `#`s).
   */
  readonly headingText: string;

  /**
   * The heading level (number of leading `#`s).
   */
  readonly level: number;

  /**
   * The own section content: the heading line and its body up to the next heading of any level.
   */
  readonly text: string;
}

/**
 * A node in the note's heading tree, referencing its {@link HeadingSection} by index and holding its
 * nested-heading children. The `children` array is mutable so the modal can reorder same-parent siblings
 * in place.
 */
export interface HeadingTreeNode {
  /**
   * The nested-heading children, in document order (mutable — reordered in place).
   */
  readonly children: HeadingTreeNode[];

  /**
   * The index into {@link SplitReorderableSectionsResult.sections}.
   */
  readonly index: number;
}

/**
 * The result of splitting a note into a fixed preamble, its flat list of heading sections, and the
 * heading tree that nests them.
 */
export interface SplitReorderableSectionsResult {
  /**
   * The level each section's heading WILL have, indexed like {@link SplitReorderableSectionsResult.sections}
   * (mutable — a move under another parent re-levels the moved subtree in place, issue #295). Starts as each
   * section's own level; {@link joinReorderedSections} rewrites every heading line whose entry differs.
   */
  readonly levels: number[];

  /**
   * The content before the first heading, kept in place (never reordered).
   */
  readonly preamble: string;

  /**
   * The heading tree roots, in document order (mutable — reordered in place).
   */
  readonly roots: HeadingTreeNode[];

  /**
   * The flat heading sections, in document order (indexed by {@link HeadingTreeNode.index}).
   */
  readonly sections: HeadingSection[];
}

/**
 * Flattens the heading tree into indented rows in document (depth-first) order, annotating each row with
 * its depth and whether it can move up/down among its same-parent siblings.
 *
 * @param split - The split note (preamble + sections + tree).
 * @returns The flattened rows, in document order.
 */
export function flattenHeadingTree(split: SplitReorderableSectionsResult): FlatHeadingRow[] {
  const rows: FlatHeadingRow[] = [];
  visit(split.roots, 0);
  return rows;

  function visit(nodes: readonly HeadingTreeNode[], depth: number): void {
    for (const [position, node] of nodes.entries()) {
      const section = split.sections[node.index];
      if (!section) {
        continue;
      }
      rows.push({
        canMoveDown: position < nodes.length - 1,
        canMoveUp: position > 0,
        depth,
        index: node.index,
        section
      });
      visit(node.children, depth + 1);
    }
  }
}

/**
 * Produces the depth-first pre-order of section indices for the (possibly reordered) tree. Because a
 * sibling swap moves a whole subtree as one contiguous block, this order is always a valid permutation to
 * feed {@link joinReorderedSections}.
 *
 * @param roots - The tree roots.
 * @returns The section indices in depth-first pre-order.
 */
export function flattenTreeToOrder(roots: readonly HeadingTreeNode[]): number[] {
  const order: number[] = [];
  visit(roots);
  return order;

  function visit(nodes: readonly HeadingTreeNode[]): void {
    for (const node of nodes) {
      order.push(node.index);
      visit(node.children);
    }
  }
}

/**
 * Whether the note has anything `Reorder headings` could move. Since issue #295 a heading can move under a
 * different parent, so any two headings are enough: siblings can be swapped, and a lone child can be lifted
 * out of its parent.
 *
 * @param headings - The note's heading cache entries.
 * @returns `true` when the note has at least two headings.
 */
export function hasMovableHeadings(headings: readonly HeadingCache[]): boolean {
  return headings.length >= MINIMUM_MOVABLE_HEADING_COUNT;
}

/**
 * Rebuilds a note's content from a reordered permutation of its heading sections. The preamble stays
 * first; the sections are emitted in `order`, each trimmed of trailing whitespace and separated by a
 * single blank line (inter-section spacing is normalized), with a trailing newline. Because each moved
 * section keeps its descendants adjacent (they are emitted right after it in `order`), nesting is
 * preserved. A section whose entry in {@link SplitReorderableSectionsResult.levels} differs from its own
 * level has its heading line rewritten to that level. Any out-of-range index in `order` is skipped
 * defensively.
 *
 * @param split - The split note (preamble + sections).
 * @param order - A permutation of section indices giving the new order.
 * @returns The rebuilt note content.
 */
export function joinReorderedSections(split: SplitReorderableSectionsResult, order: readonly number[]): string {
  const parts: string[] = [];
  const preamble = split.preamble.trimEnd();
  if (preamble !== '') {
    parts.push(preamble);
  }
  for (const index of order) {
    const section = split.sections[index];
    if (!section) {
      continue;
    }
    const level = split.levels[index] ?? section.level;
    const text = level === section.level ? section.text : relevelHeadingText(section.text, level);
    parts.push(text.trimEnd());
  }
  return `${parts.join('\n\n')}\n`;
}

/**
 * Rewrites the heading that opens a section's text to the given level. An ATX heading keeps everything but
 * its `#` run; a setext heading (`Text` underlined by `===` / `---`) is rewritten as ATX, since setext has
 * only two levels. Text that opens with neither is returned unchanged.
 *
 * @param text - The section text, starting at its heading.
 * @param level - The new level.
 * @returns The section text with its heading re-leveled.
 */
export function relevelHeadingText(text: string, level: number): string {
  const hashes = '#'.repeat(level);
  const atxMatch = ATX_HEADING_PREFIX_REG_EXP.exec(text);
  if (atxMatch) {
    // The match is the indentation followed by the `#` run, so dropping the `#`s leaves the indentation.
    return `${atxMatch[0].replaceAll('#', '')}${hashes}${text.slice(atxMatch[0].length)}`;
  }

  const setextMatch = SETEXT_HEADING_REG_EXP.exec(text);
  if (!setextMatch) {
    return text;
  }

  const headingText = text.slice(0, text.indexOf('\n')).trim();
  return `${hashes} ${headingText}${text.slice(setextMatch[0].length)}`;
}

/**
 * Splits a note into its fixed preamble, its flat heading sections, and the heading tree nesting them.
 * Each section owns the slice from its heading to the next heading of any level, so nested subheadings
 * are separate sections held as children of their parent node.
 *
 * @param content - The full note content.
 * @param headings - The note's heading cache entries.
 * @returns The preamble, sections, and tree.
 */
export function splitIntoReorderableSections(content: string, headings: readonly HeadingCache[]): SplitReorderableSectionsResult {
  const first = headings[0];
  if (!first) {
    return { levels: [], preamble: content, roots: [], sections: [] };
  }
  const sections: HeadingSection[] = headings.map((heading, index) => {
    const start = heading.position.start.offset;
    const nextHeading = headings[index + 1];
    const end = nextHeading ? nextHeading.position.start.offset : content.length;
    return {
      headingText: heading.heading,
      level: heading.level,
      text: content.slice(start, end)
    };
  });
  const preamble = content.slice(0, first.position.start.offset);
  return { levels: sections.map((section) => section.level), preamble, roots: buildTree(headings), sections };
}

function buildTree(headings: readonly HeadingCache[]): HeadingTreeNode[] {
  const roots: HeadingTreeNode[] = [];
  const stack: HeadingTreeStackEntry[] = [];
  for (const [index, heading] of headings.entries()) {
    const node: HeadingTreeNode = { children: [], index };
    let top = stack.at(-1);
    while (top && top.level >= heading.level) {
      stack.pop();
      top = stack.at(-1);
    }
    const parent = top;
    if (parent) {
      parent.node.children.push(node);
    } else {
      roots.push(node);
    }
    stack.push({ level: heading.level, node });
  }
  return roots;
}
