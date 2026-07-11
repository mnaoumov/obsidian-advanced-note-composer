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
  exists,
  FileSystemType,
  isFile,
  isFolder,
  isMarkdownFile
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

import { MergeComposer } from '../composers/merge-composer.ts';
import { runLockedTransaction } from '../locked-transaction.ts';
import { selectTargetFolderForMergeFolder } from '../modals/merge-folder-modal.ts';

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
    return !folder.isRoot();
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

  private async mergeFolder(params: MergeFolderCommandHandlerMergeFolderParams): Promise<void> {
    const { sourceFolder, targetFolder } = params;
    const notice = this.pluginNoticeComponent.showNotice(
      await createFragmentAsync(async (f) => {
        f.appendText('Advanced Note Composer: Merging folder ');
        f.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: sourceFolder.path }));
        f.appendText(' with ');
        f.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: targetFolder.path }));
        f.createEl('br');
        f.createEl('br');
        f.createDiv('is-loading');
      }),
      {
        isPermanent: true
      }
    );

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
        resourceLockComponent: this.resourceLockComponent
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        // The operation was cancelled (user or external change); the transaction has rolled back.
        return;
      }
      throw error;
    } finally {
      notice.hide();
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
      if (isMarkdownFile(child)) {
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

    for (const sourceMdFile of sourceMdFiles) {
      this.throwIfAborted(abortController);
      /* v8 ignore start -- defensive ?? on parent?.path and Map.get(). */
      const targetParentFolderPath = subfoldersMap.get(sourceMdFile.parent?.path ?? '') ?? '';
      /* v8 ignore stop */
      const targetMdFilePath = join(targetParentFolderPath, sourceMdFile.name);
      const isNewTargetFile = !exists({ app: this.app, path: targetMdFilePath, type: FileSystemType.File });
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
        shouldShowNotice: false,
        sourceFile: sourceMdFile,
        targetFile: targetMdFile,
        vaultTransaction
      });
      await composer.mergeFile();
    }

    for (const sourceOtherFile of sourceOtherFiles) {
      this.throwIfAborted(abortController);
      /* v8 ignore start -- defensive ?? on parent?.path and Map.get(). */
      const targetParentFolderPath = subfoldersMap.get(sourceOtherFile.parent?.path ?? '') ?? '';
      /* v8 ignore stop */
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
