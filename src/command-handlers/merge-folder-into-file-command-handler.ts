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
import { join } from 'obsidian-dev-utils/path';
import { trimEnd } from 'obsidian-dev-utils/string';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { isFileOrFolderCommandBlocked } from '../command-block.ts';
import { buildFolderHeadingPlan } from '../folder-headings.ts';
import { mergeFilesIntoSingleFile } from '../merge-into-single-file-runner.ts';
import { confirmMergeFolderIntoFile } from '../modals/merge-folder-into-file-modal.ts';
import { selectFolder } from '../modals/select-folder-modal.ts';
import {
  NameTransformError,
  transformAndFixFileName
} from '../name-transform.ts';
import { compareNatural } from '../natural-sort.ts';
import { openFileAfterOperation } from '../open-after-operation.ts';
import {
  EmptyFolderBehaviorAfterMergingFolder,
  MergeFolderIntoFileLocation
} from '../plugin-settings.ts';
import { resolveFolderTemplateTokens } from '../template-tokens.ts';

/**
 * How many mergeable notes a folder needs before the command is offered at all (issue #209). Merging ONE
 * note into a brand-new note produces a copy of that note under a different name, which is not what the
 * command is for — and a folder with none has nothing to merge either. Mirrors
 * `MergeFileCommandHandler`'s `MIN_MERGEABLE_FILE_COUNT`, which refuses a multi-select of fewer than two.
 */
const MIN_MERGEABLE_NOTE_COUNT = 2;

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
 * The two paths a folder merge needs, which differ only in the issue-#186 case where the configured name is
 * occupied by a note that the merge itself is about to remove: the note is CREATED de-duplicated and RENAMED
 * to the configured name at the end.
 */
