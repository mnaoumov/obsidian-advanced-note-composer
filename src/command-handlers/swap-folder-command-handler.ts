import type {
  App,
  TFolder,
  WorkspaceLeaf
} from 'obsidian';

import { Notice } from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { FolderCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { selectTargetFolderForSwap } from '../modals/swap-folder-modal.ts';
import { swap } from '../swapper.ts';

interface SwapFolderCommandHandlerConstructorParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

export class SwapFolderCommandHandler extends FolderCommandHandler {
  private readonly app: App;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: SwapFolderCommandHandlerConstructorParams) {
    super({
      fileMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'switch-camera',
      id: 'swap-folder',
      name: 'Swap folder with...'
    });

    this.app = params.app;
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
          f.appendText('You cannot swap folder ');
          f.appendChild(await renderInternalLink(this.app, folder));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }
    const result = await selectTargetFolderForSwap({
      app: this.app,
      pluginSettingsComponent: this.pluginSettingsComponent,
      sourceFolder: folder
    });
    if (result) {
      await swap(this.app, folder, result.targetFolder, result.shouldSwapEntireFolderStructure);
    }
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return super.shouldAddCommandToSubmenu() ?? this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  protected override shouldAddToFolderMenu(folder: TFolder, source: string, leaf?: WorkspaceLeaf): boolean {
    super.shouldAddToFolderMenu(folder, source, leaf);
    return true;
  }
}
