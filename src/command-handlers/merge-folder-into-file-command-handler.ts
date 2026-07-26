import type {
  App,
  TFile,
  TFolder
} from 'obsidian';
import type { FolderCommandHandlerShouldAddToFolderMenuParams } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { Vault } from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { FolderCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import {
  isFile,
  isMarkdownFile
} from 'obsidian-dev-utils/obsidian/file-system';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import {
  getAvailablePath,
  trashSafe
} from 'obsidian-dev-utils/obsidian/vault';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { isFileOrFolderCommandBlocked } from '../command-block.ts';
import { mergeFilesIntoSingleFile } from '../merge-into-single-file-runner.ts';
import { confirmMergeFolderIntoFile } from '../modals/merge-folder-into-file-modal.ts';

interface MergeFolderIntoFileCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

/**
 * `Merge folder contents into a single file` command / folder-menu item (issue #92, the "Folder Merger"
 * capability): concatenates every descendant markdown note of the chosen folder (recursively, in path
 * order) into ONE brand-new note named after the folder and placed alongside it. Distinct from
 * `Merge current folder with another folder...`, which mirrors structure into another folder.
 *
 * Each descendant note is run through the same {@link MergeComposer} as a single-file merge (so the merge
 * template, frontmatter strategy, footnote fixing, and backlink/link updates all apply), inside one
 * reversible resource-locked transaction. Ignored notes are skipped and reported.
 */
export class MergeFolderIntoFileCommandHandler extends FolderCommandHandler {
  private readonly app: App;
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: MergeFolderIntoFileCommandHandlerConstructorParams) {
    super({
      fileMenuItemName: 'Merge folder contents into a single file...',
      fileMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-file-stack',
      id: 'merge-folder-into-file',
      name: 'Merge current folder contents into a single file...'
    });

    this.app = params.app;
    this.consoleDebugComponent = params.consoleDebugComponent;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.resourceLockComponent = params.resourceLockComponent;
  }

  protected override canExecuteFolder(folder: TFolder): boolean {
    super.canExecuteFolder(folder);
    return !folder.isRoot() && !isFileOrFolderCommandBlocked(this.pluginSettingsComponent, folder);
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

    const sourceMdFiles: TFile[] = [];
    Vault.recurseChildren(folder, (child) => {
      if (isFile(child) && isMarkdownFile(child)) {
        sourceMdFiles.push(child);
      }
    });
    sourceMdFiles.sort((a, b) => a.path.localeCompare(b.path));

    if (sourceMdFiles.length === 0) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('Folder ');
          f.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: folder }));
          f.appendText(' has no markdown notes to merge.');
        })
      );
      return;
    }

    // A sibling note named after the folder (`docs/notes` -> `docs/notes.md`), deduped. Deriving it from
    // `folder.path` (not `join(parent, name)`) keeps it correct when the folder sits at the vault root.
    const targetPath = getAvailablePath(this.app, `${folder.path}.md`);

    const isConfirmed = await confirmMergeFolderIntoFile({
      app: this.app,
      noteCount: sourceMdFiles.length,
      pluginSettingsComponent: this.pluginSettingsComponent,
      sourceFolder: folder,
      targetPath
    });
    if (!isConfirmed) {
      return;
    }

    const targetFile = await this.app.vault.create(targetPath, '');

    const result = await mergeFilesIntoSingleFile({
      app: this.app,
      consoleDebugComponent: this.consoleDebugComponent,
      isNewTargetFile: true,
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent,
      progressLabel: 'Merging folder',
      resourceLockComponent: this.resourceLockComponent,
      sourceFiles: sourceMdFiles,
      targetFile
    });

    if (result.aborted || result.mergedCount === 0) {
      // Cancelled or nothing merged (e.g. all notes ignored): remove the empty target we created.
      await trashSafe(this.app, targetFile);
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
}
