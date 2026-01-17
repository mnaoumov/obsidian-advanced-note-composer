import {
  Notice,
  TFolder
} from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/HTMLElement';
import {
  FolderCommandBase,
  FolderCommandInvocationBase
} from 'obsidian-dev-utils/obsidian/Commands/FolderCommandBase';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/Markdown';

import type { Plugin } from '../Plugin.ts';

import { selectTargetFolderForSwap } from '../Modals/SwapFolderModal.ts';
import { swap } from '../Swapper.ts';

class SwapFolderCommandInvocation extends FolderCommandInvocationBase<Plugin> {
  protected override async execute(): Promise<void> {
    if (this.plugin.settings.isPathIgnored(this.folder.path)) {
      new Notice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot swap folder ');
          f.appendChild(await renderInternalLink(this.app, this.folder));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }

    const result = await selectTargetFolderForSwap(this.plugin, this.folder);
    if (result) {
      await swap(this.app, this.folder, result.targetFolder, result.shouldSwapEntireFolderStructure);
    }
  }
}

export class SwapFolderCommand extends FolderCommandBase<Plugin> {
  protected override get shouldAddCommandToSubmenu(): boolean {
    return this.plugin.settings.shouldAddCommandsToSubmenu;
  }

  public constructor(plugin: Plugin) {
    super({
      fileMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'switch-camera',
      id: 'swap-folder',
      name: 'Swap folder with...',
      plugin
    });
  }

  protected override createCommandInvocationForFolder(Folder: null | TFolder): FolderCommandInvocationBase<Plugin> {
    return new SwapFolderCommandInvocation(this.plugin, Folder);
  }

  protected override shouldAddToFolderMenu(): boolean {
    return true;
  }
}
