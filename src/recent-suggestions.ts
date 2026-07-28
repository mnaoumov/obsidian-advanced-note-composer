import type {
  App,
  FuzzyMatch,
  TAbstractFile,
  TFile,
  TFolder
} from 'obsidian';

/**
 * How many recently-opened files to consider. Obsidian's own default is `10`, which silently truncates
 * the recent list long before the vault runs out of interesting folders, so the pickers ask for more.
 */
const RECENT_FILE_PATHS_MAX_COUNT = 50;

/**
 * Parameters for {@link getRecentFilePaths}.
 */
export interface GetRecentFilePathsParams {
  readonly app: App;

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

  readonly query: string;

  /**
   * Resolves a recent file path into the item the picker offers (the file itself, or its parent folder).
   *
   * @param path - The recent file path.
   * @returns The item, or `null` when the path resolves to nothing offerable.
   */
  resolveItem(this: void, path: string): Item | null;

  readonly shouldIncludeActiveFile: boolean;
  readonly suggestions: FuzzyMatch<Item>[];
}

/**
 * The recently-opened file paths every picker orders by, most-recent-first.
 *
 * @param params - The parameters.
 * @returns The recent file paths, most-recent-first. May contain duplicates and paths that no longer
 * resolve, so callers de-duplicate on the resolved item.
 */
export function getRecentFilePaths(params: GetRecentFilePathsParams): string[] {
  const { app, shouldIncludeActiveFile } = params;
  const recentFilePaths = app.workspace.getRecentFiles({
    maxCount: RECENT_FILE_PATHS_MAX_COUNT,
    showCanvas: true,
    showImages: true,
    showMarkdown: true,
    showNonAttachments: true,
    showNonImageAttachments: true
  });

  if (!shouldIncludeActiveFile) {
    return recentFilePaths;
  }

  const activeFile = app.workspace.getActiveFile();
  if (!activeFile) {
    return recentFilePaths;
  }

  return [activeFile.path, ...recentFilePaths];
}

/**
 * Surfaces the most-recently-opened files at the top of a file picker's suggestions when there is no
 * query, filtered by `isAllowedFile` and de-duplicated, with the remaining fuzzy suggestions following
 * (minus any already listed as recent).
 *
 * @param params - The parameters.
 * @returns The reordered suggestions.
 */
export function reorderSuggestionsByRecentFiles(params: ReorderSuggestionsByRecentFilesParams): FuzzyMatch<TFile>[] {
  const {
    app,
    isAllowedFile,
    query,
    suggestions
  } = params;
  return reorderSuggestionsByRecentItems({
    app,
    isAllowedItem: isAllowedFile,
    query,
    resolveItem: (path) => app.vault.getFileByPath(path),
    // The active file is the operation's own source, which every file picker excludes anyway.
    shouldIncludeActiveFile: false,
    suggestions
  });
}

/**
 * Surfaces the folder the user is currently on, followed by the most-recently-opened folders (the
 * parents of the recently-opened files), at the top of the folder-picker suggestions when there is no
 * query, filtered by `isAllowedFolder` and de-duplicated, with the remaining fuzzy suggestions following
 * (minus any already listed as recent). Shared by the merge, move and swap folder pickers so all three
 * order recent folders the same way.
 *
 * @param params - The parameters.
 * @returns The reordered suggestions.
 */
export function reorderSuggestionsByRecentFolders(params: ReorderSuggestionsByRecentFoldersParams): FuzzyMatch<TFolder>[] {
  const {
    app,
    isAllowedFolder,
    query,
    suggestions
  } = params;
  return reorderSuggestionsByRecentItems({
    app,
    isAllowedItem: isAllowedFolder,
    query,
    resolveItem: (path) => app.vault.getFileByPath(path)?.parent ?? null,
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
    query,
    resolveItem,
    shouldIncludeActiveFile,
    suggestions
  } = params;
  if (query) {
    return suggestions;
  }

  const recentFilePaths = getRecentFilePaths({ app, shouldIncludeActiveFile });
  const recentItems: Item[] = [];
  const recentItemsSet = new Set<Item>();
  for (const filePath of recentFilePaths) {
    const item = resolveItem(filePath);
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
