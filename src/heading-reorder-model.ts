import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';

import type { HeadingNumbering } from './heading-numbering.ts';
import type {
  HeadingTreeNode,
  SplitReorderableSectionsResult
} from './heading-sections.ts';
import type {
  ReorderModalRow,
  ReorderModalSort,
  ReorderModel,
  ReorderModelDidMoveParams,
  ReorderModelDidMoveToParams
} from './modals/reorder-modal.ts';

import {
  computeHeadingTexts,
  stripHeadingNumber
} from './heading-numbering.ts';
import {
  flattenHeadingTree,
  MAX_REORDERED_HEADING_LEVEL
} from './heading-sections.ts';
import {
  ReorderDropPlacement,
  ReorderSortDirection
} from './modals/reorder-modal.ts';
import { compareNatural } from './natural-sort.ts';

/**
 * The sort scope that sorts every list of siblings, whatever their level.
 */
export const ALL_LEVELS_SORT_SCOPE = 'all';

/**
 * Parameters for {@link HeadingReorderModel}.
 */
export interface HeadingReorderModelConstructorParams {
  /**
   * How the headings are numbered (issue #295), or `null` to leave every heading text as it is. The model
   * reads it on every render, so the rows preview the text each heading will be written with.
   */
  readonly numbering: HeadingNumbering | null;

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
  private readonly numbering: HeadingNumbering | null;
  private readonly split: SplitReorderableSectionsResult;

  public constructor(params: HeadingReorderModelConstructorParams) {
    this.numbering = params.numbering;
    this.split = params.split;
  }

  /**
   * Builds the modal's `Sort by name` row (issue #306): one scope per heading level that has siblings to
   * sort, plus `All levels`. The default is the shallowest such level, which skips a lone title heading and
   * lands on the entries under it, such as a changelog's versions.
   *
   * @returns The sort row, or `null` when no heading has a sibling, so there is nothing to sort.
   */
  public buildNameSort(): null | ReorderModalSort {
    const levels = new Set<number>();
    visitSiblingLists(this.split.roots, (siblings) => {
      if (siblings.length > 1) {
        for (const node of siblings) {
          levels.add(this.getLevel(node.index));
        }
      }
    });

    const sortedLevels = [...levels].sort((a, b) => a - b);
    const shallowestLevel = sortedLevels[0];
    if (shallowestLevel === undefined) {
      return null;
    }

    return {
      defaultScope: String(shallowestLevel),
      label: 'Sort by name',
      scopes: [
        ...sortedLevels.map((level) => ({ label: `Level ${String(level)} (${'#'.repeat(level)})`, value: String(level) })),
        { label: 'All levels', value: ALL_LEVELS_SORT_SCOPE }
      ],
      sort: (params) => this.didSortByName(params.scope, params.direction)
    };
  }

  public buildRows: ReorderModel['buildRows'] = () => {
    const headingTexts = this.numbering ? computeHeadingTexts(this.split, this.numbering) : this.split.headingTexts;
    return flattenHeadingTree(this.split).map((row): ReorderModalRow => ({
      canIndent: this.planIndent(row.index) !== null,
      canMoveDown: row.canMoveDown,
      canMoveUp: row.canMoveUp,
      canOutdent: this.planOutdent(row.index) !== null,
      dataLabel: row.section.headingText,
      depth: row.depth,
      groupKey: HEADINGS_GROUP_KEY,
      id: row.index,
      // A heading's number is part of its text, so the label previews it rather than a separate badge.
      indexLabel: null,
      label: `${'#'.repeat(this.getLevel(row.index))} ${ensureNonNullable(headingTexts[row.index])}`
    }));
  };

  public canMoveTo: ReorderModel['canMoveTo'] = (params: ReorderModelDidMoveToParams) => this.planDrop(params.id, params.placement, params.targetId) !== null;

  public didChangeDepth: ReorderModel['didChangeDepth'] = (params: ReorderModelDidMoveParams) => this.apply(params.delta > 0 ? this.planIndent(params.id) : this.planOutdent(params.id));

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

  /**
   * Sorts, by name, every list of siblings that holds a heading of the chosen level, or every list for
   * `All levels`. Each heading carries its whole subtree with it.
   *
   * The comparison is {@link compareNatural}, so a run of digits counts as one number: version headings,
   * ISO dates and `Unique note creator` timestamps sort chronologically by name. A number the numbering
   * template wrote is ignored when the note is or will be numbered, since renumbering rewrites it anyway.
   * Ties keep their current order.
   *
   * @param scope - The level to sort, or {@link ALL_LEVELS_SORT_SCOPE}.
   * @param direction - Which way to sort.
   * @returns Whether the order changed.
   */
  private didSortByName(scope: string, direction: ReorderSortDirection): boolean {
    const level = scope === ALL_LEVELS_SORT_SCOPE ? null : Number(scope);
    const sign = direction === ReorderSortDirection.AToZ ? 1 : -1;
    const numbering = this.numbering;
    const shouldIgnoreNumbers = numbering !== null && (numbering.shouldNumber || numbering.wasNumbered);
    const keys = this.split.sections.map((section) => shouldIgnoreNumbers ? stripHeadingNumber({ headingText: section.headingText, template: numbering.template }) : section.headingText);

    let isChanged = false;
    visitSiblingLists(this.split.roots, (siblings) => {
      if (level !== null && siblings.every((node) => this.getLevel(node.index) !== level)) {
        return;
      }

      const sorted = [...siblings].sort((a, b) => sign * compareNatural(getKey(a), getKey(b)));
      if (sorted.every((node, position) => node === siblings[position])) {
        return;
      }

      siblings.splice(0, siblings.length, ...sorted);
      this.relevelToShallowest(siblings);
      isChanged = true;
    });
    return isChanged;

    function getKey(node: HeadingTreeNode): string {
      return ensureNonNullable(keys[node.index]);
    }
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

  /**
   * Brings every heading of a reordered sibling list to the list's shallowest level, shifting its subtree
   * with it. Siblings can only ever get shallower down a heading tree, so a sorted list with mixed levels
   * would otherwise re-parse with a heading swallowed by the shallower one sorted above it. Only an outline
   * that already skips levels has such a list.
   *
   * @param siblings - The reordered list.
   */
  private relevelToShallowest(siblings: readonly HeadingTreeNode[]): void {
    const shallowestLevel = Math.min(...siblings.map((node) => this.getLevel(node.index)));
    for (const sibling of siblings) {
      const shift = shallowestLevel - this.getLevel(sibling.index);
      visitSubtree(sibling, (node) => {
        this.split.levels[node.index] = this.getLevel(node.index) + shift;
      });
    }
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

/**
 * Calls the callback on every list of siblings in the tree, the roots first, each list before the lists
 * under it. The callback may reorder the list it is handed: its children are visited in the new order.
 *
 * @param siblings - The list to start from.
 * @param callback - Called once per list.
 */
function visitSiblingLists(siblings: HeadingTreeNode[], callback: (siblings: HeadingTreeNode[]) => void): void {
  callback(siblings);
  for (const node of siblings) {
    visitSiblingLists(node.children, callback);
  }
}

function visitSubtree(node: HeadingTreeNode, callback: (node: HeadingTreeNode) => void): void {
  callback(node);
  for (const child of node.children) {
    visitSubtree(child, callback);
  }
}
