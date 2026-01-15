import type {
  IconName,
  TAbstractFile,
  TFile,
  TFolder,
  WorkspaceLeaf
} from 'obsidian';

import {
  Notice,
  Vault
} from 'obsidian';
import {
  appendCodeBlock,
  createFragmentAsync
} from 'obsidian-dev-utils/HTMLElement';
import {
  FolderCommandBase,
  FolderCommandInvocationBase
} from 'obsidian-dev-utils/obsidian/Commands/FolderCommandBase';
import {
  isFile,
  isFolder,
  isMarkdownFile
} from 'obsidian-dev-utils/obsidian/FileSystem';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/Markdown';
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

import { selectTargetFolderForMergeFolder } from '../Modals/MergeFolderModal.ts';
import { MergeComposer } from '../Composers/MergeComposer.ts';

export class MergeFolderCommand extends FolderCommandBase<Plugin> {
  protected override readonly fileMenuItemName = 'Merge entire folder with...';
  protected override readonly fileMenuSubmenuIcon: IconName = 'lucide-git-merge';

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
    if (this.plugin.settings.isPathIgnored(this.folder.path)) {
      new Notice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot merge folder ');
          f.appendChild(await renderInternalLink(this.app, this.folder));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }

    const targetFolder = await selectTargetFolderForMergeFolder(this.plugin, this.folder);
    if (targetFolder) {
      await this.mergeFolder(targetFolder);
    }
  }

  private depth(file: TAbstractFile): number {
    return file.path.split('/').length;
  }

  private async mergeFolder(targetFolder: TFolder): Promise<void> {
    const notice = new Notice(
      await createFragmentAsync(async (f) => {
        f.appendText('Advanced Note Composer: Merging folder ');
        f.appendChild(await renderInternalLink(this.app, this.folder.path));
        f.appendText(' with ');
        f.appendChild(await renderInternalLink(this.app, targetFolder.path));
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
      const advancedNoteComposer = new MergeComposer({
        plugin: this.plugin,
        sourceFile: sourceMdFile
      });
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
      await advancedNoteComposer.mergeFile();
    }

    for (const sourceOtherFile of sourceOtherFiles) {
      const targetParentFolderPath = subfoldersMap.get(sourceOtherFile.parent?.path ?? '') ?? '';
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

      await this.app.fileManager.trashFile(sourceSubfolder);
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