interface MergeFolderIntoFileTargetPaths {
  readonly pathToCreate: string;
  readonly targetPath: string;
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
    // Cheapest answers first: both are a property of the folder itself, and they spare the subtree walk
    // Below on every folder-menu open.
    if (folder.isRoot() || isFileOrFolderCommandBlocked(this.pluginSettingsComponent, folder)) {
      return false;
    }
    /*
     * Issue #209: a folder holding a single mergeable note has nothing to merge INTO anything — the run
     * would just reproduce that note under the folder's name — and a folder holding none has nothing at
     * all, so the command is not offered in either case. The count goes through the very predicate
     * `executeFolder` collects with, so the menu and the executor cannot disagree about what counts as a
     * note (same discipline as `FlattenFolderCommandHandler`, issue #185), and it stops at the threshold
     * rather than walking a large subtree to learn a fact two notes already settle.
     */
    return countMergeableNotes(folder, (file) => this.isMergeableNote(file), MIN_MERGEABLE_NOTE_COUNT) >= MIN_MERGEABLE_NOTE_COUNT;
  }

  protected override async executeFolder(folder: TFolder): Promise<void> {
    if (this.pluginSettingsComponent.settings.isPathIgnored(folder.path)) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot merge folder ');
          f.append(await renderInternalLink({ app: this.app, pathOrAbstractFile: folder }));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }

    const { settings } = this.pluginSettingsComponent;
    const mergeItems = collectMergeItemsDepthFirst(folder, (file) => this.isMergeableNote(file));
    const sourceMdFiles = mergeItems.filter(isFile);

    if (sourceMdFiles.length === 0) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('Folder ');
          f.append(await renderInternalLink({ app: this.app, pathOrAbstractFile: folder }));
          f.appendText(' has no markdown notes to merge.');
        })
      );
      return;
    }

    const targetPaths = await this.resolveTargetPaths(folder, sourceMdFiles);
    if (!targetPaths) {
      return;
    }
    const { pathToCreate, targetPath } = targetPaths;

    // Snapshotted before the merge: the folders are what they are now, and the merge only empties them.
    const folderPathsToCleanUp = collectFolderPathsDeepestFirst(folder);

    const targetFile = await this.app.vault.create(pathToCreate, '');

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

    // Issue #186: the merged-away note has released the configured path, so claim it. Guarded on the path
    // Actually being free, because the merge may have been partial - an ignored note is never merged away and
    // Keeps its name. The adapter is asked rather than the vault index, because the index is what the merge
    // Has just been mutating and it is the filesystem that decides whether the rename can land.
    if (targetFile.path !== targetPath && !await this.app.vault.adapter.exists(targetPath)) {
      await this.app.fileManager.renameFile(targetFile, targetPath);
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

    /*
     * Issue #212: the merged note is what the command produced, so the user can be put in it. LAST, and
     * deliberately so — after the issue-#186 rename (the note is only now at the path the settings asked
     * for) and after the empty folders are gone (so the explorer is not still reshuffling around it). Every
     * unhappy path returned above, which is what keeps this to the ONE open the setting promises: a
     * cancelled or nothing-merged run never reaches here, and the per-note merges inside the transaction are
     * constructed with `shouldOpenAfterMerge: false` for issue #106.
     */
    if (settings.shouldOpenNoteAfterMergingFolderIntoFile) {
      await openFileAfterOperation({ app: this.app, file: targetFile });
    }
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
   * Whether a file is one of the notes this merge would concatenate, as opposed to an attachment that
   * merely travels with them. Markdown-shaped attachments (an Excalidraw drawing is a `.md` file) are
   * never merged: their raw payload would land in the merged note. They are relocated with the other
   * attachments instead.
   *
   * The ONE definition, shared by `canExecuteFolder`'s count and `executeFolder`'s walk, so whether the
   * command is offered and what it would actually merge cannot drift apart.
   *
   * @param file - The file to classify.
   * @returns Whether the file is a note to merge.
   */
  private isMergeableNote(file: TFile): boolean {
    return isMarkdownFile(file)
      && !isTreatedAsAttachment({ attachmentExtensions: this.pluginSettingsComponent.settings.attachmentExtensions, pathOrFile: file });
  }

  /**
   * Resolves where the merged note WANTS to live, named by {@link resolveTargetBasename}. De-duplication
   * against what is already there (issue #178) is the caller's job, because whether a clash is real depends
   * on whether the occupying note is itself being merged away (issue #186).
   *
   * The `BesideFolder` prefix is sliced off `folder.path` rather than rebuilt from the parent folder,
   * which keeps it correct when the folder sits at the vault root. `DefaultNewNoteLocation` goes through
   * `fileManager.getNewFileParent`, so it honours Obsidian's own `Default location for new notes`
   * including its `Same folder as current file` mode — the same resolution
   * `shouldSplitRecursivelyIntoDefaultNewNoteFolder` uses.
   *
   * @param folder - The folder being merged.
   * @returns The path the merged note should end up at.
   */
  private async resolveDesiredTargetPath(folder: TFolder, targetParentFolder: null | TFolder): Promise<string> {
    const fileName = `${await this.resolveTargetBasename(folder)}.md`;
    const parentPath = targetParentFolder
      // Matches the `BesideFolder` branch's contract: the vault root is the empty string, not `/`.
      ? (targetParentFolder.isRoot() ? '' : targetParentFolder.path)
      : this.resolveTargetParentPath(folder, fileName);
    return join(parentPath, fileName);
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
  private async resolveTargetBasename(folder: TFolder): Promise<string> {
    const { settings } = this.pluginSettingsComponent;
    const template = settings.mergeFolderIntoFileNoteNameTemplate;
    if (!template) {
      return folder.name;
    }

    const resolved = resolveFolderTemplateTokens({ sourceFolder: folder, template });
    const noteName = trimEnd({ $string: resolved.trim(), suffix: '.md' }).trim();
    if (!noteName) {
      return folder.name;
    }

    // A folder merge has no note of its own to offer Templater as context (issue #196), so the
    // `Name transform template` falls back to whatever note is open.
    const fixedNoteName = await transformAndFixFileName({
      app: this.app,
      contextFile: null,
      fileName: noteName,
      nameTransformTemplate: settings.nameTransformTemplate,
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
   * Resolves the folder the merged note is created in, per the `Merge folder into file location` setting.
   *
   * @param folder - The folder being merged.
   * @param fileName - The note's file name, which Obsidian's new-file resolution takes into account.
   * @returns The parent folder's path, or an empty string for the vault root.
   */
  private resolveTargetParentPath(folder: TFolder, fileName: string): string {
    switch (this.pluginSettingsComponent.settings.mergeFolderIntoFileLocation) {
      case MergeFolderIntoFileLocation.DefaultNewNoteLocation: {
        return this.app.fileManager.getNewFileParent(folder.path, fileName).path;
      }
      case MergeFolderIntoFileLocation.InsideFolder: {
        return folder.path;
      }
      default: {
        return folder.path.slice(0, Math.max(0, folder.path.length - folder.name.length - 1));
      }
    }
  }

  /**
   * Runs the confirmation dialog and, whenever it comes back with "Change target", the destination picker —
   * looping until the user confirms a destination or cancels (issue #205).
   *
   * The loop is INVERTED relative to the picker-first flows (merge-file/move/swap): the merged note's
   * location is DERIVED from the `Merge folder into file location` setting, so the picker must not run
   * first. A picked folder overrides that setting FOR THIS RUN ONLY — nothing is persisted, because the
   * user is redirecting one merge, not reconfiguring the command.
   *
   * Both paths are recomputed each pass, including the issue-#186 "the occupying note is itself being
   * merged away" branch: whether the desired name is free depends on the folder it is being asked for.
   *
   * Cancelling the picker returns to the same dialog with the destination unchanged, rather than abandoning
   * the merge.
   *
   * @param folder - The folder being merged.
   * @param sourceMdFiles - The notes being merged away.
   * @returns The path to create the note at and the path it should end up at, or `null` when cancelled.
   */
  private async resolveTargetPaths(folder: TFolder, sourceMdFiles: readonly TFile[]): Promise<MergeFolderIntoFileTargetPaths | null> {
    let targetParentFolder: null | TFolder = null;
    for (;;) {
      let desiredPath: string;
      try {
        desiredPath = await this.resolveDesiredTargetPath(folder, targetParentFolder);
      } catch (error) {
        /*
         * A refused `Name transform template` is a configuration problem, so it is reported and the merge
         * abandoned before anything is created — the note name is the FIRST thing this flow needs, so there
         * is nothing to undo. Only that type is caught; anything else is a genuine bug (issue #203).
         */
        if (!(error instanceof NameTransformError)) {
          throw error;
        }
        this.pluginNoticeComponent.showNotice(error.message);
        return null;
      }

      // Issue #186: the note occupying the configured path may be one of the notes being merged, in which case it
      // Is gone by the time the merge finishes and the configured name is free after all. The note still has to be
      // CREATED somewhere else (the path is occupied right now), so it is created de-duplicated and renamed at the
      // End. A clash with a note that is NOT being merged is a real one and keeps its de-duplicated name.
      const pathToCreate = getAvailablePath(this.app, desiredPath);
      const isDesiredPathFreedByMerge = pathToCreate !== desiredPath && sourceMdFiles.some((file) => file.path === desiredPath);
      const targetPath = isDesiredPathFreedByMerge ? desiredPath : pathToCreate;

      const confirmResult = await confirmMergeFolderIntoFile({
        app: this.app,
        noteCount: sourceMdFiles.length,
        pluginSettingsComponent: this.pluginSettingsComponent,
        sourceFolder: folder,
        targetPath
      });
      if (confirmResult === 'reselect-target') {
        const selectedFolder = await selectFolder({
          app: this.app,
          isAllowedFolder: (candidateFolder) => !this.pluginSettingsComponent.settings.isPathIgnored(candidateFolder.path),
          placeholder: 'Select folder for the merged note...',
          pluginSettingsComponent: this.pluginSettingsComponent
        });
        if (selectedFolder) {
          targetParentFolder = selectedFolder;
        }
        continue;
      }
      if (confirmResult === 'cancelled') {
        return null;
      }
      return { pathToCreate, targetPath };
    }
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
  return [...folderPaths].sort((a, b) => getDepth(b) - getDepth(a) || compareNatural(b, a));
}

/**
 * Walks the folder in folder-grouped depth-first order — a folder's own mergeable notes first, then each
 * sub-folder followed by its whole subtree. A flat sort by path would interleave a sub-folder's notes with
 * the root's own ones (`sub/z.md` sorts before `zeta.md`), which would re-enter a folder and make the
 * folder-heading plan emit its heading more than once.
 *
 * Each half is ordered by {@link compareNatural}, so a numbered tree merges in its own index order rather
 * than in text order, which put `30.` before `5.` (issue #208).
 *
 * The sub-folders themselves are part of the result, not just their notes: the heading plan needs them to
 * head a folder that holds no notes at all, which no note path can reveal (issue #168). The notes to merge
 * are the walk's files, in the same order. Which sub-folders make it in is decided by
 * {@link shouldHeadSubFolder} — being in the walk IS getting a heading.
 *
 * @param folder - The folder to walk.
 * @param isMergeableNote - Whether a file is one of the notes to merge (as opposed to an attachment).
 * @returns The descendant folders and mergeable notes, in merge order.
 */
function collectMergeItemsDepthFirst(folder: TFolder, isMergeableNote: (file: TFile) => boolean): (TFile | TFolder)[] {
  const notes = folder.children
    .filter(isFile)
    .filter((child) => isMergeableNote(child))
    .sort((a, b) => compareNatural(a.name, b.name));
  const subFolders = folder.children
    .filter(isFolder)
    // A rejected folder takes its whole subtree with it: the `flatMap` below never recurses into it.
    .filter((subFolder) => shouldHeadSubFolder(subFolder, isMergeableNote))
    .sort((a, b) => compareNatural(a.name, b.name));
  return [...notes, ...subFolders.flatMap((subFolder) => [subFolder, ...collectMergeItemsDepthFirst(subFolder, isMergeableNote)])];
}

/**
 * Counts the mergeable notes under a folder, at any depth, stopping as soon as `limit` of them have been
 * seen (issue #209). The cap is what makes this affordable in `canExecuteFolder`, which Obsidian runs
 * synchronously on every folder-menu open and every `checkCallback` pass: the question is only ever
 * "are there at least two", so a 5000-note folder must not be walked to answer it.
 *
 * Hand-rolled rather than `Vault.recurseChildren`, which visits the whole subtree with no way to break.
 * The folder's own notes are counted first — a sub-folder is only descended into once they have not
 * settled it.
 *
 * @param folder - The folder to walk.
 * @param isMergeableNote - Whether a file is one of the notes to merge (as opposed to an attachment).
 * @param limit - The count to stop at.
 * @returns The number of mergeable notes found, which stops growing once it reaches `limit`.
 */
function countMergeableNotes(folder: TFolder, isMergeableNote: (file: TFile) => boolean, limit: number): number {
  let count = folder.children.filter(isFile).filter((file) => isMergeableNote(file)).length;
  if (count >= limit) {
    return count;
  }

  // Resolved only once the folder's own notes have failed to settle it, so a folder that already holds
  // Two of them never pays for the array.
  const subFolders = folder.children.filter(isFolder);
  for (const subFolder of subFolders) {
    count += countMergeableNotes(subFolder, isMergeableNote, limit - count);
    if (count >= limit) {
      return count;
    }
  }
  return count;
}

function getDepth(folderPath: string): number {
  return folderPath.split('/').length;
}

/**
 * Whether a sub-folder belongs in the walk at all — which, since {@link buildFolderHeadingPlan} heads every
 * folder it is given, is the same question as whether it earns a heading. A folder that holds no mergeable
 * note anywhere beneath it is one of two very different things, and issues #168 and #181 are the two sides
 * of the distinction:
 *
 * - **completely empty** (no files anywhere in the subtree) → kept, so the merged outline still mirrors the
 *   whole folder tree (issue #168);
 * - **holds files but no mergeable note** — an attachment folder — → dropped, together with its whole
 *   subtree (issue #181): heading a folder whose entire content was never merged is noise, and it is
 *   usually about to be deleted anyway, since `shouldMoveAttachmentsWhenMergingFolder` relocates those
 *   attachments and `cleanupEmptyFolders` then removes the emptied folder. The subtree goes with it rather
 *   than being classified on its own — an empty folder inside an attachment folder would otherwise be
 *   headed at its own depth with no parent heading above it, which is worse than losing it.
 *
 * A third case is deliberately NOT decided here: a folder whose notes exist but are ALL excluded in the
 * settings is planned normally and dropped later by `mergeFilesIntoSingleFile`, which flushes a pending
 * heading only once a source actually reaches the merge.
 *
 * Dropping a folder cannot drop a note: a rejected subtree holds no mergeable note by definition, so
 * `sourceMdFiles` — the walk's files — is the same either way. With the heading setting off the plan is
 * never built, so this only ever affects the headings.
 *
 * @param folder - The sub-folder to classify.
 * @param isMergeableNote - Whether a file is one of the notes to merge (as opposed to an attachment).
 * @returns Whether the folder (and its subtree) stays in the walk.
 */
function shouldHeadSubFolder(folder: TFolder, isMergeableNote: (file: TFile) => boolean): boolean {
  const files: TFile[] = [];
  Vault.recurseChildren(folder, (child) => {
    if (isFile(child)) {
      files.push(child);
    }
  });
  return files.length === 0 || files.some((file) => isMergeableNote(file));
}
