import type { TFolder } from 'obsidian';

import { Notice } from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { FolderCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';

import type { Plugin } from '../plugin.ts';

import { selectTargetFolderForSwap } from '../modals/swap-folder-modal.ts';
import { swap } from '../swapper.ts';

export class SwapFolderCommandHandler extends FolderCommandHandler {
  protected override get shouldAddCommandToSubmenu(): boolean {
    return this.plugin.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  public constructor(private readonly plugin: Plugin) {
    super({
      fileMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'switch-camera',
      id: 'swap-folder',
      name: 'Swap folder with...',
      pluginName: plugin.manifest.name
    });
  }

  protected override canExecuteFolder(folder: TFolder): boolean {
    return !folder.isRoot();
  }

  protected override async executeFolder(folder: TFolder): Promise<void> {
    if (this.plugin.pluginSettingsComponent.settings.isPathIgnored(folder.path)) {
      new Notice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot swap folder ');
          f.appendChild(await renderInternalLink(this.plugin.app, folder));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }
    const result = await selectTargetFolderForSwap(this.plugin, folder);
    if (result) {
      await swap(this.plugin.app, folder, result.targetFolder, result.shouldSwapEntireFolderStructure);
    }
  }

  protected override shouldAddToFolderMenu(): boolean {
    return true;
  }
}
