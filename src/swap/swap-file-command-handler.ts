import type { FileCommandHandlerShouldAddToFileMenuParams } from '@mnaoumov/obsidian-lib/command-handlers/file-command-handler';
import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type { ResourceLockComponent } from '@mnaoumov/obsidian-lib/resource-lock';
import type {
  App,
  TFile
} from 'obsidian';

import { FileCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/file-command-handler';

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
import { selectFileForSwap } from './swap-file-modal.ts';
import { swap } from './swapper.ts';

interface SwapFileCommandHandlerConstructorParams {
  readonly app: App;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

export class SwapFileCommandHandler extends FileCommandHandler {
  private readonly app: App;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: SwapFileCommandHandlerConstructorParams) {
    super({
      fileMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'switch-camera',
      id: 'swap-file',
      name: 'Swap file with...'
    });

    this.app = params.app;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.resourceLockComponent = params.resourceLockComponent;
  }

  protected override canExecuteFile(file: TFile): boolean {
    return !isFileOrFolderCommandBlocked({ abstractFile: file, commandCategory: CommandCategory.Swap, pluginSettingsComponent: this.pluginSettingsComponent });
  }

  protected override async executeFile(file: TFile): Promise<void> {
    const targetFile = await selectFileForSwap({
      app: this.app,
      pluginSettingsComponent: this.pluginSettingsComponent,
      sourceFile: file
    });
    if (!targetFile) {
      return;
    }

    // Captured as strings BEFORE the swap: the swap renames both notes, which mutates `path` on the two
    // `TFile` objects, so reading them afterwards would report the two paths the other way round.
    const sourcePath = file.path;
    const targetPath = targetFile.path;

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
          verb: 'Swapping file'
        }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
    try {
      await runLockedTransaction({
        abortController,
        app: this.app,
        body: async (vaultTransaction) => {
          await swap({
            app: this.app,
            shouldSwapEntireFolderStructure: true,
            sourceFile: file,
            targetFile,
            vaultTransaction
          });
        },
        lockTargets: [
          { mode: 'file', pathOrFile: file },
          { mode: 'file', pathOrFile: targetFile }
        ],
        operationName: 'Swap files',
        resourceLockComponent: this.resourceLockComponent
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

    // The swap landed, so the note it was swapped with counts as clicked-on for the next picker (issue
    // #206). The captured PATH is recorded, not the file object: the swap renames both sides, so the
    // object now reports the source's old path.
    recordRecentTarget(targetPath);

    showOperationCompletionNotice({
      content: await buildOperationNoticeContent({
        app: this.app,
        pluginSettingsComponent: this.pluginSettingsComponent,
        preposition: 'with',
        sourcePathOrAbstractFile: sourcePath,
        targetPathOrAbstractFile: targetPath,
        verb: 'Swapped file'
      }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return super.shouldAddCommandToSubmenu() ?? this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  // eslint-disable-next-line typescript-dev-toolkit/params-options-name-match -- Override must keep the base param type.
  protected override shouldAddToFileMenu(params: FileCommandHandlerShouldAddToFileMenuParams): boolean {
    super.shouldAddToFileMenu(params);
    return true;
  }
}
