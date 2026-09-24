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

const REG_EXP_LITERAL_MIN_LENGTH = 2;

/**
 * Whether a folder of this name must never be merged INTO a destination folder of the same name (issue
 * #267), so the merge gives the incoming one a de-duplicated name instead of pouring the two together.
 *
 * Matched against the folder's NAME rather than its path, because what makes two folders combine is the
 * name they share: the reporter's case is an `B` that occurs under several parents and must stay distinct
 * under each. A path-scoped rule is what the category's own `Merge include paths` / `Merge exclude paths`
 * rows already are, and those answer a different question — they decide what a merge may touch at all.
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
