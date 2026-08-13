import type {
  App,
  TFile
} from 'obsidian';
import type { FileCommandHandlerShouldAddToFileMenuParams } from 'obsidian-dev-utils/obsidian/command-handlers/file-command-handler';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { FileCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/file-command-handler';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { isFileOrFolderCommandBlocked } from '../command-block.ts';
import { runLockedTransaction } from '../locked-transaction.ts';
import { selectFileForSwap } from '../modals/swap-file-modal.ts';
import {
  buildOperationNoticeContent,
  showOperationCompletionNotice,
  showOperationProgressNotice
} from '../operation-notices.ts';
import { recordRecentTarget } from '../recent-targets.ts';
import { swap } from '../swapper.ts';

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
    return !isFileOrFolderCommandBlocked(this.pluginSettingsComponent, file);
  }

  protected override async executeFile(file: TFile): Promise<void> {
    if (this.pluginSettingsComponent.settings.isPathIgnored(file.path)) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot swap file ');
          f.append(await renderInternalLink({ app: this.app, pathOrAbstractFile: file }));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }
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
    // Object now reports the source's old path.
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

  // eslint-disable-next-line obsidian-dev-utils/params-options-name-match -- Override must keep the base param type.
  protected override shouldAddToFileMenu(params: FileCommandHandlerShouldAddToFileMenuParams): boolean {
    super.shouldAddToFileMenu(params);
    return true;
  }
}
