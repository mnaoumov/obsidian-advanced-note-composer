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
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { FileCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/file-command-handler';
import { isMarkdownFile } from 'obsidian-dev-utils/obsidian/file-system';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { isFileOrFolderCommandBlocked } from '../command-block.ts';
import { MergeComposer } from '../composers/merge-composer.ts';
import { mergeFilesIntoSingleFile } from '../merge-into-single-file-runner.ts';
import { prepareForMergeFile } from '../modals/merge-file-modal.ts';
import { selectTargetFileForMergeFiles } from '../modals/merge-files-modal.ts';

const MIN_MERGEABLE_FILE_COUNT = 2;

interface MergeFileCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

export class MergeFileCommandHandler extends FileCommandHandler {
  private readonly app: App;
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: MergeFileCommandHandlerConstructorParams) {
    super({
      fileMenuItemName: 'Merge entire file with...',
      fileMenuSubmenuIcon: 'lucide-git-merge',
      filesMenuItemName: 'Merge these files into one file...',
      filesMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-git-merge',
      id: 'merge-file',
      name: 'Merge current file with another file...'
    });

    this.app = params.app;
    this.consoleDebugComponent = params.consoleDebugComponent;
    this.resourceLockComponent = params.resourceLockComponent;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  protected override canExecuteFile(file: TFile): boolean {
    return isMarkdownFile(file) && !isFileOrFolderCommandBlocked(this.pluginSettingsComponent, file);
  }

  protected override canExecuteFiles(files: TFile[]): boolean {
    // The multi-select merge needs at least two mergeable (markdown, non-blocked) notes.
    return this.mergeableFiles(files).length >= MIN_MERGEABLE_FILE_COUNT;
  }

  protected override async executeFile(file: TFile): Promise<void> {
    if (this.pluginSettingsComponent.settings.isPathIgnored(file.path)) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot merge file ');
          f.append(await renderInternalLink({ app: this.app, pathOrAbstractFile: file }));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }
    const result = await prepareForMergeFile({
      app: this.app,
      pluginSettingsComponent: this.pluginSettingsComponent,
      resourceLockComponent: this.resourceLockComponent,
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
      resourceLockComponent: this.resourceLockComponent,
      shouldFixFootnotes: result.shouldFixFootnotes,
      shouldMergeHeadings: result.shouldMergeHeadings,
      sourceFile: file,
      targetFile: result.targetFile
    });
    await composer.mergeFile();
  }

  protected override async executeFiles(files: TFile[]): Promise<void> {
    // Multi-select (files-menu) merge: pick one target, then merge every selected note into it in one
    // Reversible transaction (issue #92). The picker excludes the selected sources and ignored files.
    const sourceFiles = this.mergeableFiles(files);
    if (sourceFiles.length < MIN_MERGEABLE_FILE_COUNT) {
      return;
    }
    const targetFile = await selectTargetFileForMergeFiles({
      app: this.app,
      pluginSettingsComponent: this.pluginSettingsComponent,
      sourceFiles
    });
    if (!targetFile) {
      return;
    }
    await mergeFilesIntoSingleFile({
      app: this.app,
      consoleDebugComponent: this.consoleDebugComponent,
      isNewTargetFile: false,
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent,
      progressLabel: 'Merging files',
      resourceLockComponent: this.resourceLockComponent,
      // No folder scopes this merge, so each source note carries the attachments it owns (issue #161).
      shouldRelocateOwnedAttachments: this.pluginSettingsComponent.settings.shouldMoveAttachmentsWhenMergingFile,
      sourceFiles,
      targetFile
    });
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
    return true;
  }

  private mergeableFiles(files: TFile[]): TFile[] {
    return files.filter((file) => isMarkdownFile(file) && !isFileOrFolderCommandBlocked(this.pluginSettingsComponent, file));
  }
}
