import type { FolderCommandHandlerShouldAddToFolderMenuParams } from '@mnaoumov/obsidian-lib/command-handlers/folder-command-handler';
import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type { ResourceLockComponent } from '@mnaoumov/obsidian-lib/resource-lock';
import type {
  App,
  TFolder
} from 'obsidian';

import { FolderCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/folder-command-handler';

import type { BulkOperationRunner } from '../bulk-operations/bulk-operation-runner.ts';
import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';

import { runLockedTransaction } from '../composers/locked-transaction.ts';
import { recordRecentTarget } from '../recency/recent-targets.ts';
import { isFileOrFolderCommandBlocked } from '../settings/command-visibility/command-block.ts';
import { CommandCategory } from '../settings/plugin-settings.ts';
import {
  buildOperationNoticeContent,
  showOperationCompletionNotice,
  showOperationProgressNotice
} from '../ui/operation-notices.ts';
import { selectTargetFolderForSwap } from './swap-folder-modal.ts';
import { swap } from './swapper.ts';

interface SwapFolderCommandHandlerConstructorParams {
  readonly app: App;
  readonly bulkOperationRunner: BulkOperationRunner;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

export class SwapFolderCommandHandler extends FolderCommandHandler {
  private readonly app: App;
  private readonly bulkOperationRunner: BulkOperationRunner;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: SwapFolderCommandHandlerConstructorParams) {
    super({
      fileMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'switch-camera',
      id: 'swap-folder',
      name: 'Swap folder with...'
    });

    this.app = params.app;
    this.bulkOperationRunner = params.bulkOperationRunner;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.resourceLockComponent = params.resourceLockComponent;
  }

  protected override canExecuteFolder(folder: TFolder): boolean {
    super.canExecuteFolder(folder);
    return !folder.isRoot() && !isFileOrFolderCommandBlocked({ abstractFile: folder, commandCategory: CommandCategory.Swap, pluginSettingsComponent: this.pluginSettingsComponent });
  }

  protected override async executeFolder(folder: TFolder): Promise<void> {
    const result = await selectTargetFolderForSwap({
      app: this.app,
      pluginSettingsComponent: this.pluginSettingsComponent,
      sourceFolder: folder
    });
    if (!result) {
      return;
    }

    // Captured as strings BEFORE the swap: it renames both folders, which mutates `path` on the two
    // `TFolder` objects, so reading them afterwards would report the two paths the other way round.
    const sourcePath = folder.path;
    const targetPath = result.targetFolder.path;

    const abortController = new AbortController();
    const progressNotice = showOperationProgressNotice({
      abortController,
      app: this.app,
      content: () =>
        buildOperationNoticeContent({
          app: this.app,
          isLoading: true,
          pluginSettingsComponent: this.pluginSettingsComponent,
          preposition: 'with',
          sourcePathOrAbstractFile: sourcePath,
          targetPathOrAbstractFile: targetPath,
          verb: 'Swapping folder'
        }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
    try {
      await this.bulkOperationRunner.runBulkOperation({
        operation: () =>
          runLockedTransaction({
            abortController,
            app: this.app,
            body: async (vaultTransaction) => {
              await swap({
                app: this.app,
                shouldSwapEntireFolderStructure: result.shouldSwapEntireFolderStructure,
                sourceFile: folder,
                targetFile: result.targetFolder,
                vaultTransaction
              });
            },
            lockTargets: [
              { mode: 'subtree', pathOrFile: folder.path },
              { mode: 'subtree', pathOrFile: result.targetFolder.path }
            ],
            operationName: 'Swap folders',
            resourceLockComponent: this.resourceLockComponent
          }),
        summary: `Swap folder ${sourcePath} with ${targetPath}`
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        // The operation was cancelled (user or external change); the transaction has rolled back.
        return;
      }
      throw error;
    } finally {
      progressNotice?.[Symbol.dispose]();
    }

    // The swap landed, so the folder it was swapped with counts as clicked-on for the next picker (issue
    // #206). The captured PATH is recorded, not the folder object: the swap renames both sides, so the
    // object now reports the source's old path.
    recordRecentTarget(targetPath);

    showOperationCompletionNotice({
      content: await buildOperationNoticeContent({
        app: this.app,
        pluginSettingsComponent: this.pluginSettingsComponent,
        preposition: 'with',
        sourcePathOrAbstractFile: sourcePath,
        targetPathOrAbstractFile: targetPath,
        verb: 'Swapped folder'
      }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return super.shouldAddCommandToSubmenu() ?? this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  // eslint-disable-next-line typescript-dev-toolkit/params-options-name-match -- Override must keep the base param type.
  protected override shouldAddToFolderMenu(params: FolderCommandHandlerShouldAddToFolderMenuParams): boolean {
    super.shouldAddToFolderMenu(params);
    return true;
  }
}
