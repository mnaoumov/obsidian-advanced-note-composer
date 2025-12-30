import type {
  TAbstractFile,
  TFile,
  TFolder,
  WorkspaceLeaf
} from 'obsidian';

import {
  Notice,
  Vault
} from 'obsidian';
import { appendCodeBlock } from 'obsidian-dev-utils/HTMLElement';
import {
  FolderCommandBase,
  FolderCommandInvocationBase
} from 'obsidian-dev-utils/obsidian/Commands/FolderCommandBase';
import {
  isFile,
  isFolder,
  isMarkdownFile
} from 'obsidian-dev-utils/obsidian/FileSystem';
import {
  getAvailablePath,
  getOrCreateFileSafe,
  getOrCreateFolderSafe,
  isChildOrSelf,
  renameSafe
} from 'obsidian-dev-utils/obsidian/Vault';
import {
  join,
  relative
} from 'obsidian-dev-utils/Path';

import type { Plugin } from '../Plugin.ts';

import { AdvancedNoteComposer } from '../AdvancedNoteComposer.ts';
import { MergeFolderModal } from '../Modals/MergeFolderModal.ts';

export class MergeFolderCommand extends FolderCommandBase<Plugin> {
  protected override readonly fileMenuItemName = 'Advanced merge entire folder with...';

  public constructor(plugin: Plugin) {
    super({
      icon: 'merge',
      id: 'merge-folder',
      name: 'Merge current folder with another folder...',
      plugin
    });
  }

  protected override createCommandInvocationForFolder(folder: null | TFolder): FolderCommandInvocationBase<Plugin> {
    return new MergeFolderCommandInvocation(this.plugin, folder);
  }

  protected override shouldAddToFolderMenu(_folder: TFolder, _source: string, _leaf?: WorkspaceLeaf): boolean {
    return true;
  }
}

export class MergeFolderCommandInvocation extends FolderCommandInvocationBase<Plugin> {
  public constructor(plugin: Plugin, folder: null | TFolder) {
    super(plugin, folder);
  }

  protected override async execute(): Promise<void> {
    const modal = new MergeFolderModal(this.app, this.folder, this.mergeFolder.bind(this));
    modal.open();
  }

  private depth(file: TAbstractFile): number {
    return file.path.split('/').length;
  }

  private async mergeFolder(targetFolder: TFolder): Promise<void> {
    const notice = new Notice(
      createFragment((f) => {
        f.appendText('Advanced Note Composer: Merging folder ');
        appendCodeBlock(f, this.folder.path);
        f.appendText(' with ');
        appendCodeBlock(f, targetFolder.path);
        f.createEl('br');
        f.createEl('br');
        f.createDiv('is-loading');
      }),
      0
    );

    try {
      await this.mergeFolderImpl(this.folder, targetFolder);
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
      if (isMarkdownFile(this.app, child)) {
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
      const targetParentFolderPath = subfoldersMap.get(sourceMdFile.parent?.path ?? '') ?? '';
      const targetMdFilePath = join(targetParentFolderPath, sourceMdFile.name);
      const targetMdFile = await getOrCreateFileSafe(this.app, targetMdFilePath);
      const advancedNoteComposer = new AdvancedNoteComposer(this.plugin, sourceMdFile);
      advancedNoteComposer.shouldShowNotice = false;
      await advancedNoteComposer.selectItem(
        {
          file: targetMdFile,
          match: { matches: [], score: 0 },
          type: 'file'
        },
        false,
        ''
      );
      await advancedNoteComposer.mergeFile(false);
    }

    for (const sourceOtherFile of sourceOtherFiles) {
      const targetParentFolderPath = subfoldersMap.get(sourceOtherFile.parent?.path ?? '') ?? '';
      let targetFilePath = join(targetParentFolderPath, sourceOtherFile.name);
      targetFilePath = getAvailablePath(this.app, targetFilePath);
      await renameSafe(this.app, sourceOtherFile, targetFilePath);
    }

    for (const sourceSubfolder of [...sourceSubfolders, sourceFolder]) {
      if (sourceSubfolder.children.length === 0 && !isChildOrSelf(this.app, sourceSubfolder, targetFolder)) {
        try {
          await this.app.fileManager.trashFile(sourceSubfolder);
        } catch {
          // Ignore errors
        }
      }
    }

    if (!this.plugin.settings.shouldRunTemplaterOnDestinationFile) {
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
