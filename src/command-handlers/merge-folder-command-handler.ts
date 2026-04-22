import type {
  TAbstractFile,
  TFile,
  TFolder
} from 'obsidian';

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

import type { Plugin } from '../plugin.ts';

import { MergeComposer } from '../composers/merge-composer.ts';
import { selectTargetFolderForMergeFolder } from '../modals/merge-folder-modal.ts';

export class MergeFolderCommandHandler extends FolderCommandHandler {
  protected override get shouldAddCommandToSubmenu(): boolean {
    return this.plugin.pluginSettings.shouldAddCommandsToSubmenu;
  }

  public constructor(private readonly plugin: Plugin) {
    super({
      fileMenuItemName: 'Merge entire folder with...',
      fileMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'merge',
      id: 'merge-folder',
      name: 'Merge current folder with another folder...',
      pluginName: plugin.manifest.name
    });
  }

  protected override canExecuteFolder(folder: TFolder): boolean {
    return !folder.isRoot();
  }

  protected override async executeFolder(folder: TFolder): Promise<void> {
    if (this.plugin.pluginSettings.isPathIgnored(folder.path)) {
      new Notice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot merge folder ');
          f.appendChild(await renderInternalLink(this.plugin.app, folder));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }
    const targetFolder = await selectTargetFolderForMergeFolder(this.plugin, folder);
    if (targetFolder) {
      await this.mergeFolder(folder, targetFolder);
    }
  }

  protected override shouldAddToFolderMenu(): boolean {
    return true;
  }

  private depth(file: TAbstractFile): number {
    return file.path.split('/').length;
  }

  private async mergeFolder(sourceFolder: TFolder, targetFolder: TFolder): Promise<void> {
    const notice = new Notice(
      await createFragmentAsync(async (f) => {
        f.appendText('Advanced Note Composer: Merging folder ');
        f.appendChild(await renderInternalLink(this.plugin.app, sourceFolder.path));
        f.appendText(' with ');
        f.appendChild(await renderInternalLink(this.plugin.app, targetFolder.path));
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
      if (isMarkdownFile(this.plugin.app, child)) {
        sourceMdFiles.push(child);
        return;
      }
      sourceOtherFiles.push(child);
    });

    sourceSubfolders.sort((a, b) => this.depth(b) - this.depth(a));
    const subfoldersMap = new Map<string, string>();

    for (const sourceSubfolder of sourceSubfolders) {
      const relativePath = relative(sourceFolder.path, sourceSubfolder.path);
      const targetSubfolderPath = join(targetFolder.path, relativePath);
      const targetSubfolder = await getOrCreateFolderSafe(this.plugin.app, targetSubfolderPath);
      subfoldersMap.set(sourceSubfolder.path, targetSubfolder.path);
    }

    if (isChildOrSelf(this.plugin.app, sourceFolder, targetFolder)) {
      sourceMdFiles.sort((a, b) => this.depth(a) - this.depth(b));
    }

    if (isChildOrSelf(this.plugin.app, targetFolder, sourceFolder)) {
      sourceMdFiles.sort((a, b) => this.depth(b) - this.depth(a));
    }

    for (const sourceMdFile of sourceMdFiles) {
      const targetParentFolderPath = subfoldersMap.get(sourceMdFile.parent?.path ?? '') ?? '';
      const targetMdFilePath = join(targetParentFolderPath, sourceMdFile.name);
      const isNewTargetFile = !exists(this.plugin.app, targetMdFilePath, FileSystemType.File);
      const targetMdFile = await getOrCreateFileSafe(this.plugin.app, targetMdFilePath);
      const composer = new MergeComposer({ isNewTargetFile, plugin: this.plugin, shouldShowNotice: false, sourceFile: sourceMdFile, targetFile: targetMdFile });
      await composer.mergeFile();
    }

    for (const sourceOtherFile of sourceOtherFiles) {
      const targetParentFolderPath = subfoldersMap.get(sourceOtherFile.parent?.path ?? '') ?? '';
      let targetFilePath = join(targetParentFolderPath, sourceOtherFile.name);
      targetFilePath = getAvailablePath(this.plugin.app, targetFilePath);
      await renameSafe(this.plugin.app, sourceOtherFile, targetFilePath);
    }

    for (const sourceSubfolder of sourceSubfolders) {
      if (sourceSubfolder.children.length > 0) {
        continue;
      }
      let canDeleteSourceFolder = true;
      for (const targetFolderPath of subfoldersMap.values()) {
        if (isChildOrSelf(this.plugin.app, targetFolderPath, sourceSubfolder)) {
          canDeleteSourceFolder = false;
          break;
        }
      }
      if (!canDeleteSourceFolder) {
        continue;
      }
      await trashSafe(this.plugin.app, sourceSubfolder);
    }

    if (!this.plugin.pluginSettings.shouldRunTemplaterOnDestinationFile) {
      return;
    }
    const templaterPlugin = this.plugin.app.plugins.plugins['templater-obsidian'];
    if (!templaterPlugin) {
      new Notice(createFragment((f) => {
        f.appendText('Advanced Note Composer: You have enabled setting ');
        appendCodeBlock(f, 'Should run templater on destination file');
        f.appendText(', but Templater plugin is not installed.');
      }));
    }
  }
}
