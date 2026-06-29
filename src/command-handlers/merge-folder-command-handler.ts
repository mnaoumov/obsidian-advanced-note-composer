import type {
  App,
  TAbstractFile,
  TFile,
  TFolder
} from 'obsidian';
import type { FolderCommandHandlerShouldAddToFolderMenuParams } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { EditorLockComponent } from 'obsidian-dev-utils/obsidian/editor-lock';

import { Vault } from 'obsidian';
import {
  appendCodeBlock,
  createFragmentAsync
} from 'obsidian-dev-utils/html-element';
import { FolderCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import {
  exists,
  FileSystemType,
  isFile,
  isFolder,
  isMarkdownFile
} from 'obsidian-dev-utils/obsidian/file-system';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import {
  getAvailablePath,
  getOrCreateFileSafe,
  getOrCreateFolderSafe,
  isChildOrSelf,
  renameSafe,
  trashSafe
} from 'obsidian-dev-utils/obsidian/vault';
import {
  join,
  relative
} from 'obsidian-dev-utils/path';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { MergeComposer } from '../composers/merge-composer.ts';
import { selectTargetFolderForMergeFolder } from '../modals/merge-folder-modal.ts';

interface MergeFolderCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly editorLockComponent: EditorLockComponent;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

export class MergeFolderCommandHandler extends FolderCommandHandler {
  private readonly app: App;
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly editorLockComponent: EditorLockComponent;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: MergeFolderCommandHandlerConstructorParams) {
    super({
      fileMenuItemName: 'Merge entire folder with...',
      fileMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'merge',
      id: 'merge-folder',
      name: 'Merge current folder with another folder...'
    });

    this.app = params.app;
    this.consoleDebugComponent = params.consoleDebugComponent;
    this.editorLockComponent = params.editorLockComponent;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  protected override canExecuteFolder(folder: TFolder): boolean {
    super.canExecuteFolder(folder);
    return !folder.isRoot();
  }

  protected override async executeFolder(folder: TFolder): Promise<void> {
    if (this.pluginSettingsComponent.settings.isPathIgnored(folder.path)) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot merge folder ');
          f.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: folder }));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }
    const targetFolder = await selectTargetFolderForMergeFolder({
      app: this.app,
      pluginSettingsComponent: this.pluginSettingsComponent,
      sourceFolder: folder
    });
    if (targetFolder) {
      await this.mergeFolder(folder, targetFolder);
    }
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return super.shouldAddCommandToSubmenu() ?? this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  // eslint-disable-next-line obsidian-dev-utils/params-options-name-match -- Override must keep the base param type.
  protected override shouldAddToFolderMenu(params: FolderCommandHandlerShouldAddToFolderMenuParams): boolean {
    super.shouldAddToFolderMenu(params);
    return true;
  }

  private depth(file: TAbstractFile): number {
    return file.path.split('/').length;
  }

  private async mergeFolder(sourceFolder: TFolder, targetFolder: TFolder): Promise<void> {
    const notice = this.pluginNoticeComponent.showNotice(
      await createFragmentAsync(async (f) => {
        f.appendText('Advanced Note Composer: Merging folder ');
        f.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: sourceFolder.path }));
        f.appendText(' with ');
        f.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: targetFolder.path }));
        f.createEl('br');
        f.createEl('br');
        f.createDiv('is-loading');
      }),
      {
        isPermanent: true
      }
    );

    try {
      await this.mergeFolderImpl(sourceFolder, targetFolder);
    } finally {
      notice.hide();
    }
  }

  private async mergeFolderImpl(sourceFolder: TFolder, targetFolder: TFolder): Promise<void> {
    const sourceSubfolders: TFolder[] = [];
    const sourceMdFiles: TFile[] = [];
    const sourceOtherFiles: TFile[] = [];

    Vault.recurseChildren(sourceFolder, (child) => {
      if (isFolder(child)) {
        sourceSubfolders.push(child);
        return;
      }
      if (!isFile(child)) {
        return;
      }
      if (isMarkdownFile(child)) {
        sourceMdFiles.push(child);
        return;
      }
      sourceOtherFiles.push(child);
    });

    /* v8 ignore start -- sort comparator is only called with 2+ subfolders. */
    sourceSubfolders.sort((a, b) => this.depth(b) - this.depth(a));
    /* v8 ignore stop */
    const subfoldersMap = new Map<string, string>();

    for (const sourceSubfolder of sourceSubfolders) {
      const relativePath = relative(sourceFolder.path, sourceSubfolder.path);
      const targetSubfolderPath = join(targetFolder.path, relativePath);
      const targetSubfolder = await getOrCreateFolderSafe(this.app, targetSubfolderPath);
      subfoldersMap.set(sourceSubfolder.path, targetSubfolder.path);
    }

    if (isChildOrSelf({ app: this.app, childPathOrFile: sourceFolder, parentPathOrFile: targetFolder })) {
      sourceMdFiles.sort((a, b) => this.depth(a) - this.depth(b));
    }

    if (isChildOrSelf({ app: this.app, childPathOrFile: targetFolder, parentPathOrFile: sourceFolder })) {
      sourceMdFiles.sort((a, b) => this.depth(b) - this.depth(a));
    }

    for (const sourceMdFile of sourceMdFiles) {
      /* v8 ignore start -- defensive ?? on parent?.path and Map.get(). */
      const targetParentFolderPath = subfoldersMap.get(sourceMdFile.parent?.path ?? '') ?? '';
      /* v8 ignore stop */
      const targetMdFilePath = join(targetParentFolderPath, sourceMdFile.name);
      const isNewTargetFile = !exists({ app: this.app, path: targetMdFilePath, type: FileSystemType.File });
      const targetMdFile = await getOrCreateFileSafe(this.app, targetMdFilePath);
      const composer = new MergeComposer({
        app: this.app,
        consoleDebugComponent: this.consoleDebugComponent,
        editorLockComponent: this.editorLockComponent,
        isNewTargetFile,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent: this.pluginSettingsComponent,
        shouldShowNotice: false,
        sourceFile: sourceMdFile,
        targetFile: targetMdFile
      });
      await composer.mergeFile();
    }

    for (const sourceOtherFile of sourceOtherFiles) {
      /* v8 ignore start -- defensive ?? on parent?.path and Map.get(). */
      const targetParentFolderPath = subfoldersMap.get(sourceOtherFile.parent?.path ?? '') ?? '';
      /* v8 ignore stop */
      let targetFilePath = join(targetParentFolderPath, sourceOtherFile.name);
      targetFilePath = getAvailablePath(this.app, targetFilePath);
      await renameSafe({ app: this.app, newPath: targetFilePath, oldPathOrAbstractFile: sourceOtherFile });
    }

    for (const sourceSubfolder of sourceSubfolders) {
      if (sourceSubfolder.children.length > 0) {
        continue;
      }
      let canDeleteSourceFolder = true;
      for (const targetFolderPath of subfoldersMap.values()) {
        if (isChildOrSelf({ app: this.app, childPathOrFile: targetFolderPath, parentPathOrFile: sourceSubfolder })) {
          canDeleteSourceFolder = false;
          break;
        }
      }
      if (!canDeleteSourceFolder) {
        continue;
      }
      await trashSafe(this.app, sourceSubfolder);
    }

    if (!this.pluginSettingsComponent.settings.shouldRunTemplaterOnDestinationFile) {
      return;
    }
    const templaterPlugin = this.app.plugins.plugins['templater-obsidian'];
    if (!templaterPlugin) {
      this.pluginNoticeComponent.showNotice(createFragment((f) => {
        f.appendText('Advanced Note Composer: You have enabled setting ');
        appendCodeBlock(f, 'Should run templater on destination file');
        f.appendText(', but Templater plugin is not installed.');
      }));
    }
  }
}
