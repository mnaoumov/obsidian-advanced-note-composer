import type {
  App,
  TFile,
  TFolder
} from 'obsidian';
import type { FolderCommandHandlerShouldAddToFolderMenuParams } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { Vault } from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { FolderCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import {
  isFile,
  isFolder,
  isMarkdownFile,
  isTreatedAsAttachment
} from 'obsidian-dev-utils/obsidian/file-system';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import {
  cleanupEmptyFolders,
  EmptyFolderBehavior,
  getAvailablePath,
  trashSafe
} from 'obsidian-dev-utils/obsidian/vault';
import { trimEnd } from 'obsidian-dev-utils/string';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { isFileOrFolderCommandBlocked } from '../command-block.ts';
import { fixFileName } from '../filename-validation.ts';
import { buildFolderHeadingPlan } from '../folder-headings.ts';
import { mergeFilesIntoSingleFile } from '../merge-into-single-file-runner.ts';
import { confirmMergeFolderIntoFile } from '../modals/merge-folder-into-file-modal.ts';
import { EmptyFolderBehaviorAfterMergingFolder } from '../plugin-settings.ts';
import { resolveFolderTemplateTokens } from '../template-tokens.ts';

/**
 * The `obsidian-dev-utils` behavior each setting value cleans up with. `DeleteSubFoldersOnly` maps to plain
 * `Delete` — never `DeleteWithEmptyParents` — because the merged folder itself is excluded from the paths
 * offered to the cleanup, so no ancestor of it can end up empty and the parent half would be meaningless.
 * A `Record` keyed by the enum rather than a `switch`, so adding a member is a compile error instead of an
 * unreachable `default` branch.
 */
const ODU_EMPTY_FOLDER_BEHAVIORS: Record<EmptyFolderBehaviorAfterMergingFolder, EmptyFolderBehavior> = {
  [EmptyFolderBehaviorAfterMergingFolder.Delete]: EmptyFolderBehavior.Delete,
  [EmptyFolderBehaviorAfterMergingFolder.DeleteSubFoldersOnly]: EmptyFolderBehavior.Delete,
  [EmptyFolderBehaviorAfterMergingFolder.DeleteWithEmptyParents]: EmptyFolderBehavior.DeleteWithEmptyParents,
  [EmptyFolderBehaviorAfterMergingFolder.Keep]: EmptyFolderBehavior.Keep
};

interface MergeFolderIntoFileCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

/**
 * `Merge folder contents into a single file` command / folder-menu item (issue #92, the "Folder Merger"
 * capability): concatenates every descendant markdown note of the chosen folder (recursively, in path
 * order) into ONE brand-new note named after the folder and placed alongside it. Distinct from
 * `Merge current folder with another folder...`, which mirrors structure into another folder.
 *
 * Each descendant note is run through the same {@link MergeComposer} as a single-file merge (so the merge
 * template, frontmatter strategy, footnote fixing, and backlink/link updates all apply), inside one
 * reversible resource-locked transaction. Ignored notes are skipped and reported.
 */
export class MergeFolderIntoFileCommandHandler extends FolderCommandHandler {
  private readonly app: App;
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: MergeFolderIntoFileCommandHandlerConstructorParams) {
    super({
      fileMenuItemName: 'Merge folder contents into a single file...',
      fileMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-file-stack',
      id: 'merge-folder-into-file',
      name: 'Merge current folder contents into a single file...'
    });

    this.app = params.app;
    this.consoleDebugComponent = params.consoleDebugComponent;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.resourceLockComponent = params.resourceLockComponent;
  }

  protected override canExecuteFolder(folder: TFolder): boolean {
    super.canExecuteFolder(folder);
    return !folder.isRoot() && !isFileOrFolderCommandBlocked(this.pluginSettingsComponent, folder);
  }

  protected override async executeFolder(folder: TFolder): Promise<void> {
    if (this.pluginSettingsComponent.settings.isPathIgnored(folder.path)) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot merge folder ');
          f.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: folder }));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }

    const { settings } = this.pluginSettingsComponent;
    // Markdown-shaped attachments (an Excalidraw drawing is a `.md` file) are never merged: their raw
    // Payload would land in the merged note. They are relocated with the other attachments instead.
    const mergeItems = collectMergeItemsDepthFirst(
      folder,
      (file) => isMarkdownFile(file) && !isTreatedAsAttachment({ attachmentExtensions: settings.attachmentExtensions, pathOrFile: file })
    );
    const sourceMdFiles = mergeItems.filter(isFile);

    if (sourceMdFiles.length === 0) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('Folder ');
          f.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: folder }));
          f.appendText(' has no markdown notes to merge.');
        })
      );
      return;
    }

    const targetPath = this.resolveTargetPath(folder);

    const isConfirmed = await confirmMergeFolderIntoFile({
      app: this.app,
      noteCount: sourceMdFiles.length,
      pluginSettingsComponent: this.pluginSettingsComponent,
      sourceFolder: folder,
      targetPath
    });
    if (!isConfirmed) {
      return;
    }

    // Snapshotted before the merge: the folders are what they are now, and the merge only empties them.
    const folderPathsToCleanUp = collectFolderPathsDeepestFirst(folder);

    const targetFile = await this.app.vault.create(targetPath, '');

    const result = await mergeFilesIntoSingleFile({
      app: this.app,
      attachmentSourceFolder: settings.shouldMoveAttachmentsWhenMergingFolder ? folder : undefined,
      consoleDebugComponent: this.consoleDebugComponent,
      folderHeadingPlan: settings.shouldConvertFoldersToHeadingsWhenMergingFolder
        ? buildFolderHeadingPlan({
          items: mergeItems.map((mergeItem) => ({ isFolder: isFolder(mergeItem), path: mergeItem.path })),
          rootPath: folder.path
        })
        : undefined,
      isNewTargetFile: true,
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent,
      progressLabel: 'Merging folder',
      resourceLockComponent: this.resourceLockComponent,
      sourceFiles: sourceMdFiles,
      targetFile
    });

    if (result.aborted || result.mergedCount === 0) {
      // Cancelled or nothing merged (e.g. all notes ignored): remove the empty target we created.
      await trashSafe(this.app, targetFile);
      return;
    }

    /*
     * Only after the transaction has committed: folder deletion is NOT part of the rollback, so running
     * it on an aborted merge would delete folders whose notes were just restored. Deepest-first, so each
     * folder is already empty by the time it is considered. `Keep` makes this a no-op.
     */
    const emptyFolderBehaviorAfterMergingFolder = settings.emptyFolderBehaviorAfterMergingFolder;
    await cleanupEmptyFolders({
      app: this.app,
      emptyFolderBehavior: ODU_EMPTY_FOLDER_BEHAVIORS[emptyFolderBehaviorAfterMergingFolder],
      // `DeleteSubFoldersOnly` keeps the merged folder by simply never offering it to the cleanup (issue
      // #167): the behavior is the same `Delete`, only the path set differs.
      folderPaths: emptyFolderBehaviorAfterMergingFolder === EmptyFolderBehaviorAfterMergingFolder.DeleteSubFoldersOnly
        ? folderPathsToCleanUp.filter((folderPath) => folderPath !== folder.path)
        : folderPathsToCleanUp
    });
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return super.shouldAddCommandToSubmenu() ?? this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  // eslint-disable-next-line obsidian-dev-utils/params-options-name-match -- Override must keep the base param type.
  protected override shouldAddToFolderMenu(params: FolderCommandHandlerShouldAddToFolderMenuParams): boolean {
    super.shouldAddToFolderMenu(params);
    return true;
  }

  /**
   * Resolves the base name of the note the folder is merged into from the
   * `mergeFolderIntoFileNoteNameTemplate` setting (issue #160), so a merge can always produce e.g.
   * `Summary.md` instead of `<Folder Name>.md`. An empty setting, a template resolving to nothing, or a
   * name that still spans folders after sanitization all fall back to the folder's own name (today's
   * behavior). Mirrors `SplitItemSelector.resolveNoteBasenameInOwnFolder`.
   *
   * @param folder - The folder being merged.
   * @returns The base name to give the merged note, without the `.md` extension.
   */
  private resolveTargetBasename(folder: TFolder): string {
    const { settings } = this.pluginSettingsComponent;
    const template = settings.mergeFolderIntoFileNoteNameTemplate;
    if (!template) {
      return folder.name;
    }

    const resolved = resolveFolderTemplateTokens({ sourceFolder: folder, template });
    const noteName = trimEnd({ str: resolved.trim(), suffix: '.md' }).trim();
    if (!noteName) {
      return folder.name;
    }

    const fixedNoteName = fixFileName({
      fileName: noteName,
      replacement: settings.replacement,
      shouldReplaceInvalidCharacters: settings.shouldReplaceInvalidTitleCharacters,
      shouldTreatTitleAsPath: false
    });
    // Only reachable when `shouldReplaceInvalidTitleCharacters` is off, leaving a separator in place.
    // Creating the note in the folder that separator implies would put it somewhere the user never asked.
    if (fixedNoteName.includes('/') || fixedNoteName.includes('\\')) {
      return folder.name;
    }

    return fixedNoteName;
  }

  /**
   * Resolves where the merged note is created: always beside the folder, named by
   * {@link resolveTargetBasename}, de-duplicated against what is already there. The parent prefix is
   * sliced off `folder.path` rather than rebuilt from the parent folder, which keeps it correct when the
   * folder sits at the vault root.
   *
   * @param folder - The folder being merged.
   * @returns The path of the note to create.
   */
  private resolveTargetPath(folder: TFolder): string {
    const parentPrefix = folder.path.slice(0, folder.path.length - folder.name.length);
    return getAvailablePath(this.app, `${parentPrefix}${this.resolveTargetBasename(folder)}.md`);
  }
}

