import { PathSettings } from 'obsidian-dev-utils/obsidian/path-settings';
import { isValidRegExp } from 'obsidian-dev-utils/reg-exp';

/**
 * Parameters for {@link shouldKeepFolderNameSeparate}.
 */
export interface ShouldKeepFolderNameSeparateParams {
  /**
   * The name of the folder being merged in — its name alone, never its path.
   */
  readonly folderName: string;

  /**
   * The configured entries, as typed into the setting: a plain name, or a `/regular expression/` literal.
   */
  readonly keepSeparateFolderNames: readonly string[];
}

/**
 * Parameters for {@link shouldKeepFolderPathSeparate}.
 */
export interface ShouldKeepFolderPathSeparateParams {
  /**
   * The configured entries, as typed into the setting: a plain path, or a `/regular expression/` literal.
   */
  readonly keepSeparateFolderPaths: readonly string[];

  /**
   * The paths the folder is judged by: where it sits before the merge, and where it would land without
   * being kept separate.
   */
  readonly paths: readonly string[];
}

const REG_EXP_LITERAL_MIN_LENGTH = 2;

/**
 * Whether a folder of this name must never be merged INTO a destination folder of the same name (issue
 * #267), so the merge gives the incoming one a de-duplicated name instead of pouring the two together.
 *
 * Matched against the folder's NAME rather than its path, because what makes two folders combine is the
 * name they share: the reporter's case is an `B` that occurs under several parents and must stay distinct
 * under each. A rule scoped to a PLACE is {@link shouldKeepFolderPathSeparate}'s list (issue #296); the
 * category's own `Merge include paths` / `Merge exclude paths` rows answer a different question — they
 * decide what a merge may touch at all.
 *
 * The two entry forms are the ones every other list in this plugin takes:
 * - a plain string, matched as the WHOLE name (`B` keeps `B` separate and leaves `Backup` alone);
 * - a `/regular expression/` literal, tested against the name UNANCHORED, exactly as the path lists treat
 *   theirs — `/^Attachments$/` for one name, `/^\d+\. /` for a family of them.
 *
 * An un-parseable literal matches nothing rather than throwing: `pathsValidator` is registered on the
 * setting and is what tells the user their entry is broken, the same division of labour as issue #155.
 *
 * @param params - The folder name and the configured entries.
 * @returns Whether this folder must be kept separate.
 */
export function shouldKeepFolderNameSeparate(params: ShouldKeepFolderNameSeparateParams): boolean {
  const { folderName, keepSeparateFolderNames } = params;
  return keepSeparateFolderNames.some((entry) => doesEntryMatch(entry, folderName));
}

/**
 * The path-based sibling of {@link shouldKeepFolderNameSeparate} (issue #296): whether a folder must never
 * be merged INTO a destination folder of the same name, judged by its PATH rather than its name.
 *
 * The name list cannot say "folders in folder X", which is what the reporter asked for: a rule scoped to a
 * place rather than to a name. This list takes exactly the syntax of the `<category> include/exclude paths`
 * lists — a plain path covers that path AND its whole subtree, a `/regular expression/` is tested
 * unanchored against the full path — and is matched through obsidian-dev-utils' own `PathSettings`, so the
 * grammar is that object rather than a second copy of it. That also carries over its all-or-nothing
 * fallback: one un-parseable literal makes the whole list match nothing, which the registered
 * `pathsValidator` reports (issue #155).
 *
 * It is ADDED beside the name list, not folded into it: reading the shipped name entries as paths would
 * turn a listed `B` into "the vault-root folder `B`", silently changing every existing configuration.
 *
 * A folder is judged by more than one path because "folders in folder X" names either end of a merge:
 * `E` listed keeps separate whatever would be poured into a same-named folder under `E`, while `A` listed
 * keeps separate whatever comes out of `A`, wherever `A` is merged. Any path matching is enough.
 *
 * @param params - The folder's paths and the configured entries.
 * @returns Whether this folder must be kept separate.
 */
export function shouldKeepFolderPathSeparate(params: ShouldKeepFolderPathSeparateParams): boolean {
  const { keepSeparateFolderPaths, paths } = params;
  const pathSettings = new PathSettings();
  pathSettings.excludePaths = [...keepSeparateFolderPaths];
  return paths.some((path) => pathSettings.isPathIgnored(path));
}

/**
 * Whether one configured entry matches one folder name.
 *
 * @param entry - The entry, as typed into the setting.
 * @param folderName - The folder's name.
 * @returns Whether the entry matches.
 */
function doesEntryMatch(entry: string, folderName: string): boolean {
  if (entry.length >= REG_EXP_LITERAL_MIN_LENGTH && entry.startsWith('/') && entry.endsWith('/')) {
    const source = entry.slice(1, -1);
    return isValidRegExp(source) && new RegExp(source).test(folderName);
  }

  return entry === folderName;
}
