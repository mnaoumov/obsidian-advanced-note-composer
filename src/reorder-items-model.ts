import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';

import type {
  ReorderModalRow,
  ReorderModel,
  ReorderModelDidMoveParams,
  ReorderModelDidMoveToParams
} from './modals/reorder-modal.ts';
import type { ReorderItemInput } from './reorder-items.ts';

import { parseNumberedName } from './numbered-name.ts';
import {
  BASE_TOKEN_KEYS,
  ReorderItemKind
} from './reorder-items.ts';

/**
 * Parameters for {@link ReorderItemsModel}.
 */
export interface ReorderItemsModelConstructorParams {
  /**
   * The folder's own notes, in the order they are offered.
   */
  readonly fileItems: readonly ReorderItemInput[];

  /**
   * The `reorderedFileNameTemplate` setting — used to strip the number off a name for display.
   */
  readonly fileNameTemplate: string;

  /**
   * The folder's sub-folders, in the order they are offered.
   */
  readonly folderItems: readonly ReorderItemInput[];

  /**
   * The `reorderedFolderNameTemplate` setting.
   */
  readonly folderNameTemplate: string;

  /**
   * Whether the files start out included — the `shouldIncludeFilesWhenReorderingByDefault` setting.
   */
  readonly shouldIncludeFiles: boolean;
}

interface ReorderEntry {
  readonly baseName: string;
  readonly id: number;
  readonly item: ReorderItemInput;
}

const FILES_GROUP_KEY = 'files';
const FOLDERS_GROUP_KEY = 'folders';

/**
 * The model behind the folder/file reorder modal (issue #216).
 *
 * Folders and files are two INDEPENDENT sequences, each numbered from 1, and nothing can move between them
 * — because the file explorer always sorts folders above files, so a single merged numbering could never be
 * displayed in the order it claims.
 *
 * Rows are labelled with the name WITHOUT its number and badged with the number the item will get, so the
 * modal shows the result rather than the current state; that is why it needs no separate confirmation
 * dialog.
 */
export class ReorderItemsModel implements ReorderModel {
  private readonly fileEntries: ReorderEntry[];
  private readonly folderEntries: ReorderEntry[];
  private shouldIncludeFiles: boolean;

  public constructor(params: ReorderItemsModelConstructorParams) {
    this.folderEntries = toEntries(params.folderItems, params.folderNameTemplate, ReorderItemKind.Folder, 0);
    this.fileEntries = toEntries(params.fileItems, params.fileNameTemplate, ReorderItemKind.File, params.folderItems.length);
    this.shouldIncludeFiles = params.shouldIncludeFiles;
  }

  public buildRows: ReorderModel['buildRows'] = () => [
    ...toRows(this.folderEntries, FOLDERS_GROUP_KEY),
    ...toRows(this.shouldIncludeFiles ? this.fileEntries : [], FILES_GROUP_KEY)
  ];

  public didMove: ReorderModel['didMove'] = (params: ReorderModelDidMoveParams) => {
    const entries = this.findEntries(params.id);
    if (!entries) {
      return false;
    }

    const position = entries.findIndex((entry) => entry.id === params.id);
    const targetPosition = position + params.delta;
    if (targetPosition < 0 || targetPosition >= entries.length) {
      return false;
    }

    move(entries, position, targetPosition);
    return true;
  };

  public didMoveTo: ReorderModel['didMoveTo'] = (params: ReorderModelDidMoveToParams) => {
    const entries = this.findEntries(params.id);
    // Refused rather than clamped when the two rows are in different groups: the drop simply did not
    // Happen, which is what keeps a note out of the folder sequence.
    if (!entries?.some((entry) => entry.id === params.targetId)) {
      return false;
    }

    const position = entries.findIndex((entry) => entry.id === params.id);
    const targetPosition = entries.findIndex((entry) => entry.id === params.targetId);
    const insertPosition = targetPosition + (params.isAfter ? 1 : 0) - (targetPosition > position ? 1 : 0);
    if (insertPosition === position) {
      return false;
    }

    move(entries, position, insertPosition);
    return true;
  };

  public getGroupTitle: ReorderModel['getGroupTitle'] = (groupKey: string) => groupKey === FOLDERS_GROUP_KEY ? 'Folders' : 'Files';

  /**
   * The items of one kind, in the order the user left them.
   *
   * @param kind - Which kind to report.
   * @returns The items, or nothing at all for files while they are not included — so a reorder that never
   * offered the notes cannot rename them.
   */
  public getOrderedItems(kind: ReorderItemKind): readonly ReorderItemInput[] {
    if (kind === ReorderItemKind.File) {
      return this.shouldIncludeFiles ? this.fileEntries.map((entry) => entry.item) : [];
    }

    return this.folderEntries.map((entry) => entry.item);
  }

  /**
   * Ticks or clears the modal's `Include files` box.
   *
   * @param shouldIncludeFiles - The new state.
   */
  public setShouldIncludeFiles(shouldIncludeFiles: boolean): void {
    this.shouldIncludeFiles = shouldIncludeFiles;
  }

  private findEntries(id: number): null | ReorderEntry[] {
    return [this.folderEntries, this.shouldIncludeFiles ? this.fileEntries : []]
      .find((entries) => entries.some((entry) => entry.id === id)) ?? null;
  }
}

function move(entries: ReorderEntry[], position: number, targetPosition: number): void {
  // `ensureNonNullable` rather than a guard: `splice` at an in-range position always yields the entry, so
  // A branch here would be one nothing can reach — and the throw lives inside the helper (G10t).
  const entry = ensureNonNullable(entries.splice(position, 1)[0]);
  entries.splice(targetPosition, 0, entry);
}

function toEntries(
  items: readonly ReorderItemInput[],
  nameTemplate: string,
  kind: ReorderItemKind,
  firstId: number
): ReorderEntry[] {
  return items.map((item, position) => ({
    baseName: parseNumberedName({ baseTokenKey: BASE_TOKEN_KEYS[kind], name: item.name, nameTemplate }).baseName,
    // Ids are assigned once and never reused, so a row keeps its identity as the arrays are reordered
    // Under it — folders take the low ids, files continue the sequence.
    id: firstId + position,
    item
  }));
}

function toRows(entries: readonly ReorderEntry[], groupKey: string): ReorderModalRow[] {
  return entries.map((entry, position) => ({
    canMoveDown: position < entries.length - 1,
    canMoveUp: position > 0,
    dataLabel: entry.baseName,
    depth: 0,
    groupKey,
    id: entry.id,
    indexLabel: (position + 1).toString(),
    label: entry.baseName
  }));
}
