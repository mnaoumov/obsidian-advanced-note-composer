/**
 * @file
 *
 * The plugin's OWN recency, recorded for the `target` / `destination` of a COMPLETED operation (issue #206).
 *
 * Obsidian tracks only which files were OPENED, and until now that was the whole input to every picker's
 * ordering (see `recent-suggestions.ts`). A folder that served as a merge/move/split destination therefore
 * left no trace, so running several operations into the same folder meant clicking it into the ranking first
 * — which is exactly what the reporter asked not to have to do.
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
 * Forgets every recorded target.
 *
 * The recorded targets are session-only by design, so the plugin clears them when it unloads — a reload
 * starts from Obsidian's own recency, never from the previous session's operations.
 */
export function clearRecentTargets(): void {
  recentTargetPaths.length = 0;
}

/**
 * The paths recorded as operation targets, most-recent-first.
 *
 * @returns The recorded target paths, most-recent-first. Files and folders share one list; each reader
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
  const path = typeof target === 'string' ? target : target.path;
  // Re-targeting the same folder has to re-head it rather than leave it wherever it already sat, so the
  // Earlier copy is dropped instead of the new one being skipped as a duplicate.
  const existingIndex = recentTargetPaths.indexOf(path);
  if (existingIndex !== -1) {
    recentTargetPaths.splice(existingIndex, 1);
  }
  recentTargetPaths.unshift(path);
  if (recentTargetPaths.length > RECENT_TARGET_PATHS_MAX_COUNT) {
    recentTargetPaths.length = RECENT_TARGET_PATHS_MAX_COUNT;
  }
}
