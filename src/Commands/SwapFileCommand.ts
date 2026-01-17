import {
  Notice,
  TFile
} from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/HTMLElement';
import {
  FileCommandBase,
  FileCommandInvocationBase
} from 'obsidian-dev-utils/obsidian/Commands/FileCommandBase';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/Markdown';

import type { Plugin } from '../Plugin.ts';

import { selectFileForSwap } from '../Modals/SwapFileModal.ts';
import { swap } from '../Swapper.ts';

class SwapFileCommandInvocation extends FileCommandInvocationBase<Plugin> {
  protected override async execute(): Promise<void> {
    if (this.plugin.settings.isPathIgnored(this.file.path)) {
      new Notice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot swap file ');
          f.appendChild(await renderInternalLink(this.app, this.file));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }

    const targetFile = await selectFileForSwap(this.plugin, this.file);
    if (targetFile) {
      await swap(this.app, this.file, targetFile, true);
    }
  }
}

export class SwapFileCommand extends FileCommandBase<Plugin> {
  protected override get shouldAddCommandToSubmenu(): boolean {
    return this.plugin.settings.shouldAddCommandsToSubmenu;
  }

  public constructor(plugin: Plugin) {
    super({
      fileMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'switch-camera',
      id: 'swap-file',
      name: 'Swap file with...',
      plugin
    });
  }

  protected override createCommandInvocationForFile(File: null | TFile): FileCommandInvocationBase<Plugin> {
    return new SwapFileCommandInvocation(this.plugin, File);
  }

  protected override shouldAddToFileMenu(): boolean {
    return true;
  }
}
