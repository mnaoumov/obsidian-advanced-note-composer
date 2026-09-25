/**
 * @file
 *
 * Whether a folder is an attachment unit folder (issue #298) — a folder an attachment-location plugin has
 * designated to travel as ONE attachment, like a saved web page's `_files/` folder.
 *
 * The designation is not this plugin's: it is read back from whatever the attachment-location plugin
 * published on the patched `Vault.getAvailablePathForAttachments`, through `obsidian-dev-utils`, so this
 * plugin and Custom Attachment Location decide from one answer. A vault where nobody published one has no
 * unit folders at all, which keeps every caller's behavior exactly what it was before.
 */

import type {
  App,
  TFolder
} from 'obsidian';

import { getCheckIsAttachmentUnitFolderFunction } from 'obsidian-dev-utils/obsidian/attachment-path';

/**
 * Whether the folder itself is designated as an attachment unit.
 *
 * @param app - The Obsidian application instance.
 * @param folder - The folder to check.
 * @returns `true` when the folder is designated, `false` otherwise (including when nothing is published).
 */
export function isAttachmentUnitFolder(app: App, folder: TFolder): boolean {
  return !folder.isRoot() && (getCheckIsAttachmentUnitFolderFunction(app)?.(folder.path) ?? false);
}

/**
 * Whether the folder is an attachment unit folder or lies inside one — i.e. whether it is PART of a unit
 * rather than a folder that merely holds units.
 *
 * @param app - The Obsidian application instance.
 * @param folder - The folder to check.
 * @returns `true` when the folder or one of its ancestors is designated.
 */
export function isInsideAttachmentUnitFolder(app: App, folder: TFolder): boolean {
  const checkIsAttachmentUnitFolder = getCheckIsAttachmentUnitFolderFunction(app);
  if (!checkIsAttachmentUnitFolder || folder.isRoot()) {
    return false;
  }
  const segments = folder.path.split('/');
  for (let count = 1; count <= segments.length; count++) {
    if (checkIsAttachmentUnitFolder(segments.slice(0, count).join('/'))) {
      return true;
    }
  }
  return false;
}
