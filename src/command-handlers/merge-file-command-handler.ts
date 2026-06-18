import type {
  App,
  TFile,
  WorkspaceLeaf
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';

import { Notice } from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { FileCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/file-command-handler';
import { isMarkdownFile } from 'obsidian-dev-utils/obsidian/file-system';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { MergeComposer } from '../composers/merge-composer.ts';
import { prepareForMergeFile } from '../modals/merge-file-modal.ts';

interface MergeFileCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

export class MergeFileCommandHandler extends FileCommandHandler {
  private readonly app: App;
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: MergeFileCommandHandlerConstructorParams) {
    super({
      fileMenuItemName: 'Merge entire file with...',
      fileMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-git-merge',
      id: 'merge-file',
      name: 'Merge current file with another file...'
    });

    this.app = params.app;
    this.consoleDebugComponent = params.consoleDebugComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  protected override canExecuteFile(file: TFile): boolean {
    return super.canExecuteFile(file) || isMarkdownFile(this.app, file);
  }

  protected override async executeFile(file: TFile): Promise<void> {
    if (this.pluginSettingsComponent.settings.isPathIgnored(file.path)) {
      new Notice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot merge file ');
          f.appendChild(await renderInternalLink(this.app, file));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }
    const result = await prepareForMergeFile({
      app: this.app,
      pluginSettingsComponent: this.pluginSettingsComponent,
      sourceFile: file
    });
    if (!result) {
      return;
    }
    const composer = new MergeComposer({
      app: this.app,
      consoleDebugComponent: this.consoleDebugComponent,
      frontmatterMergeStrategy: result.frontmatterMergeStrategy,
      insertMode: result.insertMode,
      isNewTargetFile: result.isNewTargetFile,
      pluginSettingsComponent: this.pluginSettingsComponent,
      shouldAllowOnlyCurrentFolder: result.shouldAllowOnlyCurrentFolder,
      shouldAllowSplitIntoUnresolvedPath: result.shouldAllowSplitIntoUnresolvedPath,
      shouldFixFootnotes: result.shouldFixFootnotes,
      shouldMergeHeadings: result.shouldMergeHeadings,
      sourceFile: file,
      targetFile: result.targetFile
    });
    await composer.mergeFile();
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return super.shouldAddCommandToSubmenu() ?? this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  protected override shouldAddToFileMenu(file: TFile, source: string): boolean {
    super.shouldAddToFileMenu(file, source);
    return source !== 'link-context-menu';
  }

  protected override shouldAddToFilesMenu(files: TFile[], source: string, leaf?: WorkspaceLeaf): boolean {
    super.shouldAddToFilesMenu(files, source, leaf);
    return false;
  }
}
