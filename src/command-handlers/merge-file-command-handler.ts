import type { TFile } from 'obsidian';

import { Notice } from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { FileCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/file-command-handler';
import { isMarkdownFile } from 'obsidian-dev-utils/obsidian/file-system';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';

import type { Plugin } from '../plugin.ts';

import { MergeComposer } from '../composers/merge-composer.ts';
import { prepareForMergeFile } from '../modals/merge-file-modal.ts';

export class MergeFileCommandHandler extends FileCommandHandler {
  protected override get shouldAddCommandToSubmenu(): boolean {
    return this.plugin.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  public constructor(private readonly plugin: Plugin) {
    super({
      fileMenuItemName: 'Merge entire file with...',
      fileMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-git-merge',
      id: 'merge-file',
      name: 'Merge current file with another file...',
      pluginName: plugin.manifest.name
    });
  }

  protected override canExecuteFile(file: TFile): boolean {
    return isMarkdownFile(this.plugin.app, file);
  }

  protected override async executeFile(file: TFile): Promise<void> {
    if (this.plugin.pluginSettingsComponent.settings.isPathIgnored(file.path)) {
      new Notice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot merge file ');
          f.appendChild(await renderInternalLink(this.plugin.app, file));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }
    const result = await prepareForMergeFile(this.plugin, file);
    if (!result) {
      return;
    }
    const composer = new MergeComposer({
      frontmatterMergeStrategy: result.frontmatterMergeStrategy,
      insertMode: result.insertMode,
      isNewTargetFile: result.isNewTargetFile,
      plugin: this.plugin,
      shouldAllowOnlyCurrentFolder: result.shouldAllowOnlyCurrentFolder,
      shouldAllowSplitIntoUnresolvedPath: result.shouldAllowSplitIntoUnresolvedPath,
      shouldFixFootnotes: result.shouldFixFootnotes,
      shouldMergeHeadings: result.shouldMergeHeadings,
      sourceFile: file,
      targetFile: result.targetFile
    });
    await composer.mergeFile();
  }

  protected override shouldAddToFileMenu(_file: TFile, source: string): boolean {
    return source !== 'link-context-menu';
  }

  protected override shouldAddToFilesMenu(): boolean {
    return false;
  }
}
