import type { TFile } from 'obsidian';

import { Notice } from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { FileCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/file-command-handler';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';

import type { Plugin } from '../plugin.ts';

import { selectFileForSwap } from '../modals/swap-file-modal.ts';
import { swap } from '../swapper.ts';

export class SwapFileCommandHandler extends FileCommandHandler {
  protected override get shouldAddCommandToSubmenu(): boolean {
    return this.plugin.pluginSettings.shouldAddCommandsToSubmenu;
  }

  public constructor(private readonly plugin: Plugin) {
    super({
      fileMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'switch-camera',
      id: 'swap-file',
      name: 'Swap file with...',
      pluginName: plugin.manifest.name
    });
  }

  protected override async executeFile(file: TFile): Promise<void> {
    if (this.plugin.pluginSettings.isPathIgnored(file.path)) {
      new Notice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot swap file ');
          f.appendChild(await renderInternalLink(this.plugin.app, file));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }
    const targetFile = await selectFileForSwap(this.plugin, file);
    if (targetFile) {
      await swap(this.plugin.app, file, targetFile, true);
    }
  }

  protected override shouldAddToFileMenu(): boolean {
    return true;
  }
}
