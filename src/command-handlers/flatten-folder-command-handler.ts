import type {
  App,
  TAbstractFile,
  TFolder
} from 'obsidian';
import type { FolderCommandHandlerShouldAddToFolderMenuParams } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';
import type { VaultTransaction } from 'obsidian-dev-utils/obsidian/vault-transaction';

import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { FolderCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { getAvailablePath } from 'obsidian-dev-utils/obsidian/vault';
import { join } from 'obsidian-dev-utils/path';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { runLockedTransaction } from '../locked-transaction.ts';

interface FlattenFolderCommandHandlerConstructorParams {
  readonly app: App;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

interface FlattenFolderCommandHandlerFlattenImplParams {
  readonly abortController: AbortController;
  readonly children: TAbstractFile[];
  readonly parentFolder: TFolder;
  readonly vaultTransaction: VaultTransaction;
}

/**
 * `Flatten folder` command (issue #105): moves every direct child (files and subfolders) of the chosen
 * folder up one level, so they become siblings of that folder. Subfolders keep their internal structure
 * (they are moved wholesale, not collapsed). Links are updated by the underlying rename. Name collisions
 * with existing siblings are de-duplicated. The emptied source folder is left in place (delete it
 * manually if desired) — matching the manual "select all and drag up" workflow the issue describes.
 */
export class FlattenFolderCommandHandler extends FolderCommandHandler {
  private readonly app: App;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: FlattenFolderCommandHandlerConstructorParams) {
    super({
      fileMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-list-tree',
      id: 'flatten-folder',
      name: 'Flatten folder...'
    });

    this.app = params.app;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.resourceLockComponent = params.resourceLockComponent;
  }

  protected override canExecuteFolder(folder: TFolder): boolean {
    super.canExecuteFolder(folder);
    if (folder.isRoot()) {
      return false;
    }
    return folder.children.length > 0;
  }

  protected override async executeFolder(folder: TFolder): Promise<void> {
    if (this.pluginSettingsComponent.settings.isPathIgnored(folder.path)) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot flatten folder ');
          f.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: folder }));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }

    const parentFolder = folder.parent;
    /* v8 ignore start -- a non-root folder always has a parent. */
    if (!parentFolder) {
      return;
    }
    /* v8 ignore stop */

    // Snapshot the children up front: renaming mutates `folder.children` mid-iteration.
    const children = [...folder.children];

    const abortController = new AbortController();
    try {
      await runLockedTransaction({
        abortController,
        app: this.app,
        body: async (vaultTransaction) => {
          await this.flattenImpl({ abortController, children, parentFolder, vaultTransaction });
        },
        lockTargets: [
          { mode: 'subtree', pathOrFile: folder.path },
          { mode: 'subtree', pathOrFile: parentFolder.path }
        ],
        operationName: 'Flatten folder',
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

  private async flattenImpl(params: FlattenFolderCommandHandlerFlattenImplParams): Promise<void> {
    const { abortController, children, parentFolder, vaultTransaction } = params;
    for (const child of children) {
      if (abortController.signal.aborted) {
        throw new Error('Flatten folder aborted.');
      }
      const targetPath = getAvailablePath(this.app, join(parentFolder.path, child.name));
      await vaultTransaction.rename(child, targetPath);
    }
  }
}
