import type {
  App,
  TAbstractFile,
  TFile,
  TFolder
} from 'obsidian';
import type { FolderCommandHandlerShouldAddToFolderMenuParams } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';
import type { VaultTransaction } from 'obsidian-dev-utils/obsidian/vault-transaction';

import { Vault } from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { FolderCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import {
  doesExist,
  FileSystemType,
  isFile,
  isFolder,
  isMarkdownFile,
  isTreatedAsAttachment
} from 'obsidian-dev-utils/obsidian/file-system';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import {
  getAvailablePath,
  getOrCreateFileSafe,
  isChildOrSelf
} from 'obsidian-dev-utils/obsidian/vault';
import {
  join,
  relative
} from 'obsidian-dev-utils/path';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { isFileOrFolderCommandBlocked } from '../command-block.ts';
import { MergeComposer } from '../composers/merge-composer.ts';
import { runLockedTransaction } from '../locked-transaction.ts';
import { selectTargetFolderForMergeFolder } from '../modals/merge-folder-modal.ts';
import { compareNatural } from '../natural-sort.ts';
import { openFileAfterOperation } from '../open-after-operation.ts';
import {
  buildOperationNoticeContent,
  showOperationCompletionNotice,
  showOperationPermanentProgressNotice
} from '../operation-notices.ts';
import { CommandCategory } from '../plugin-settings.ts';
import { recordRecentTarget } from '../recent-targets.ts';

interface MergeFolderCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

interface MergeFolderCommandHandlerMergeFolderImplParams {
  readonly abortController: AbortController;
  readonly sourceFolder: TFolder;
  readonly targetFolder: TFolder;
  readonly vaultTransaction: VaultTransaction;
}

interface MergeFolderCommandHandlerMergeFolderParams {
  readonly sourceFolder: TFolder;
  readonly targetFolder: TFolder;
}

interface MergeFolderCommandHandlerMergeMarkdownFilesParams {
  readonly abortController: AbortController;

  /**
   * Accumulator: source files skipped because their source/target path is ignored are pushed here.
   */
  readonly ignoredSourceFiles: TFile[];
  readonly sourceMdFiles: TFile[];
  readonly subfoldersMap: Map<string, string>;
  readonly vaultTransaction: VaultTransaction;
}

export class MergeFolderCommandHandler extends FolderCommandHandler {
  private readonly app: App;
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: MergeFolderCommandHandlerConstructorParams) {
    super({
      fileMenuItemName: 'Merge entire folder with...',
      fileMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'merge',
      id: 'merge-folder',
      name: 'Merge current folder with another folder...'
    });

    this.app = params.app;
    this.consoleDebugComponent = params.consoleDebugComponent;
    this.resourceLockComponent = params.resourceLockComponent;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  protected override canExecuteFolder(folder: TFolder): boolean {
    super.canExecuteFolder(folder);
    return !folder.isRoot() && !isFileOrFolderCommandBlocked({ abstractFile: folder, commandCategory: CommandCategory.Merge, pluginSettingsComponent: this.pluginSettingsComponent });
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
    const targetFolder = await selectTargetFolderForMergeFolder({
      app: this.app,
      pluginSettingsComponent: this.pluginSettingsComponent,
      sourceFolder: folder
    });
    if (targetFolder) {
      await this.mergeFolder({ sourceFolder: folder, targetFolder });
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

  private depth(file: TAbstractFile): number {
    return file.path.split('/').length;
  }

  /**
   * Whether a file is one of the notes this merge would concatenate, as opposed to a file that merely
   * travels with them. A markdown-shaped attachment (an Excalidraw drawing is a `.md` file) is moved like
   * any other attachment, never merged: merging it into a same-named drawing in the destination would
   * concatenate two raw payloads (issue #160 item 3, issue #161).
   *
   * The ONE definition, shared by the source walk and by {@link findFirstNote}'s search of the destination
   * (issue #215), so what the merge treats as a note and what the post-merge open would land in cannot
   * drift apart. Mirrors `MergeFolderIntoFileCommandHandler.isMergeableNote`.
   *
   * @param file - The file to classify.
   * @returns Whether the file is a note to merge.
   */
  private isMergeableNote(file: TFile): boolean {
    return isMarkdownFile(file)
      && !isTreatedAsAttachment({ attachmentExtensions: this.pluginSettingsComponent.settings.attachmentExtensions, pathOrFile: file });
  }

  private isMergeIgnored(sourcePath: string, targetPath: string): boolean {
    const { settings } = this.pluginSettingsComponent;
    // When the user opts in, excluded/ignored items are merged too (issue #150), so nothing is skipped
    // And no "ignored" notice is shown for them.
    if (settings.shouldAlwaysMergeExcludedItems) {
      return false;
    }
    if (settings.isPathIgnored(sourcePath)) {
      return true;
    }
    // A target path here is the SOURCE ITEM'S OWN PATH mirrored under the destination folder, so it is
    // Excluded mostly when the destination itself is — and that destination is one the picker was allowed
    // To offer since issue #253. Skipping every item would silently undo the pick, so the setting that
    // Offered it clears this half too.
    return !settings.shouldOfferExcludedPathsAsMergeDestinations && settings.isPathIgnored(targetPath);
  }

  private async mergeFolder(params: MergeFolderCommandHandlerMergeFolderParams): Promise<void> {
    const { sourceFolder, targetFolder } = params;
    const notice = showOperationPermanentProgressNotice({
      content: await createFragmentAsync(async (f) => {
        f.appendText('Advanced Note Composer: Merging folder ');
        f.append(await renderInternalLink({ app: this.app, pathOrAbstractFile: sourceFolder.path }));
        f.appendText(' with ');
        f.append(await renderInternalLink({ app: this.app, pathOrAbstractFile: targetFolder.path }));
        f.createEl('br');
        f.createEl('br');
        f.createDiv('is-loading');
      }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });

    const abortController = new AbortController();
    try {
      await runLockedTransaction({
        abortController,
        app: this.app,
        body: async (vaultTransaction) => {
          await this.mergeFolderImpl({ abortController, sourceFolder, targetFolder, vaultTransaction });
        },
        lockTargets: [
          { mode: 'subtree', pathOrFile: sourceFolder.path },
          { mode: 'subtree', pathOrFile: targetFolder.path }
        ],
        operationName: 'Merge folder',
        resourceLockComponent: this.resourceLockComponent
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        // The operation was cancelled (user or external change); the transaction has rolled back.
        return;
      }
      throw error;
    } finally {
      notice?.hide();
    }

    // The merge landed, so the folder it merged into counts as clicked-on for the next picker (issue
    // #206). Recorded here rather than by the per-note merges inside the transaction: those run on an
    // Injected transaction that can still roll back, and the folder is what the user chose.
    recordRecentTarget(targetFolder);

    // The source folder is gone by now (its emptied sub-folders are trashed), so it is named as plain
    // Text — an unresolved link to it would create a note at that path when clicked.
    showOperationCompletionNotice({
      content: await buildOperationNoticeContent({
        app: this.app,
        pluginSettingsComponent: this.pluginSettingsComponent,
        preposition: 'with',
        shouldLinkSource: false,
        sourcePathOrAbstractFile: sourceFolder.path,
        targetPathOrAbstractFile: targetFolder.path,
        verb: 'Merged folder'
      }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });

    /*
     * Issue #215: land the user in the folder the merge produced. ONE open, after the transaction has
     * committed — the per-note merges inside it are constructed with `shouldOpenAfterMerge: false`, which is
     * the issue-#106 fix, and this must not become a second way to flicker the active tab. An aborted merge
     * returned above, so this is only ever reached by a merge that landed; a destination holding no note at
     * all (an attachment-only merge) opens nothing rather than failing.
     */
    if (this.pluginSettingsComponent.settings.shouldOpenFirstNoteAfterMergingFolder) {
      const firstNote = findFirstNote(targetFolder, (file) => this.isMergeableNote(file));
      if (firstNote) {
        await openFileAfterOperation({ app: this.app, file: firstNote });
      }
    }
  }

  private async mergeFolderImpl(params: MergeFolderCommandHandlerMergeFolderImplParams): Promise<void> {
    const { abortController, sourceFolder, targetFolder, vaultTransaction } = params;
    const sourceSubfolders: TFolder[] = [];
    const sourceMdFiles: TFile[] = [];
    const sourceOtherFiles: TFile[] = [];

    Vault.recurseChildren(sourceFolder, (child) => {
      if (isFolder(child)) {
        sourceSubfolders.push(child);
        return;
      }
      if (!isFile(child)) {
        return;
      }
      if (this.isMergeableNote(child)) {
        sourceMdFiles.push(child);
        return;
      }
      sourceOtherFiles.push(child);
    });

    /* v8 ignore start -- sort comparator is only called with 2+ subfolders. */
    sourceSubfolders.sort((a, b) => this.depth(b) - this.depth(a));
    /* v8 ignore stop */
    const subfoldersMap = new Map<string, string>();

    for (const sourceSubfolder of sourceSubfolders) {
      const relativePath = relative(sourceFolder.path, sourceSubfolder.path);
      const targetSubfolderPath = join(targetFolder.path, relativePath);
      await vaultTransaction.createFolder(targetSubfolderPath);
      subfoldersMap.set(sourceSubfolder.path, targetSubfolderPath);
    }

    if (isChildOrSelf({ app: this.app, childPathOrFile: sourceFolder, parentPathOrFile: targetFolder })) {
      sourceMdFiles.sort((a, b) => this.depth(a) - this.depth(b));
    }

    if (isChildOrSelf({ app: this.app, childPathOrFile: targetFolder, parentPathOrFile: sourceFolder })) {
      sourceMdFiles.sort((a, b) => this.depth(b) - this.depth(a));
    }

    // Files whose source or mapped-target path is ignored in the plugin settings are skipped entirely
    // (issue #72): the empty target file is never created, and they are reported afterwards.
    const ignoredSourceFiles: TFile[] = [];

    await this.mergeMarkdownFiles({ abortController, ignoredSourceFiles, sourceMdFiles, subfoldersMap, vaultTransaction });

    for (const sourceOtherFile of sourceOtherFiles) {
      this.throwIfAborted(abortController);
      /* v8 ignore start -- defensive ?? on parent?.path and Map.get(). */
      const targetParentFolderPath = subfoldersMap.get(sourceOtherFile.parent?.path ?? '') ?? '';
      /* v8 ignore stop */
      if (this.isMergeIgnored(sourceOtherFile.path, join(targetParentFolderPath, sourceOtherFile.name))) {
        ignoredSourceFiles.push(sourceOtherFile);
        continue;
      }
      const targetFilePath = getAvailablePath(this.app, join(targetParentFolderPath, sourceOtherFile.name));
      await vaultTransaction.rename(sourceOtherFile, targetFilePath);
    }

    for (const sourceSubfolder of sourceSubfolders) {
      this.throwIfAborted(abortController);
      if (sourceSubfolder.children.length > 0) {
        continue;
      }
      let canDeleteSourceFolder = true;
      for (const targetFolderPath of subfoldersMap.values()) {
        if (isChildOrSelf({ app: this.app, childPathOrFile: targetFolderPath, parentPathOrFile: sourceSubfolder })) {
          canDeleteSourceFolder = false;
          break;
        }
      }
      if (!canDeleteSourceFolder) {
        continue;
      }
      await vaultTransaction.trash(sourceSubfolder);
    }

    await this.showIgnoredFilesNotice(ignoredSourceFiles);

    if (!this.pluginSettingsComponent.settings.shouldRunTemplaterOnDestinationFile) {
      return;
    }
    const templaterPlugin = this.app.plugins.plugins['templater-obsidian'];
    if (!templaterPlugin) {
      this.pluginNoticeComponent.showNotice(createFragment((f) => {
        f.appendText('Advanced Note Composer: You have enabled setting ');
        appendCodeBlock(f, 'Should run templater on destination file');
        f.appendText(', but Templater plugin is not installed.');
      }));
    }
  }

  private async mergeMarkdownFiles(params: MergeFolderCommandHandlerMergeMarkdownFilesParams): Promise<void> {
    const { abortController, ignoredSourceFiles, sourceMdFiles, subfoldersMap, vaultTransaction } = params;
    for (const sourceMdFile of sourceMdFiles) {
      this.throwIfAborted(abortController);
      /* v8 ignore start -- defensive ?? on parent?.path and Map.get(). */
      const targetParentFolderPath = subfoldersMap.get(sourceMdFile.parent?.path ?? '') ?? '';
      /* v8 ignore stop */
      const targetMdFilePath = join(targetParentFolderPath, sourceMdFile.name);
      if (this.isMergeIgnored(sourceMdFile.path, targetMdFilePath)) {
        ignoredSourceFiles.push(sourceMdFile);
        continue;
      }
      const isNewTargetFile = !doesExist({ app: this.app, path: targetMdFilePath, type: FileSystemType.File });
      const targetMdFile = isNewTargetFile
        ? await vaultTransaction.create(targetMdFilePath, '')
        : await getOrCreateFileSafe(this.app, targetMdFilePath);
      const composer = new MergeComposer({
        app: this.app,
        consoleDebugComponent: this.consoleDebugComponent,
        isNewTargetFile,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent: this.pluginSettingsComponent,
        resourceLockComponent: this.resourceLockComponent,
        // A folder merge must NOT open each merged note in turn — that per-file open is the "visual
        // Cycling" of issue #106 (the active tab flickers through every target note). The single-file
        // Merge keeps honoring the `shouldOpenNoteAfterMerge` setting; the batch suppresses it.
        // Mirrors {@link isMergeIgnored}: a target path here is a source item's own path under the
        // Destination, so either opting into merging excluded items (issue #150) or into an excluded
        // Destination (issue #253) has to let the composer write it.
        shouldMergeIgnoredTarget: this.pluginSettingsComponent.settings.shouldAlwaysMergeExcludedItems
          || this.pluginSettingsComponent.settings.shouldOfferExcludedPathsAsMergeDestinations,
        // Every non-note file of the folder is moved structurally below, mirroring the source layout, so
        // The per-note attachment relocation of a single-file merge would move them a second time.
        shouldMoveAttachments: false,
        shouldOpenAfterMerge: false,
        shouldShowNotice: false,
        sourceFile: sourceMdFile,
        targetFile: targetMdFile,
        vaultTransaction
      });
      await composer.mergeFile();
    }
  }

  private async showIgnoredFilesNotice(ignoredSourceFiles: TFile[]): Promise<void> {
    if (ignoredSourceFiles.length === 0) {
      return;
    }
    this.pluginNoticeComponent.showNotice(
      await createFragmentAsync(async (f) => {
        f.appendText(
          `Advanced Note Composer: ${String(ignoredSourceFiles.length)} file(s) were not merged because they are ignored in the plugin settings:`
        );
        for (const ignoredSourceFile of ignoredSourceFiles) {
          f.createEl('br');
          f.append(await renderInternalLink({ app: this.app, pathOrAbstractFile: ignoredSourceFile.path }));
        }
      })
    );
  }

  /**
   * Throws if the operation has been aborted (an external change to a locked path, or the user's
   * Unlock), so the enclosing {@link runLockedTransaction} rolls the spanning transaction back.
   *
   * @param abortController - The operation's abort controller.
   */
  private throwIfAborted(abortController: AbortController): void {
    if (abortController.signal.aborted) {
      throw new Error('Folder merge aborted.');
    }
  }
}

/**
 * The note a user reading the destination folder would see FIRST — what issue #215 asks to be opened once a
 * folder merge lands.
 *
 * Folder-grouped rather than a flat path sort, mirroring `collectMergeItemsDepthFirst` in
 * `merge-folder-into-file-command-handler.ts`: the folder's OWN notes come first, and a sub-folder is
 * descended into only once they have failed to produce one — which is how the file explorer presents a
 * folder, and a flat sort would let `sub/a.md` beat `zeta.md` sitting right there in the folder.
 *
 * Ordered by {@link compareNatural}, the same comparator the merge itself orders by (issue #208), so a
 * numbered folder opens at `5. …` rather than at `30. …`.
 *
 * The search covers the destination's PRE-EXISTING notes as well as the merged ones, deliberately: the ask
 * is about what appears first in the folder now, not about which note the merge happened to process first.
 *
 * @param folder - The destination folder.
 * @param isMergeableNote - Whether a file is a note as opposed to an attachment, so a markdown-shaped
 * attachment is never the file that opens.
 * @returns The first note, or `null` when the subtree holds none.
 */
function findFirstNote(folder: TFolder, isMergeableNote: (file: TFile) => boolean): null | TFile {
  const firstNote = folder.children
    .filter(isFile)
    .filter((child) => isMergeableNote(child))
    .sort((a, b) => compareNatural(a.name, b.name))[0];
  if (firstNote) {
    return firstNote;
  }

  const subFolders = folder.children
    .filter(isFolder)
    .sort((a, b) => compareNatural(a.name, b.name));
  for (const subFolder of subFolders) {
    const noteInSubFolder = findFirstNote(subFolder, isMergeableNote);
    if (noteInSubFolder) {
      return noteInSubFolder;
    }
  }

  return null;
}
