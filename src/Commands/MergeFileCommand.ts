import type { TFile } from 'obsidian';

import {
  FileCommandBase,
  FileCommandInvocationBase
} from 'obsidian-dev-utils/obsidian/Commands/FileCommandBase';
import { isMarkdownFile } from 'obsidian-dev-utils/obsidian/FileSystem';

import type { CorePluginWrapper } from '../CorePluginWrapper.ts';
import type { Plugin } from '../Plugin.ts';

import { AdvancedNoteComposer } from '../AdvancedNoteComposer.ts';
import { MergeFileSuggestModal } from '../MergeFileModal.ts';

class MergeFileCommandInvocation extends FileCommandInvocationBase<Plugin> {
  public constructor(plugin: Plugin, private readonly corePluginWrapper: CorePluginWrapper) {
    super(plugin);
  }

  public override canExecute(): boolean {
    if (!super.canExecute()) {
      return false;
    }

    return isMarkdownFile(this.app, this.file);
  }

  public override async execute(): Promise<void> {
    await super.execute();
    const corePlugin = this.corePluginWrapper.getAndCheckCorePlugin();
    if (!corePlugin) {
      return;
    }

    const modal = new MergeFileSuggestModal(new AdvancedNoteComposer(this.plugin, corePlugin.instance, this.file));
    modal.open();
  }
}

export class MergeFileCommand extends FileCommandBase<Plugin> {
  protected override readonly fileMenuItemName: string = 'Advanced merge entire file with...';
  protected override readonly fileMenuSection: string = 'action';

  public constructor(plugin: Plugin, private readonly corePluginWrapper: CorePluginWrapper) {
    super({
      icon: 'lucide-git-merge',
      id: 'merge-file',
      name: 'Merge current file with another file...',
      plugin
    });
  }

  protected override createCommandInvocation(): FileCommandInvocationBase<Plugin> {
    return new MergeFileCommandInvocation(this.plugin, this.corePluginWrapper);
  }

  protected override shouldAddToFileMenu(_file: TFile, source: string): boolean {
    return source !== 'link-context-menu';
  }
}
