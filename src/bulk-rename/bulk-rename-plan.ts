import { escapeRegExp } from '@mnaoumov/typescript-lib/reg-exp';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';

import type { RenameStep } from '../reorder/reorder-items.ts';

import { buildRenameSteps } from '../reorder/reorder-items.ts';
import { resolveBulkRenameTemplateTokens } from '../templates/template-tokens.ts';

/**
 * How `Bulk rename...` changes the letter case of each name, after find and replace and before the prefix and
 * suffix are added.
 */
export enum BulkRenameCaseChange {
  Lower = 'Lower',
  Sentence = 'Sentence',
  Title = 'Title',
  Unchanged = 'Unchanged',
  Upper = 'Upper'
}

/**
 * Parameters for {@link buildBulkRenamePlan}.
 */
export interface BuildBulkRenamePlanParams {
  /**
   * Whether something other than the batch itself already holds a path. Injected so this module stays pure:
   * the caller asks the vault, case-insensitively, because a name differing only in case collides on the file
   * systems Obsidian runs on most.
   *
   * @param path - The path to test.
   * @returns Whether anything in the vault occupies it.
   */
  readonly isPathOccupied: (this: void, path: string) => boolean;

  /**
   * The items, in the order they are numbered.
   */
  readonly items: readonly BulkRenameItem[];

  /**
   * What the user asked for.
   */
  readonly request: BulkRenameRequest;
}

/**
 * Parameters for {@link buildBulkRenameSteps}.
 */
export interface BuildBulkRenameStepsParams {
  /**
   * The planned entries, as {@link buildBulkRenamePlan} returned them.
   */
  readonly entries: readonly BulkRenamePlanEntry[];

  /**
   * Turns the path a cycle member is heading for into a free path to park it on.
   *
   * @param desiredPath - The final path of the parked item.
   * @param isFolder - Whether the parked item is a folder, which has no extension to keep.
   * @returns A free path.
   */
  readonly resolveTemporaryPath: (this: void, desiredPath: string, isFolder: boolean) => string;
}

/**
 * One item of the batch, as it stands before the rename.
 */
export interface BulkRenameItem {
  /**
   * The extension, leading dot included, or an empty string for a folder. Never renamed.
   */
  readonly extension: string;

  /**
   * Whether the item is a folder. A folder's name is used whole: `v1.2` has no extension.
   */
  readonly isFolder: boolean;

  /**
   * The folder's name, or the file's basename — never the extension.
   */
  readonly name: string;

  /**
   * The name of the folder holding the item.
   */
  readonly parentFolder: string;

  /**
   * The path of the folder holding the item, `/` for the vault root.
   */
  readonly parentFolderPath: string;
  readonly path: string;
}

/**
 * The plan for a whole batch.
 */
export interface BulkRenamePlan {
  /**
   * The number of items whose name changes.
   */
  readonly changedCount: number;

  /**
   * One entry per item, in the order the items were given.
   */
  readonly entries: readonly BulkRenamePlanEntry[];

  /**
   * Why no entry could be computed at all (a regular expression that does not parse, an unknown token), or
   * `null`.
   */
  readonly error: null | string;

  /**
   * The number of entries carrying a {@link BulkRenamePlanEntry.problem}. A batch with any is not run.
   */
  readonly problemCount: number;
}

/**
 * One item's planned rename.
 */
export interface BulkRenamePlanEntry {
  /**
   * How many folders deep the item sits; the renames run deepest first.
   */
  readonly depth: number;
  readonly isChanged: boolean;
  readonly isFolder: boolean;

  /**
   * The new name, extension included.
   */
  readonly newName: string;
  readonly newPath: string;

  /**
   * The current name, extension included.
   */
  readonly oldName: string;
  readonly oldPath: string;

  /**
   * Why this rename cannot run, or `null`.
   */
  readonly problem: null | string;
}

/**
 * What the user typed into the bulk rename dialog.
 */
export interface BulkRenameRequest {
  /**
   * How the letter case changes.
   */
  readonly caseChange: BulkRenameCaseChange;

  /**
   * The text, or the regular expression source, to find. Empty skips the find and replace step.
   */
  readonly findText: string;

  /**
   * Whether the find matches letter case exactly.
   */
  readonly isCaseSensitive: boolean;

  /**
   * Whether {@link BulkRenameRequest.findText} is a regular expression, so `$1` in the replacement names a
   * group.
   */
  readonly isRegularExpression: boolean;

  /**
   * Text added before the name. Takes the `{{index}}` / `{{index:000}}` tokens, so numbering is a prefix.
   */
  readonly prefix: string;

  /**
   * The replacement for every match of {@link BulkRenameRequest.findText}.
   */
  readonly replaceText: string;

  /**
   * The number the first item gets.
   */
  readonly startIndex: number;

  /**
   * Text added after the name, before the extension. Takes the same tokens as the prefix.
   */
  readonly suffix: string;
}

