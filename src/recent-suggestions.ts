import type {
  App,
  FuzzyMatch,
  TAbstractFile,
  TFile,
  TFolder
} from 'obsidian';

import { PickerRecencyOrder } from './plugin-settings.ts';
import { getRecentTargetPaths } from './recent-targets.ts';

/**
 * How many recently-opened files to consider. Obsidian's own default is `10`, which silently truncates
 * the recent list long before the vault runs out of interesting folders, so the pickers ask for more.
 */
const RECENT_FILE_PATHS_MAX_COUNT = 50;

/**
 * Parameters for {@link getRecentPaths}.
 */
export interface GetRecentPathsParams {
  readonly app: App;

  /**
   * Which recency wins the top of the list (issue #248).
   */
  readonly pickerRecencyOrder: PickerRecencyOrder;

  /**
   * Whether the currently active file is prepended to the recent paths.
   *
   * Obsidian's `RecentFileTracker` collects the file you just **left**, not the one you just opened
   * (`workspace.getRecentFiles()` is fed from `onFileOpen(newFile, previousFile)` and collects
   * `previousFile`), so the file you are looking at right now is never at the head of that list — it is
   * usually absent, and at best sits wherever some earlier event happened to put it. A folder picker
   * asked for "the folder I am on" therefore has to add it back (issue #158); a file picker does not,
   * because the active file is the operation's own source and is filtered out anyway.
   */
  readonly shouldIncludeActiveFile: boolean;
}

/**
 * Parameters for {@link reorderSuggestionsByRecentFiles}.
 */
export interface ReorderSuggestionsByRecentFilesParams {
  readonly app: App;

  /**
   * Whether a file is an allowed target (the caller's own constraint). Recent files that fail it are
   * skipped.
   *
   * @param file - The candidate recent file.
   * @returns Whether the file is an allowed target.
   */
  isAllowedFile(this: void, file: TFile): boolean;

  /**
   * Which recency wins the top of the list (issue #248).
   */
  readonly pickerRecencyOrder: PickerRecencyOrder;

  /**
   * The current fuzzy query. When non-empty the suggestions are returned untouched (the fuzzy ranking
   * wins); recent files are only surfaced for the empty query.
   */
  readonly query: string;

  /**
   * The base suggestions produced by the fuzzy modal for `query`.
   */
  readonly suggestions: FuzzyMatch<TFile>[];
}

/**
 * Parameters for {@link reorderSuggestionsByRecentFolders}.
 */
export interface ReorderSuggestionsByRecentFoldersParams {
  readonly app: App;

  /**
   * Whether a folder is an allowed destination (the caller's own constraint, e.g. the merge picker's
   * include-child/parent rules or the move picker's `isAllowedMoveTarget`). Recent folders that fail it
   * are skipped.
   *
   * @param folder - The candidate recent folder.
   * @returns Whether the folder is an allowed destination.
   */
  isAllowedFolder(this: void, folder: TFolder): boolean;

  /**
   * Which recency wins the top of the list (issue #248).
   */
  readonly pickerRecencyOrder: PickerRecencyOrder;

  /**
   * The current fuzzy query. When non-empty the suggestions are returned untouched (the fuzzy ranking
   * wins); recent folders are only surfaced for the empty query.
   */
  readonly query: string;

  /**
   * The base suggestions produced by the fuzzy modal for `query`.
   */
  readonly suggestions: FuzzyMatch<TFolder>[];
}

interface ReorderSuggestionsByRecentItemsParams<Item extends TAbstractFile> {
  readonly app: App;

  /**
   * Whether an item is an allowed target.
   *
   * @param item - The candidate recent item.
   * @returns Whether the item is an allowed target.
   */
  isAllowedItem(this: void, item: Item): boolean;

  readonly pickerRecencyOrder: PickerRecencyOrder;

  readonly query: string;

  /**
   * Resolves a recent path into the item the picker offers (the file itself, the folder itself, or a
   * file's parent folder).
   *
   * @param path - The recent path.
   * @returns The item, or `null` when the path resolves to nothing offerable.
   */
  resolveItem(this: void, path: string): Item | null;

  readonly shouldIncludeActiveFile: boolean;
  readonly suggestions: FuzzyMatch<Item>[];
}

/**
 * The paths every picker orders by, most-recent-first: the plugin's own recorded operation targets, then
 * (optionally) the active file, then Obsidian's recently-opened files.
 *
 * The plugin's own log holds BOTH kinds of event — completed targets and opened notes — in the order they
 * happened (issue #256), so nothing here has to rank them against each other: the head is whichever came
 * last. #206's "a destination used once is the top one for the operations that follow" survives as far as
 * it was ever wanted, up to the moment the user goes somewhere else. Entries are file OR folder paths (see
 * `recent-targets.ts`); a reader that cannot resolve one simply skips it, which is what keeps folders out
 * of the file pickers.
 *
 * The active file is still prepended separately, and that is not redundant: it covers the note that was
 * already open when the plugin loaded, which no `file-open` of this session ever recorded.
 *
 * @param params - The parameters.
 * @returns The recent paths, most-recent-first. May contain duplicates and paths that no longer
 * resolve, so callers de-duplicate on the resolved item.
 */
