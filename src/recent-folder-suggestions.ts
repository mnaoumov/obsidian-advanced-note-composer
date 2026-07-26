import type {
  App,
  FuzzyMatch,
  TFolder
} from 'obsidian';

/**
 * Parameters for {@link reorderSuggestionsByRecentFolders}.
 */
export interface ReorderSuggestionsByRecentFoldersParams {
  readonly app: App;

  /**
   * Whether a folder is an allowed destination (the caller's own constraint, e.g. the merge picker's
   * include-child/parent rules or the move picker's {@link isAllowedMoveTarget}). Recent folders that
   * fail it are skipped.
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

/**
 * Surfaces the most-recently-opened folders (the parents of the recently-opened files) at the top of the
 * folder-picker suggestions when there is no query, filtered by `isAllowedFolder` and de-duplicated, with
 * the remaining fuzzy suggestions following (minus any already listed as recent). Shared by the merge and
 * move folder pickers so both order recent folders first.
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
  if (query) {
    return suggestions;
  }

  const recentFilePaths = app.workspace.getRecentFiles({
    showCanvas: true,
    showImages: true,
    showMarkdown: true,
    showNonAttachments: true,
    showNonImageAttachments: true
  });
  const recentFolders: TFolder[] = [];
  const recentFoldersSet = new Set<TFolder>();
  for (const filePath of recentFilePaths) {
    const file = app.vault.getFileByPath(filePath);
    if (!file?.parent) {
      continue;
    }
    if (!isAllowedFolder(file.parent)) {
      continue;
    }
    if (recentFoldersSet.has(file.parent)) {
      continue;
    }
    recentFoldersSet.add(file.parent);
    recentFolders.push(file.parent);
  }

  const recentSuggestions = recentFolders.map((folder) => ({ item: folder, match: { matches: [], score: 0 } }));
  const otherSuggestions = suggestions.filter((suggestion) => !recentFoldersSet.has(suggestion.item));
  return [...recentSuggestions, ...otherSuggestions];
}
