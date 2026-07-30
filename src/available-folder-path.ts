import type {
  App,
  TAbstractFile
} from 'obsidian';

import { isFolder } from 'obsidian-dev-utils/obsidian/file-system';
import { getAvailablePath } from 'obsidian-dev-utils/obsidian/vault';

/**
 * Finds an available FOLDER path, appending ` 1`, ` 2`, … until a name that no existing file or folder
 * occupies is found (mirroring Obsidian's own de-duplication).
 *
 * Deliberately not `obsidian-dev-utils` {@link getAvailablePath}: that one de-duplicates a FILE path, so it
 * splits the name on its last dot and inserts the counter before the extension — turning a folder named
 * `v1.2` into `v1 1.2` instead of `v1.2 1`. A folder has no extension, so the counter always goes at the
 * end.
 *
 * Extracted out of `item-selectors/split-item-selector.ts` once `Flatten folder...` grew modes that move
 * only folders (issues #170/#171), making the dot-named-folder case the common path rather than a corner
 * of "split into folder".
 *
 * @param app - The Obsidian application instance.
 * @param desiredPath - The preferred folder path.
 * @returns A folder path that does not collide with an existing file or folder.
 */
export function getAvailableFolderPath(app: App, desiredPath: string): string {
  if (!app.vault.getAbstractFileByPath(desiredPath)) {
    return desiredPath;
  }

  let index = 1;
  for (;;) {
    const candidatePath = `${desiredPath} ${index.toString()}`;
    if (!app.vault.getAbstractFileByPath(candidatePath)) {
      return candidatePath;
    }
    index++;
  }
}

/**
 * De-duplicates the path an existing file or folder is about to be moved to, picking the rule that matches
 * what is being moved: {@link getAvailableFolderPath} for a folder, `obsidian-dev-utils`
 * {@link getAvailablePath} for a file.
 *
 * The flatten executor and its confirmation preview both go through this, so a preview can never promise a
 * name the move will not give.
 *
 * @param app - The Obsidian application instance.
 * @param abstractFile - The file or folder being moved.
 * @param desiredPath - The path it would take if nothing collided.
 * @returns A path that does not collide with an existing file or folder.
 */
export function getAvailablePathForAbstractFile(app: App, abstractFile: TAbstractFile, desiredPath: string): string {
  return isFolder(abstractFile) ? getAvailableFolderPath(app, desiredPath) : getAvailablePath(app, desiredPath);
}
