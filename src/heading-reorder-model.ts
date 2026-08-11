import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';

import type {
  HeadingTreeNode,
  SplitReorderableSectionsResult
} from './heading-sections.ts';
import type {
  ReorderModalRow,
  ReorderModel,
  ReorderModelDidMoveParams,
  ReorderModelDidMoveToParams
} from './modals/reorder-modal.ts';

import {
  didMoveSibling,
  flattenHeadingTree
} from './heading-sections.ts';

/**
 * Parameters for {@link HeadingReorderModel}.
 */
export interface HeadingReorderModelConstructorParams {
  /**
   * The split note. Its `roots` tree is what the model mutates, so the caller reads the confirmed order
   * straight back off it.
   */
  readonly split: SplitReorderableSectionsResult;
}

const ROOT_GROUP_KEY = 'root';

/**
 * Presents a note's heading tree to the shared reorder modal (issue #216).
 *
 * Two mappings are all a tree needs: a row's DEPTH is its indentation, and a row's GROUP is its parent —
 * which is what confines both an arrow press and a drag to the heading's own siblings, the rule
 * `Reorder headings` has always had. Moving a heading moves everything nested under it, because the move
 * happens on the tree rather than on the flat list.
 */
export class HeadingReorderModel implements ReorderModel {
  private readonly split: SplitReorderableSectionsResult;

  public constructor(params: HeadingReorderModelConstructorParams) {
    this.split = params.split;
  }

  public buildRows: ReorderModel['buildRows'] = () => {
    const groupKeysBySectionIndex = buildGroupKeys(this.split.roots);
    return flattenHeadingTree(this.split).map((row): ReorderModalRow => ({
      canMoveDown: row.canMoveDown,
      canMoveUp: row.canMoveUp,
      dataLabel: row.section.headingText,
      depth: row.depth,
      // Every row comes from the very tree the keys were built from, so a fallback here would be a branch
      // Nothing can reach — the throw lives inside the helper instead (G10t).
      groupKey: ensureNonNullable(groupKeysBySectionIndex.get(row.index)),
      id: row.index,
      // Headings are not a numbered sequence — nothing renames them, so there is no number to preview.
      indexLabel: null,
      label: `${'#'.repeat(row.section.level)} ${row.section.headingText}`
    }));
  };

  public didMove: ReorderModel['didMove'] = (params: ReorderModelDidMoveParams) => didMoveSibling(this.split.roots, params.id, params.delta);

  public didMoveTo: ReorderModel['didMoveTo'] = (params: ReorderModelDidMoveToParams) => {
    const siblings = findSiblings(this.split.roots, params.id);
    if (!siblings) {
      return false;
    }

    const position = siblings.findIndex((node) => node.index === params.id);
    const targetPosition = siblings.findIndex((node) => node.index === params.targetId);
    // A drop onto a heading with a different parent is refused rather than re-parented: this reorders
    // Siblings, it never restructures the note.
    if (targetPosition === -1) {
      return false;
    }

    const insertPosition = targetPosition + (params.isAfter ? 1 : 0) - (targetPosition > position ? 1 : 0);
    if (insertPosition === position) {
      return false;
    }

    // `ensureNonNullable` rather than a guard: `splice` at an in-range position always yields the node, so
    // A branch here would be one nothing can reach — and the throw lives inside the helper (G10t).
    const node = ensureNonNullable(siblings.splice(position, 1)[0]);
    siblings.splice(insertPosition, 0, node);
    return true;
  };

  public getGroupTitle: ReorderModel['getGroupTitle'] = () => null;
}

/**
 * Maps each section index to a key identifying its PARENT, so two headings share a group exactly when they
 * are siblings.
 *
 * @param roots - The tree roots.
 * @returns The group key of every node in the tree.
 */
function buildGroupKeys(roots: readonly HeadingTreeNode[]): Map<number, string> {
  const groupKeysBySectionIndex = new Map<number, string>();
  visit(roots, ROOT_GROUP_KEY);
  return groupKeysBySectionIndex;

  function visit(nodes: readonly HeadingTreeNode[], groupKey: string): void {
    for (const node of nodes) {
      groupKeysBySectionIndex.set(node.index, groupKey);
      visit(node.children, node.index.toString());
    }
  }
}

/**
 * Finds the sibling list holding the node with the given section index.
 *
 * @param roots - The tree roots.
 * @param index - The section index to find.
 * @returns The list the node lives in — mutable, since a drop reorders it — or `null` when the tree has no
 * such node.
 */
function findSiblings(roots: HeadingTreeNode[], index: number): HeadingTreeNode[] | null {
  if (roots.some((node) => node.index === index)) {
    return roots;
  }

  for (const node of roots) {
    const siblings = findSiblings(node.children, index);
    if (siblings) {
      return siblings;
    }
  }

  return null;
}
