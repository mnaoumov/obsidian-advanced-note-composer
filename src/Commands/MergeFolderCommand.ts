import type {
  TFolder,
  WorkspaceLeaf
} from 'obsidian';

import {
  FolderCommandBase,
  FolderCommandInvocationBase
} from 'obsidian-dev-utils/obsidian/Commands/FolderCommandBase';

import type { Plugin } from '../Plugin.ts';

export class MergeFolderCommand extends FolderCommandBase<Plugin> {
  public constructor(plugin: Plugin) {
    super({
      icon: 'merge',
      id: 'merge-folder',
      name: 'Merge Folder',
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
}
