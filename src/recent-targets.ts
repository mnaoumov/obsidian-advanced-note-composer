/**
 * @file
 *
 * The plugin's OWN recency: one time-ordered log of everything the user has recently POINTED AT — the
 * `target` / `destination` of a completed operation (issue #206) and the notes they have since opened
 * (issue #256).
 *
 * Obsidian tracks only which files were OPENED, and until issue #206 that was the whole input to every
 * picker's ordering (see `recent-suggestions.ts`). A folder that served as a merge/move/split destination
 * left no trace, so running several operations into the same folder meant clicking it into the ranking
 * first — which is exactly what that reporter asked not to have to do.
 *
 * **Issue #256 is why VISITS are recorded here too, rather than the two recencies being ranked by kind.**
 * Recorded targets used to sit unconditionally above Obsidian's file history, so a destination stayed at
 * the head of the picker however long ago it was used and however much navigating had happened since: the
 * reporter merged into `B`, opened notes in `C` and `D`, and the picker still offered `B` first. Both
 * kinds of event now land in ONE list in the order they happened, so the head is simply whichever came
 * last — which is what the report asks for in as many words. #206's guarantee survives in the form that
 * was actually wanted: a destination stays first for the operations that follow it, until the user goes
 * somewhere else.
 *
 * Paths are stored rather than `TAbstractFile` references, and resolved lazily by whoever reads them: a
 * target later renamed or deleted simply stops resolving and is skipped, the same way a stale entry from
 * Obsidian's own recent list is.
 *
 * The store is a module-level singleton on purpose. The pickers are free functions that receive only
 * `app` / `pluginSettingsComponent`, so an injected store would have to be threaded through every picker and
 * every command handler in between, for state that is deliberately session-only anyway.
 */

import type { PathOrAbstractFile } from 'obsidian-dev-utils/obsidian/file-system';

/**
 * How many recorded targets to keep, matching the recent-file count `recent-suggestions.ts` asks Obsidian
 * for. The list is a ranking hint, not a history: anything below this depth is out-ranked by the fuzzy
 * suggestions it would be competing with.
 */
const RECENT_TARGET_PATHS_MAX_COUNT = 50;

const recentTargetPaths: string[] = [];

/**
 * Forgets everything recorded.
 *
 * The log is session-only by design, so the plugin clears it when it unloads — a reload starts from
 * Obsidian's own recency, never from the previous session's operations.
 */
export function clearRecentTargets(): void {
  recentTargetPaths.length = 0;
}

/**
 * Everything recorded, most-recent-first, targets and visits interleaved in the order they happened.
 *
 * @returns The recorded paths, most-recent-first. Files and folders share one list; each reader
 * resolves a path its own way (a folder picker takes a file path's parent, a file picker skips a folder
 * path).
 */
export function getRecentTargetPaths(): readonly string[] {
  return recentTargetPaths;
}

/**
 * Records the `target` / `destination` of a COMPLETED operation, so the pickers offer it first next time.
 *
 * Call this once the operation has actually landed — never when the target is merely selected or confirmed.
 * A cancelled or rolled-back operation must leave the ranking untouched, or the picker would recommend a
 * folder nothing was ever put into.
 *
 * @param target - The file or folder the operation targeted, or its path. A swap or a move MUTATES
 * `TAbstractFile.path`, so those flows pass the path they captured BEFORE the rename — handing over the
 * object afterwards would record the other side of the operation.
 */
export function recordRecentTarget(target: PathOrAbstractFile): void {
  recordRecentPath(typeof target === 'string' ? target : target.path);
}

/**
 * Records a note the user just OPENED (issue #256), so navigating away from a folder demotes it below
 * wherever they went instead of leaving it pinned to the head of every picker.
 *
 * Deliberately the same list a completed target goes into, and deliberately NOT weighted against it: the
 * report asks for whichever happened last, and two lists ranked by kind is precisely what could not
 * express that. A visit is recorded for the file, so a folder picker resolves it to the folder the user is
 * in, exactly as it already does for Obsidian's own file history.
 *
 * @param visitedFile - The file that just became active, or its path.
 */
export function recordRecentVisit(visitedFile: PathOrAbstractFile): void {
  recordRecentPath(typeof visitedFile === 'string' ? visitedFile : visitedFile.path);
}

/**
 * Heads the log with a path, dropping any earlier copy of it.
 *
 * @param path - The path to record.
 */
function recordRecentPath(path: string): void {
  // Pointing at the same folder again has to re-head it rather than leave it wherever it already sat, so
  // The earlier copy is dropped instead of the new one being skipped as a duplicate.
  const existingIndex = recentTargetPaths.indexOf(path);
  if (existingIndex !== -1) {
    recentTargetPaths.splice(existingIndex, 1);
  }
  recentTargetPaths.unshift(path);
  if (recentTargetPaths.length > RECENT_TARGET_PATHS_MAX_COUNT) {
    recentTargetPaths.length = RECENT_TARGET_PATHS_MAX_COUNT;
  }
}
