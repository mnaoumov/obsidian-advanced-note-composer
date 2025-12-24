import type {
  TFolder,
  WorkspaceLeaf
} from 'obsidian';

import { Notice } from 'obsidian';
import { appendCodeBlock } from 'obsidian-dev-utils/HTMLElement';
import {
  FolderCommandBase,
  FolderCommandInvocationBase
} from 'obsidian-dev-utils/obsidian/Commands/FolderCommandBase';
import {
  getAbstractFileOrNull,
  isFile,
  isFolder,
  isMarkdownFile
} from 'obsidian-dev-utils/obsidian/FileSystem';
import { renameSafe } from 'obsidian-dev-utils/obsidian/Vault';
import { deleteSafe } from 'obsidian-dev-utils/obsidian/VaultEx';
import {
  basename,
  extname,
  join
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
    const isCaseInsensitive = this.app.vault.adapter.insensitive;
    for (const child of sourceFolder.children) {
      let targetChildPath = join(targetFolder.path, child.name);
      let targetChild = getAbstractFileOrNull(this.app, targetChildPath, isCaseInsensitive);
      if (targetChild && ((isFile(targetChild) && !isMarkdownFile(this.app, targetChild)) || isFile(targetChild) !== isFile(child))) {
        const extension = extname(child.name);
        const baseName = basename(child.name, extension);
        targetChildPath = this.app.vault.getAvailablePath(join(targetFolder.path, baseName), extension.slice(1));
        targetChild = null;
      }

      if (targetChild) {
        if (isFile(child) && isFile(targetChild)) {
          const advancedNoteComposer = new AdvancedNoteComposer(this.plugin, child);
          await advancedNoteComposer.selectItem(
            {
              file: targetChild,
              match: { matches: [], score: 0 },
              type: 'file'
            },
            false,
            ''
          );
          await advancedNoteComposer.mergeFile(false);
        } else if (isFolder(child) && isFolder(targetChild)) {
          await this.mergeFolderImpl(child, targetChild);
        }
      } else if (isFile(child)) {
        await renameSafe(this.app, child, targetChildPath);
      } else if (isFolder(child)) {
        const targetChildFolder = await this.app.vault.createFolder(targetChildPath);
        await this.mergeFolderImpl(child, targetChildFolder);
      }
    }

    await deleteSafe(this.app, sourceFolder, undefined, false, true);
  }
}
