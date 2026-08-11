import type { TFolder } from 'obsidian';

import type { ReorderItemsCommandHandlerParams } from './reorder-items-command-handler-base.ts';

import { ReorderItemsCommandHandlerBase } from './reorder-items-command-handler-base.ts';

/**
 * Parameters for {@link ReorderSiblingFoldersCommandHandler}.
 */
export type ReorderSiblingFoldersCommandHandlerConstructorParams = ReorderItemsCommandHandlerParams;

/**
 * `Reorder sibling folders...` command (issue #216): renumbers the folder's own siblings — every child
 * folder of its PARENT — and rewrites each one's folder-note `title` to match.
 *
 * This is the shape the reporter's `folder-note-extended` has, and the one their video shows: right-click a
 * folder, reorder the row it lives in. It is also the only way to reorder TOP-LEVEL folders, since the
 * vault root has no context menu of its own — right-clicking any folder at the root offers all of them.
 */
export class ReorderSiblingFoldersCommandHandler extends ReorderItemsCommandHandlerBase {
  public constructor(params: ReorderSiblingFoldersCommandHandlerConstructorParams) {
    super({
      ...params,
      commandId: 'reorder-sibling-folders',
      commandName: 'Reorder sibling folders...'
    });
  }

  protected override resolveParentFolder(folder: TFolder): null | TFolder {
    // The vault root has no siblings; every other folder has a parent, the root included.
    return folder.parent;
  }
}
