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
  flattenHeadingTree,
  MAX_REORDERED_HEADING_LEVEL
} from './heading-sections.ts';
import { ReorderDropPlacement } from './modals/reorder-modal.ts';

/**
 * Parameters for {@link HeadingReorderModel}.
 */
export interface HeadingReorderModelConstructorParams {
  /**
   * The split note. Its `roots` tree and its `levels` are what the model mutates, so the caller reads the
   * confirmed order and levels straight back off it.
   */
  readonly split: SplitReorderableSectionsResult;
}

/**
 * Where a heading sits in the tree.
 */
interface HeadingLocation {
  readonly node: HeadingTreeNode;
  readonly parent: HeadingTreeNode | null;

  /**
   * The list holding the node — mutable, since a move splices it.
   */
  readonly siblings: HeadingTreeNode[];
}

/**
 * A move worked out but not yet made, so the same answer serves both "would this drop be accepted" while a
 * drag hovers and the drop itself.
 */
interface PlannedHeadingMove {
  /**
   * The list the heading lands in.
   */
  readonly destination: HeadingTreeNode[];

  /**
   * The position in {@link PlannedHeadingMove.destination} to insert at, counted BEFORE the heading is
   * taken out of its own list.
   */
  readonly insertPosition: number;

  /**
   * The level the moved heading will have; its whole subtree shifts by the same amount.
   */
  readonly level: number;

  readonly source: HeadingLocation;
}

/**
 * Every heading row shares this one group, so a drag can land on any heading (issue #295). What a drop
 * MEANS is the model's call, not the group's.
 */
const HEADINGS_GROUP_KEY = 'headings';

/**
 * Presents a note's heading tree to the shared reorder modal (issue #216).
 *
 * A row's DEPTH is its indentation. Moving a heading moves everything nested under it, because the move
 * happens on the tree rather than on the flat list.
 *
 * Since issue #295 a heading is no longer confined to its own siblings: it can be dropped before, after or
 * inside any heading outside its own subtree, or indented under the heading above it / outdented out of its
 * parent. **The moved heading takes the level of the neighbor it lands beside** — before or after `X` it
 * becomes `X`'s level, as the first child of a list it takes that child's level, as the only child of `P`
 * it becomes `P`'s level plus one — and its whole subtree shifts by the same amount, so the structure below
 * it is kept exactly, skipped levels included. That rule is what guarantees the written note re-parses to
 * the tree the modal showed: sibling levels in a heading tree never increase, and a heading equal to its
 * neighbor keeps that true on both sides. Keeping the old level instead would let `## y` moved above
 * `### x` swallow `x` as a child on the next parse. A move that would push any heading past `######` is
 * refused, since markdown has no deeper heading.
 */
export class HeadingReorderModel implements ReorderModel {
  public readonly isNestable = true;
  private readonly split: SplitReorderableSectionsResult;

  public constructor(params: HeadingReorderModelConstructorParams) {
    this.split = params.split;
  }

  public buildRows: ReorderModel['buildRows'] = () =>
    flattenHeadingTree(this.split).map((row): ReorderModalRow => ({
      canIndent: this.planIndent(row.index) !== null,
      canMoveDown: row.canMoveDown,
      canMoveUp: row.canMoveUp,
      canOutdent: this.planOutdent(row.index) !== null,
      dataLabel: row.section.headingText,
      depth: row.depth,
      groupKey: HEADINGS_GROUP_KEY,
      id: row.index,
      // Headings are not a numbered sequence — nothing renames them, so there is no number to preview.
      indexLabel: null,
      label: `${'#'.repeat(this.getLevel(row.index))} ${row.section.headingText}`
    }));

  public canMoveTo: ReorderModel['canMoveTo'] = (params: ReorderModelDidMoveToParams) => this.planDrop(params.id, params.placement, params.targetId) !== null;

  public didChangeDepth: ReorderModel['didChangeDepth'] = (params: ReorderModelDidMoveParams) =>
    this.apply(params.delta > 0 ? this.planIndent(params.id) : this.planOutdent(params.id));

  public didMove: ReorderModel['didMove'] = (params: ReorderModelDidMoveParams) => this.apply(this.planSiblingSwap(params.id, params.delta));

  public didMoveTo: ReorderModel['didMoveTo'] = (params: ReorderModelDidMoveToParams) => this.apply(this.planDrop(params.id, params.placement, params.targetId));

  public getGroupTitle: ReorderModel['getGroupTitle'] = () => null;

  private apply(move: null | PlannedHeadingMove): boolean {
    if (!move) {
      return false;
    }

    const { destination, level, source } = move;
    const position = source.siblings.indexOf(source.node);
    const insertPosition = move.insertPosition - (destination === source.siblings && move.insertPosition > position ? 1 : 0);
    source.siblings.splice(position, 1);
    destination.splice(insertPosition, 0, source.node);

    const shift = level - this.getLevel(source.node.index);
    visitSubtree(source.node, (node) => {
      this.split.levels[node.index] = this.getLevel(node.index) + shift;
    });
    return true;
  }