export function getRecentPaths(params: GetRecentPathsParams): string[] {
  const {
    app,
    pickerRecencyOrder,
    shouldIncludeActiveFile
  } = params;
  const recentTargetPaths = getRecentTargetPaths();
  const recentFilePaths = app.workspace.getRecentFiles({
    maxCount: RECENT_FILE_PATHS_MAX_COUNT,
    showCanvas: true,
    showImages: true,
    showMarkdown: true,
    showNonAttachments: true,
    showNonImageAttachments: true
  });

  const activeFilePath = shouldIncludeActiveFile ? app.workspace.getActiveFile()?.path ?? null : null;
  if (activeFilePath === null) {
    return [...recentTargetPaths, ...recentFilePaths];
  }

  // Whether the folder you are looking at RIGHT NOW outranks your recent activity — the whole of issue
  // #248. Since issue #256 the other side of this choice is a time-ordered log rather than a pile of
  // Targets, so `RecentTargetsFirst` no longer means "a target, however old".
  if (pickerRecencyOrder === PickerRecencyOrder.ActiveFileFirst) {
    return [activeFilePath, ...recentTargetPaths, ...recentFilePaths];
  }

  return [...recentTargetPaths, activeFilePath, ...recentFilePaths];
}

/**
 * Surfaces the files a completed operation targeted, then the most-recently-opened files, at the top of a
 * file picker's suggestions when there is no query, filtered by `isAllowedFile` and de-duplicated, with the
 * remaining fuzzy suggestions following (minus any already listed as recent). A recorded target that is a
 * FOLDER resolves to nothing here and is skipped, so the folder half of the recorded list never leaks into
 * a file picker.
 *
 * @param params - The parameters.
 * @returns The reordered suggestions.
 */
export function reorderSuggestionsByRecentFiles(params: ReorderSuggestionsByRecentFilesParams): FuzzyMatch<TFile>[] {
  const {
    app,
    isAllowedFile,
    pickerRecencyOrder,
    query,
    suggestions
  } = params;
  return reorderSuggestionsByRecentItems({
    app,
    isAllowedItem: isAllowedFile,
    pickerRecencyOrder,
    query,
    resolveItem: (path) => app.vault.getFileByPath(path),
    // The active file is the operation's own source, which every file picker excludes anyway.
    shouldIncludeActiveFile: false,
    suggestions
  });
}

/**
 * Surfaces the folders a completed operation targeted, then the folder the user is currently on, then the
 * most-recently-opened folders (the parents of the recently-opened files), at the top of the folder-picker
 * suggestions when there is no query, filtered by `isAllowedFolder` and de-duplicated, with the remaining
 * fuzzy suggestions following (minus any already listed as recent). Shared by the merge, move and swap
 * folder pickers so all three order recent folders the same way.
 *
 * @param params - The parameters.
 * @returns The reordered suggestions.
 */
export function reorderSuggestionsByRecentFolders(params: ReorderSuggestionsByRecentFoldersParams): FuzzyMatch<TFolder>[] {
  const {
    app,
    isAllowedFolder,
    pickerRecencyOrder,
    query,
    suggestions
  } = params;
  return reorderSuggestionsByRecentItems({
    app,
    isAllowedItem: isAllowedFolder,
    pickerRecencyOrder,
    query,
    // A recorded target is resolved as the folder itself when it IS one, and otherwise as the parent of the
    // Target file — which is how "the folder a note was merged into counts as clicked on" falls out of the
    // Same lookup that turns a recently-opened file into its folder (issue #206).
    resolveItem: (path) => app.vault.getFolderByPath(path) ?? app.vault.getFileByPath(path)?.parent ?? null,
    // The folder the user is on is exactly what the picker is expected to offer first (issue #158), and
    // Obsidian's recent list never contains the active file.
    shouldIncludeActiveFile: true,
    suggestions
  });
}

function reorderSuggestionsByRecentItems<Item extends TAbstractFile>(params: ReorderSuggestionsByRecentItemsParams<Item>): FuzzyMatch<Item>[] {
  const {
    app,
    isAllowedItem,
    pickerRecencyOrder,
    query,
    resolveItem,
    shouldIncludeActiveFile,
    suggestions
  } = params;
  if (query) {
    return suggestions;
  }

  const recentPaths = getRecentPaths({ app, pickerRecencyOrder, shouldIncludeActiveFile });
  const recentItems: Item[] = [];
  const recentItemsSet = new Set<Item>();
  for (const recentPath of recentPaths) {
    const item = resolveItem(recentPath);
    if (!item) {
      continue;
    }
    if (!isAllowedItem(item)) {
      continue;
    }
    if (recentItemsSet.has(item)) {
      continue;
    }
    recentItemsSet.add(item);
    recentItems.push(item);
  }

  const recentSuggestions = recentItems.map((item) => ({ item, match: { matches: [], score: 0 } }));
  const otherSuggestions = suggestions.filter((suggestion) => !recentItemsSet.has(suggestion.item));
  return [...recentSuggestions, ...otherSuggestions];
}
