import type { HeadingCache } from 'obsidian';

interface HeadingTreeStackEntry {
  readonly level: number;
  readonly node: HeadingTreeNode;
}

const MINIMUM_SIBLING_GROUP_SIZE = 2;

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
    nodes.forEach((node, position) => {
      const section = split.sections[node.index];
      if (!section) {
        return;
      }
      rows.push({
        canMoveDown: position < nodes.length - 1,
        canMoveUp: position > 0,
        depth,
        index: node.index,
        section
      });
      visit(node.children, depth + 1);
    });
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
 * Whether the note has at least one group of two or more same-parent sibling headings that could be
 * reordered (top-level siblings or nested siblings at any level).
 *
 * @param headings - The note's heading cache entries.
 * @returns `true` when there is a reorderable sibling group.
 */
export function hasReorderableSiblings(headings: readonly HeadingCache[]): boolean {
  return hasSiblingGroup(buildTree(headings));
}

/**
 * Rebuilds a note's content from a reordered permutation of its heading sections. The preamble stays
 * first; the sections are emitted in `order`, each trimmed of trailing whitespace and separated by a
 * single blank line (inter-section spacing is normalized), with a trailing newline. Because each moved
 * section keeps its descendants adjacent (they are emitted right after it in `order`), nesting is
 * preserved. Any out-of-range index in `order` is skipped defensively.
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
    if (section) {
      parts.push(section.text.trimEnd());
    }
  }
  return `${parts.join('\n\n')}\n`;
}

/**
 * Swaps the tree node with the given section index with its same-parent sibling `delta` places away,
 * mutating the tree in place. Only same-parent siblings are ever exchanged, so each moved section keeps
 * its descendants.
 *
 * @param roots - The tree roots.
 * @param index - The section index of the node to move.
 * @param delta - The signed sibling offset (`-1` up, `+1` down).
 * @returns `true` when the node was moved, `false` when the move was out of range or the node was not found.
 */
export function moveSibling(roots: HeadingTreeNode[], index: number, delta: number): boolean {
  const siblings = findSiblingList(roots, index);
  if (!siblings) {
    return false;
  }
  const position = siblings.findIndex((node) => node.index === index);
  const target = position + delta;
  if (target < 0 || target >= siblings.length) {
    return false;
  }
  const current = siblings[position];
  const swapped = siblings[target];
  /* v8 ignore next 3 -- position (from a found node) and target (range-checked) are always in bounds. */
  if (!current || !swapped) {
    return false;
  }
  siblings[position] = swapped;
  siblings[target] = current;
  return true;
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
    return { preamble: content, roots: [], sections: [] };
  }
  const sections: HeadingSection[] = headings.map((heading, i) => {
    const start = heading.position.start.offset;
    const nextHeading = headings[i + 1];
    const end = nextHeading ? nextHeading.position.start.offset : content.length;
    return {
      headingText: heading.heading,
      level: heading.level,
      text: content.slice(start, end)
    };
  });
  const preamble = content.slice(0, first.position.start.offset);
  return { preamble, roots: buildTree(headings), sections };
}

function buildTree(headings: readonly HeadingCache[]): HeadingTreeNode[] {
  const roots: HeadingTreeNode[] = [];
  const stack: HeadingTreeStackEntry[] = [];
  headings.forEach((heading, index) => {
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
  });
  return roots;
}

function findSiblingList(nodes: HeadingTreeNode[], index: number): HeadingTreeNode[] | null {
  if (nodes.some((node) => node.index === index)) {
    return nodes;
  }
  for (const node of nodes) {
    const found = findSiblingList(node.children, index);
    if (found) {
      return found;
    }
  }
  return null;
}

function hasSiblingGroup(nodes: readonly HeadingTreeNode[]): boolean {
  if (nodes.length >= MINIMUM_SIBLING_GROUP_SIZE) {
    return true;
  }
  return nodes.some((node) => hasSiblingGroup(node.children));
}
