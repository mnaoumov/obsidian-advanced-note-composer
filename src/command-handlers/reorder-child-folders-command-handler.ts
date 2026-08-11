import type { TFolder } from 'obsidian';

import type { ReorderItemsCommandHandlerParams } from './reorder-items-command-handler-base.ts';

import { ReorderItemsCommandHandlerBase } from './reorder-items-command-handler-base.ts';

/**
 * Parameters for {@link ReorderChildFoldersCommandHandler}.
 */
export type ReorderChildFoldersCommandHandlerConstructorParams = ReorderItemsCommandHandlerParams;

/**
 * `Reorder child folders...` command (issue #216): renumbers what is INSIDE the folder that was clicked,
 * and rewrites each renumbered folder's folder-note `title` to match.
 *
 * The counterpart to `Reorder sibling folders...`, and the reading that matches
 * `Create folder with notes...`, where the right-clicked folder is likewise the parent rather than the
 * subject. Both exist because neither reading covers the other: a folder's own row is reordered from the
 * sibling command, its contents from this one.
 */
export class ReorderChildFoldersCommandHandler extends ReorderItemsCommandHandlerBase {
  public constructor(params: ReorderChildFoldersCommandHandlerConstructorParams) {
    super({
      ...params,
      commandId: 'reorder-child-folders',
      commandName: 'Reorder child folders...'
    });
  }

  /**
   * The command-palette path. The base resolves the ACTIVE note's parent folder, which for this command
   * would mean "the folder the note I am on lives in" — a guess. It resolves through Obsidian's own
   * `Default location for new notes` instead, the answer issue #194 settled for
   * `Create folder with notes...`, so each entry point has exactly one unambiguous subject: the
   * right-clicked folder from the menu, Obsidian's setting from the palette.
   *
   * @returns A {@link Promise} that resolves when the reorder has run.
   */
  protected override async execute(): Promise<void> {
    const parentFolder = this.app.fileManager.getNewFileParent(this.app.workspace.getActiveFile()?.path ?? '');
    await this.executeFolder(parentFolder);
  }

  protected override resolveParentFolder(folder: TFolder): null | TFolder {
    return folder;
  }
}
