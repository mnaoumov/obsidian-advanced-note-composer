import type {
  IconName,
  TFile
} from 'obsidian';

import { Notice } from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/HTMLElement';
import {
  FileCommandBase,
  FileCommandInvocationBase
} from 'obsidian-dev-utils/obsidian/Commands/FileCommandBase';
import { isMarkdownFile } from 'obsidian-dev-utils/obsidian/FileSystem';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/Markdown';

import type { Plugin } from '../Plugin.ts';

import { AdvancedNoteComposer } from '../Composers/AdvancedNoteComposer.ts';
import { MergeFileSuggestModal } from '../Modals/MergeFileModal.ts';

class MergeFileCommandInvocation extends FileCommandInvocationBase<Plugin> {
  public constructor(plugin: Plugin, file: null | TFile) {
    super(plugin, file);
  }

  public override canExecute(): boolean {
    if (!super.canExecute()) {
      return false;
    }

    return isMarkdownFile(this.app, this.file);
  }

  public override async execute(): Promise<void> {
    await super.execute();

    if (this.plugin.settings.isPathIgnored(this.file.path)) {
      new Notice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot merge file ');
          f.appendChild(await renderInternalLink(this.app, this.file));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }

    const modal = new MergeFileSuggestModal(
      this.plugin,
      new AdvancedNoteComposer({
        plugin: this.plugin,
        sourceFile: this.file
      })
    );
    modal.open();
  }
}

export class MergeFileCommand extends FileCommandBase<Plugin> {
  protected override readonly fileMenuItemName: string = 'Merge entire file with...';
  protected override readonly fileMenuSubmenuIcon: IconName = 'lucide-git-merge';

  public constructor(plugin: Plugin) {
    super({
      icon: 'lucide-git-merge',
      id: 'merge-file',
      name: 'Merge current file with another file...',
      plugin
    });
  }

  protected override createCommandInvocationForFile(file: null | TFile): FileCommandInvocationBase<Plugin> {
    return new MergeFileCommandInvocation(this.plugin, file);
  }

  protected override shouldAddToFileMenu(_file: TFile, source: string): boolean {
    return source !== 'link-context-menu';
  }

  protected override shouldAddToFilesMenu(): boolean {
    return false;
  }
}
