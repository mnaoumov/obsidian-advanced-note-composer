import type {
  App,
  TAbstractFile,
  TFile,
  TFolder,
  WorkspaceLeaf
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';

import {
  Notice,
  Vault
} from 'obsidian';
import {
  appendCodeBlock,
  createFragmentAsync
} from 'obsidian-dev-utils/html-element';
import { FolderCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import {
  exists,
  FileSystemType,
  isFile,
  isFolder,
  isMarkdownFile
} from 'obsidian-dev-utils/obsidian/file-system';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import {
  getAvailablePath,
  getOrCreateFileSafe,
  getOrCreateFolderSafe,
  isChildOrSelf,
  renameSafe,
  trashSafe
} from 'obsidian-dev-utils/obsidian/vault';
import {
  join,
  relative
} from 'obsidian-dev-utils/path';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { MergeComposer } from '../composers/merge-composer.ts';
import { selectTargetFolderForMergeFolder } from '../modals/merge-folder-modal.ts';

interface MergeFolderCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

export class MergeFolderCommandHandler extends FolderCommandHandler {
  private readonly app: App;
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

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
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  protected override canExecuteFolder(folder: TFolder): boolean {
    super.canExecuteFolder(folder);
    return !folder.isRoot();
  }

  protected override async executeFolder(folder: TFolder): Promise<void> {
    if (this.pluginSettingsComponent.settings.isPathIgnored(folder.path)) {
      new Notice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot merge folder ');
          f.appendChild(await renderInternalLink(this.app, folder));
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
      await this.mergeFolder(folder, targetFolder);
    }
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return super.shouldAddCommandToSubmenu() ?? this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  protected override shouldAddToFolderMenu(folder: TFolder, source: string, leaf?: WorkspaceLeaf): boolean {
    super.shouldAddToFolderMenu(folder, source, leaf);
    return true;
  }

  private depth(file: TAbstractFile): number {
    return file.path.split('/').length;
  }

  private async mergeFolder(sourceFolder: TFolder, targetFolder: TFolder): Promise<void> {
    const notice = new Notice(
      await createFragmentAsync(async (f) => {
        f.appendText('Advanced Note Composer: Merging folder ');
        f.appendChild(await renderInternalLink(this.app, sourceFolder.path));
        f.appendText(' with ');
        f.appendChild(await renderInternalLink(this.app, targetFolder.path));
        f.createEl('br');
        f.createEl('br');
        f.createDiv('is-loading');
      }),
      0
    );

    try {
      await this.mergeFolderImpl(sourceFolder, targetFolder);
    } finally {
      notice.hide();
    }
  }

  private async mergeFolderImpl(sourceFolder: TFolder, targetFolder: TFolder): Promise<void> {
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
      const targetSubfolder = await getOrCreateFolderSafe(this.app, targetSubfolderPath);
      subfoldersMap.set(sourceSubfolder.path, targetSubfolder.path);
    }

    if (isChildOrSelf(this.app, sourceFolder, targetFolder)) {
      sourceMdFiles.sort((a, b) => this.depth(a) - this.depth(b));
    }

    if (isChildOrSelf(this.app, targetFolder, sourceFolder)) {
      sourceMdFiles.sort((a, b) => this.depth(b) - this.depth(a));
    }

    for (const sourceMdFile of sourceMdFiles) {
      /* v8 ignore start -- defensive ?? on parent?.path and Map.get(). */
      const targetParentFolderPath = subfoldersMap.get(sourceMdFile.parent?.path ?? '') ?? '';
      /* v8 ignore stop */
      const targetMdFilePath = join(targetParentFolderPath, sourceMdFile.name);
      const isNewTargetFile = !exists(this.app, targetMdFilePath, FileSystemType.File);
      const targetMdFile = await getOrCreateFileSafe(this.app, targetMdFilePath);
      const composer = new MergeComposer({
        app: this.app,
        consoleDebugComponent: this.consoleDebugComponent,
        isNewTargetFile,
        pluginSettingsComponent: this.pluginSettingsComponent,
        shouldShowNotice: false,
        sourceFile: sourceMdFile,
        targetFile: targetMdFile
      });
      await composer.mergeFile();
    }

    for (const sourceOtherFile of sourceOtherFiles) {
      /* v8 ignore start -- defensive ?? on parent?.path and Map.get(). */
      const targetParentFolderPath = subfoldersMap.get(sourceOtherFile.parent?.path ?? '') ?? '';
      /* v8 ignore stop */
      let targetFilePath = join(targetParentFolderPath, sourceOtherFile.name);
      targetFilePath = getAvailablePath(this.app, targetFilePath);
      await renameSafe(this.app, sourceOtherFile, targetFilePath);
    }

    for (const sourceSubfolder of sourceSubfolders) {
      if (sourceSubfolder.children.length > 0) {
        continue;
      }
      let canDeleteSourceFolder = true;
      for (const targetFolderPath of subfoldersMap.values()) {
        if (isChildOrSelf(this.app, targetFolderPath, sourceSubfolder)) {
          canDeleteSourceFolder = false;
          break;
        }
      }
      if (!canDeleteSourceFolder) {
        continue;
      }
      await trashSafe(this.app, sourceSubfolder);
    }

    if (!this.pluginSettingsComponent.settings.shouldRunTemplaterOnDestinationFile) {
      return;
    }
    const templaterPlugin = this.app.plugins.plugins['templater-obsidian'];
    if (!templaterPlugin) {
      new Notice(createFragment((f) => {
        f.appendText('Advanced Note Composer: You have enabled setting ');
        appendCodeBlock(f, 'Should run templater on destination file');
        f.appendText(', but Templater plugin is not installed.');
      }));
    }
  }
}