/**
 * The options a fresh dialog opens with: nothing changes until the user types something.
 */
export const DEFAULT_BULK_RENAME_REQUEST: BulkRenameRequest = {
  caseChange: BulkRenameCaseChange.Unchanged,
  findText: '',
  isCaseSensitive: false,
  isRegularExpression: false,
  prefix: '',
  replaceText: '',
  startIndex: 1,
  suffix: ''
};

/**
 * The characters no file or folder name may hold. `/` is the path separator; the rest are refused by the file
 * system or break Obsidian's links. Mirrors `filename-validation.ts`, plus `/`, which there means a path.
 */
const INVALID_NAME_CHARACTERS_REG_EXP = /[*\\/<>:|?#^[\]"]/;

/**
 * A name ending in a dot or a space, which Windows silently strips.
 */
const TRAILING_DOT_OR_SPACE_REG_EXP = /[ .]$/;

const WORD_REG_EXP = /\p{L}[\p{L}\p{M}'’]*/gu;

/**
 * One function per case change. A `Record` keyed by the enum rather than a `switch`, so a new member is a
 * compile error rather than a case nothing handles.
 */
const CASE_CHANGERS: Record<BulkRenameCaseChange, (this: void, name: string) => string> = {
  [BulkRenameCaseChange.Lower]: (name) => name.toLocaleLowerCase(),
  [BulkRenameCaseChange.Sentence]: (name) => name.toLocaleLowerCase().replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase()),
  [BulkRenameCaseChange.Title]: (name) => name.replaceAll(WORD_REG_EXP, (word) => `${word.charAt(0).toLocaleUpperCase()}${word.slice(1).toLocaleLowerCase()}`),
  [BulkRenameCaseChange.Unchanged]: (name) => name,
  [BulkRenameCaseChange.Upper]: (name) => name.toLocaleUpperCase()
};

interface FindProblemParams {
  readonly changedOldPaths: ReadonlySet<string>;
  readonly isPathOccupied: (this: void, path: string) => boolean;
  readonly newBaseName: string;
  readonly newPath: string;
  readonly newPathCounts: ReadonlyMap<string, number>;
  readonly oldPath: string;
}

interface RenderedItem {
  readonly item: BulkRenameItem;
  readonly newBaseName: string;
}

interface RenderNewNameParams {
  readonly findRegExp: null | RegExp;
  readonly item: BulkRenameItem;
  readonly options: BulkRenameRequest;
  readonly position: number;
}

/**
 * Plans a bulk rename: find and replace, case change, prefix and suffix, in that order, then checks every
 * resulting name.
 *
 * Every new path is computed against the item's CURRENT parent, even when that parent is itself being
 * renamed: the renames run deepest first ({@link buildBulkRenameSteps}), so a child is renamed while its
 * parent still has its old name.
 *
 * @param params - The items, the options and the occupancy test.
 * @returns The plan. A plan with an {@link BulkRenamePlan.error} carries every item unchanged.
 */
export function buildBulkRenamePlan(params: BuildBulkRenamePlanParams): BulkRenamePlan {
  const { isPathOccupied, items, request: options } = params;

  let findRegExp: null | RegExp = null;
  if (options.findText) {
    const flags = options.isCaseSensitive ? 'gu' : 'giu';
    try {
      findRegExp = new RegExp(options.isRegularExpression ? options.findText : escapeRegExp(options.findText), flags);
    } catch (error) {
      return buildFailedPlan(items, `Invalid regular expression: ${(error as Error).message}`);
    }
  }

  let renderedItems: RenderedItem[];
  try {
    renderedItems = items.map((item, position) => ({ item, newBaseName: renderNewName({ findRegExp, item, options, position }) }));
  } catch (error) {
    return buildFailedPlan(items, (error as Error).message);
  }

  const rawEntries = renderedItems.map(({ item, newBaseName }) => {
    const newName = `${newBaseName}${item.extension}`;
    return {
      depth: countDepth(item.path),
      isChanged: newName !== `${item.name}${item.extension}`,
      isFolder: item.isFolder,
      newBaseName,
      newName,
      newPath: joinPath(item.parentFolderPath, newName),
      oldName: `${item.name}${item.extension}`,
      oldPath: item.path
    };
  });

  const changedOldPaths = new Set(rawEntries.filter((entry) => entry.isChanged).map((entry) => entry.oldPath.toLowerCase()));
  const newPathCounts = new Map<string, number>();
  for (const entry of rawEntries) {
    const key = entry.newPath.toLowerCase();
    newPathCounts.set(key, (newPathCounts.get(key) ?? 0) + 1);
  }

  const entries = rawEntries.map((entry): BulkRenamePlanEntry => {
    const { newBaseName, ...rest } = entry;
    return {
      ...rest,
      problem: entry.isChanged
        ? findProblem({ changedOldPaths, isPathOccupied, newBaseName, newPath: entry.newPath, newPathCounts, oldPath: entry.oldPath })
        : null
    };
  });

  return {
    changedCount: entries.filter((entry) => entry.isChanged).length,
    entries,
    error: null,
    problemCount: entries.filter((entry) => entry.problem !== null).length
  };
}

/**
 * Orders the renames of a plan so every destination is free when it is used.
 *
 * The deepest items go first, so a file is renamed while the folder holding it still has its old name, and
 * every path the plan computed is still true when its turn comes. Items at one depth sit in different folders
 * or in the same one, and within one folder a set of renames can be a cycle (`A` to `B`, `B` to `A`), which
 * {@link buildRenameSteps} breaks by parking one member under a temporary name.
 *
 * @param params - The entries and the temporary-path resolver.
 * @returns The renames, in order.
 */
export function buildBulkRenameSteps(params: BuildBulkRenameStepsParams): readonly RenameStep[] {
  const { entries, resolveTemporaryPath } = params;
  const changedEntries = entries.filter((entry) => entry.isChanged);
  const depths = [...new Set(changedEntries.map((entry) => entry.depth))].sort((a, b) => b - a);
  const folderFlagsByNewPath = new Map(changedEntries.map((entry) => [entry.newPath, entry.isFolder]));

  return depths.flatMap((depth) =>
    buildRenameSteps({
      items: changedEntries.filter((entry) => entry.depth === depth),
      resolveTemporaryPath: (desiredPath) => resolveTemporaryPath(desiredPath, ensureNonNullable(folderFlagsByNewPath.get(desiredPath)))
    })
  );
}

/**
 * Changes the letter case of a name.
 *
 * @param name - The name.
 * @param caseChange - The change to make.
 * @returns The changed name.
 */
export function changeCase(name: string, caseChange: BulkRenameCaseChange): string {
  return CASE_CHANGERS[caseChange](name);
}

function buildFailedPlan(items: readonly BulkRenameItem[], error: string): BulkRenamePlan {
  return {
    changedCount: 0,
    entries: items.map((item) => ({
      depth: countDepth(item.path),
      isChanged: false,
      isFolder: item.isFolder,
      newName: `${item.name}${item.extension}`,
      newPath: item.path,
      oldName: `${item.name}${item.extension}`,
      oldPath: item.path,
      problem: null
    })),
    error,
    problemCount: 0
  };
}

function countDepth(path: string): number {
  return path.split('/').length;
}

function findProblem(params: FindProblemParams): null | string {
  const {
    changedOldPaths,
    isPathOccupied,
    newBaseName,
    newPath,
    newPathCounts,
    oldPath
  } = params;

  if (!newBaseName.trim()) {
    return 'The name is empty.';
  }
  if (INVALID_NAME_CHARACTERS_REG_EXP.test(newBaseName)) {
    return 'The name holds a character a file name cannot: * " \\ / < > : | ? # ^ [ ]';
  }
  if (newBaseName.startsWith('.')) {
    return 'The name starts with a dot, which hides it.';
  }
  if (TRAILING_DOT_OR_SPACE_REG_EXP.test(newBaseName)) {
    return 'The name ends with a dot or a space.';
  }

  const newPathKey = newPath.toLowerCase();
  if (ensureNonNullable(newPathCounts.get(newPathKey)) > 1) {
    return 'Another item in this batch gets the same name.';
  }
  // Occupied by something the batch moves away is fine: the rename order frees it first. The item's own old
  // path counts as moved away too, which is what lets a case-only rename (`note` to `Note`) through.
  if (newPathKey !== oldPath.toLowerCase() && !changedOldPaths.has(newPathKey) && isPathOccupied(newPath)) {
    return 'Something with this name already exists in the folder.';
  }

  return null;
}

function joinPath(parentFolderPath: string, name: string): string {
  return parentFolderPath === '/' || parentFolderPath === '' ? name : `${parentFolderPath}/${name}`;
}

function renderNewName(params: RenderNewNameParams): string {
  const {
    findRegExp,
    item,
    options,
    position
  } = params;

  let name = item.name;
  if (findRegExp) {
    // A plain-text replacement is inserted literally: `$&` in it is text, not a pattern.
    name = options.isRegularExpression
      // eslint-disable-next-line unicorn/no-unsafe-string-replacement -- `$1` in a regular-expression replacement naming a group is the feature.
      ? name.replace(findRegExp, options.replaceText)
      : name.replace(findRegExp, () => options.replaceText);
  }
  name = changeCase(name, options.caseChange);

  const tokens = {
    extension: item.extension,
    index: options.startIndex + position,
    name,
    parentFolder: item.parentFolder,
    parentFolderPath: item.parentFolderPath
  };
  const prefix = resolveBulkRenameTemplateTokens({ template: options.prefix, tokens });
  const suffix = resolveBulkRenameTemplateTokens({ template: options.suffix, tokens });
  return `${prefix}${name}${suffix}`;
}