/**
 * Collects the folder and every folder under it, deepest first, so an emptied tree can be removed from
 * the leaves upward — a parent only becomes empty once its children are gone.
 *
 * @param folder - The folder being merged.
 * @returns The folder paths, deepest first.
 */
function collectFolderPathsDeepestFirst(folder: TFolder): string[] {
  // Seeded with the folder itself and collected into a set, because whether `recurseChildren` yields the
  // Folder it was given is not something to depend on.
  const folderPaths = new Set<string>([folder.path]);
  Vault.recurseChildren(folder, (child) => {
    if (isFolder(child)) {
      folderPaths.add(child.path);
    }
  });
  return [...folderPaths].sort((a, b) => getDepth(b) - getDepth(a) || b.localeCompare(a));
}

/**
 * Walks the folder in folder-grouped depth-first order — a folder's own mergeable notes (alphabetically)
 * first, then each sub-folder followed by its whole subtree. A flat sort by path would interleave a
 * sub-folder's notes with the root's own ones (`sub/z.md` sorts before `zeta.md`), which would re-enter a
 * folder and make the folder-heading plan emit its heading more than once.
 *
 * The sub-folders themselves are part of the result, not just their notes: the heading plan needs them to
 * head a folder that holds no notes at all, which no note path can reveal (issue #168). The notes to merge
 * are the walk's files, in the same order.
 *
 * @param folder - The folder to walk.
 * @param isMergeableNote - Whether a file is one of the notes to merge (as opposed to an attachment).
 * @returns The descendant folders and mergeable notes, in merge order.
 */
function collectMergeItemsDepthFirst(folder: TFolder, isMergeableNote: (file: TFile) => boolean): (TFile | TFolder)[] {
  const notes = folder.children
    .filter(isFile)
    .filter((child) => isMergeableNote(child))
    .sort((a, b) => a.name.localeCompare(b.name));
  const subFolders = folder.children
    .filter(isFolder)
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...notes, ...subFolders.flatMap((subFolder) => [subFolder, ...collectMergeItemsDepthFirst(subFolder, isMergeableNote)])];
}

function getDepth(folderPath: string): number {
  return folderPath.split('/').length;
}