  private getLevel(index: number): number {
    // Every index comes from the very tree the levels were built for, so a fallback would be a branch
    // nothing can reach — the throw lives inside the helper instead (G10t).
    return ensureNonNullable(this.split.levels[index]);
  }

  private locate(index: number): HeadingLocation | null {
    return findLocation(this.split.roots, null, index);
  }

  private planDrop(id: number, placement: ReorderDropPlacement, targetId: number): null | PlannedHeadingMove {
    const source = this.locate(id);
    const target = this.locate(targetId);
    // A heading cannot land inside its own subtree: it would have to contain itself.
    if (!source || !target || isInSubtree(source.node, targetId)) {
      return null;
    }

    // A drop just below a heading that HAS children draws its line between that heading and its first
    // child, so that is where it lands: as the first child, not after the whole subtree.
    const isInside = placement === ReorderDropPlacement.Inside
      || (placement === ReorderDropPlacement.After && target.node.children.length > 0);
    if (isInside) {
      return this.planInsertAsFirstChild(source, target.node);
    }

    const targetPosition = target.siblings.indexOf(target.node);
    return this.validate({
      destination: target.siblings,
      insertPosition: targetPosition + (placement === ReorderDropPlacement.After ? 1 : 0),
      level: this.getLevel(target.node.index),
      source
    });
  }

  private planIndent(index: number): null | PlannedHeadingMove {
    const source = this.locate(index);
    if (!source) {
      return null;
    }

    const previousSibling = source.siblings[source.siblings.indexOf(source.node) - 1];
    if (!previousSibling) {
      return null;
    }

    const lastChild = previousSibling.children.at(-1);
    return this.validate({
      destination: previousSibling.children,
      insertPosition: previousSibling.children.length,
      level: lastChild ? this.getLevel(lastChild.index) : this.getLevel(previousSibling.index) + 1,
      source
    });
  }

  private planInsertAsFirstChild(source: HeadingLocation, parent: HeadingTreeNode): null | PlannedHeadingMove {
    const firstChild = parent.children.at(0);
    return this.validate({
      destination: parent.children,
      insertPosition: 0,
      level: firstChild ? this.getLevel(firstChild.index) : this.getLevel(parent.index) + 1,
      source
    });
  }

  private planOutdent(index: number): null | PlannedHeadingMove {
    const source = this.locate(index);
    if (!source?.parent) {
      return null;
    }

    // Lands right after its former parent's whole subtree, as that parent's sibling.
    const parent = ensureNonNullable(this.locate(source.parent.index));
    return this.validate({
      destination: parent.siblings,
      insertPosition: parent.siblings.indexOf(parent.node) + 1,
      level: this.getLevel(parent.node.index),
      source
    });
  }

  private planSiblingSwap(id: number, delta: number): null | PlannedHeadingMove {
    const source = this.locate(id);
    if (!source) {
      return null;
    }

    const position = source.siblings.indexOf(source.node);
    const neighbor = source.siblings[position + delta];
    if (!neighbor) {
      return null;
    }

    // Up lands before the sibling above; down lands after the sibling below and its whole subtree.
    return this.validate({
      destination: source.siblings,
      insertPosition: position + (delta > 0 ? delta + 1 : delta),
      level: this.getLevel(neighbor.index),
      source
    });
  }

  private validate(move: PlannedHeadingMove): null | PlannedHeadingMove {
    const { destination, insertPosition, level, source } = move;
    const shift = level - this.getLevel(source.node.index);
    const position = source.siblings.indexOf(source.node);
    const isSamePlace = destination === source.siblings && (insertPosition === position || insertPosition === position + 1);
    if (isSamePlace && shift === 0) {
      return null;
    }

    let deepestLevel = 0;
    visitSubtree(source.node, (node) => {
      deepestLevel = Math.max(deepestLevel, this.getLevel(node.index));
    });
    return deepestLevel + shift > MAX_REORDERED_HEADING_LEVEL ? null : move;
  }
}

function findLocation(siblings: HeadingTreeNode[], parent: HeadingTreeNode | null, index: number): HeadingLocation | null {
  for (const node of siblings) {
    if (node.index === index) {
      return { node, parent, siblings };
    }

    const found = findLocation(node.children, node, index);
    if (found) {
      return found;
    }
  }

  return null;
}

function isInSubtree(node: HeadingTreeNode, index: number): boolean {
  return node.index === index || node.children.some((child) => isInSubtree(child, index));
}

function visitSubtree(node: HeadingTreeNode, callback: (node: HeadingTreeNode) => void): void {
  callback(node);
  for (const child of node.children) {
    visitSubtree(child, callback);
  }
}
