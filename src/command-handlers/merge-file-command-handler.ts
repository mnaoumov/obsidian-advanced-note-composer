import type {
  App,
  TFile
} from 'obsidian';
import type {
  FileCommandHandlerShouldAddToFileMenuParams,
  FileCommandHandlerShouldAddToFilesMenuParams
} from 'obsidian-dev-utils/obsidian/command-handlers/file-command-handler';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

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
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

export class MergeFileCommandHandler extends FileCommandHandler {
  private readonly app: App;
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
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
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  protected override canExecuteFile(file: TFile): boolean {
    return isMarkdownFile(file);
  }

  protected override async executeFile(file: TFile): Promise<void> {
    if (this.pluginSettingsComponent.settings.isPathIgnored(file.path)) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot merge file ');
          f.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: file }));
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
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent,
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

  // eslint-disable-next-line obsidian-dev-utils/params-options-name-match -- Override must keep the base param type.
  protected override shouldAddToFileMenu(params: FileCommandHandlerShouldAddToFileMenuParams): boolean {
    super.shouldAddToFileMenu(params);
    return params.source !== 'link-context-menu';
  }

  // eslint-disable-next-line obsidian-dev-utils/params-options-name-match -- Override must keep the base param type.
  protected override shouldAddToFilesMenu(params: FileCommandHandlerShouldAddToFilesMenuParams): boolean {
    super.shouldAddToFilesMenu(params);
    return false;
  }
}
