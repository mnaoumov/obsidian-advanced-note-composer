import type {
  App,
  TFolder
} from 'obsidian';
import type { FolderCommandHandlerShouldAddToFolderMenuParams } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { FolderCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { getAvailablePath } from 'obsidian-dev-utils/obsidian/vault';
import { join } from 'obsidian-dev-utils/path';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { isFileOrFolderCommandBlocked } from '../command-block.ts';
import { runLockedTransaction } from '../locked-transaction.ts';
import { selectTargetFolderForMove } from '../modals/move-folder-modal.ts';

interface MoveFolderCommandHandlerConstructorParams {
  readonly app: App;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

/**
 * `Move folder to...` command (issue #73): moves the chosen folder into another folder picked from a
 * suggester that respects the plugin's ignored paths (and never offers the folder's own subtree or its
 * current parent). Links are updated by the underlying rename and a name collision in the destination
 * is de-duplicated. Runs inside the shared reversible locked transaction.
 */
export class MoveFolderCommandHandler extends FolderCommandHandler {
  private readonly app: App;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: MoveFolderCommandHandlerConstructorParams) {
    super({
      fileMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-folder-input',
      id: 'move-folder',
      name: 'Move folder to...'
    });

    this.app = params.app;
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
          f.appendText('You cannot move folder ');
          f.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: folder }));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }

    const targetFolder = await selectTargetFolderForMove({
      app: this.app,
      pluginSettingsComponent: this.pluginSettingsComponent,
      sourceFolder: folder
    });
    if (!targetFolder) {
      return;
    }

    const targetPath = getAvailablePath(this.app, join(targetFolder.path, folder.name));

    const abortController = new AbortController();
    try {
      await runLockedTransaction({
        abortController,
        app: this.app,
        body: async (vaultTransaction) => {
          await vaultTransaction.rename(folder, targetPath);
        },
        lockTargets: [
          { mode: 'subtree', pathOrFile: folder.path },
          { mode: 'subtree', pathOrFile: targetFolder.path }
        ],
        operationName: 'Move folder',
        resourceLockComponent: this.resourceLockComponent
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        // The operation was cancelled (user or external change); the transaction has rolled back.
        return;
      }
      throw error;
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
