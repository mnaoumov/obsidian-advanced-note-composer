import type {
  App,
  TFolder
} from 'obsidian';
import type { FolderCommandHandlerShouldAddToFolderMenuParams } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { FolderCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { getAvailablePath } from 'obsidian-dev-utils/obsidian/vault';
import { join } from 'obsidian-dev-utils/path';

import type { ConfirmDialogModalResult } from '../modals/confirm-dialog-modal.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { isFileOrFolderCommandBlocked } from '../command-block.ts';
import { runLockedTransaction } from '../locked-transaction.ts';
import { ConfirmDialogModal } from '../modals/confirm-dialog-modal.ts';
import { selectTargetFolderForMove } from '../modals/move-folder-modal.ts';
import { openMinimizableModal } from '../open-minimizable-modal.ts';
import {
  buildOperationNoticeContent,
  showOperationCompletionNotice,
  showOperationProgressNotice
} from '../operation-notices.ts';

interface BuildMoveConfirmContentParams {
  readonly app: App;
  readonly fragment: DocumentFragment;
  readonly sourceFolder: TFolder;
  readonly targetFolder: TFolder;
}

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

    const targetFolder = await this.resolveTargetFolder(folder);
    if (!targetFolder) {
      return;
    }

    const targetPath = getAvailablePath(this.app, join(targetFolder.path, folder.name));

    // Captured as a string BEFORE the move: the rename mutates `folder.path` to its destination, so the
    // Completion notice would otherwise name the same folder on both sides.
    const sourcePath = folder.path;

    const abortController = new AbortController();
    const progressNotice = showOperationProgressNotice({
      abortController,
      content: () =>
        buildOperationNoticeContent({
          app: this.app,
          isLoading: true,
          sourcePathOrAbstractFile: sourcePath,
          targetPathOrAbstractFile: targetFolder,
          verb: 'Moving folder'
        }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
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
    } finally {
      progressNotice?.[Symbol.dispose]();
    }

    showOperationCompletionNotice({
      content: await buildOperationNoticeContent({
        app: this.app,
        shouldLinkSource: false,
        sourcePathOrAbstractFile: sourcePath,
        targetPathOrAbstractFile: targetPath,
        verb: 'Moved folder'
      }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return super.shouldAddCommandToSubmenu() ?? this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  // eslint-disable-next-line obsidian-dev-utils/params-options-name-match -- Override must keep the base param type.
  protected override shouldAddToFolderMenu(params: FolderCommandHandlerShouldAddToFolderMenuParams): boolean {
    super.shouldAddToFolderMenu(params);
    return true;
  }

  /**
   * Asks before moving the folder into the destination picked in the suggester (issue #154). Mirrors the
   * other flows in mapping "Don't ask again" back onto the flow's own `shouldAskBefore*` setting.
   *
   * @param sourceFolder - The folder being moved.
   * @param targetFolder - The destination chosen in the picker.
   * @returns The dialog result.
   */
  private async confirmMove(sourceFolder: TFolder, targetFolder: TFolder): Promise<ConfirmDialogModalResult> {
    const app = this.app;
    return await new Promise<ConfirmDialogModalResult>((promiseResolve) => {
      openMinimizableModal(
        new ConfirmDialogModal({
          app,
          buildContent: (fragment): Promise<void> =>
            buildMoveConfirmContent({
              app,
              fragment,
              sourceFolder,
              targetFolder
            }),
          canReselectTarget: true,
          confirmButtonMobileText: 'Move and don\'t ask again',
          confirmButtonText: 'Move',
          promiseResolve,
          title: 'Move folder'
        })
      );
    });
  }

  /**
   * Runs the picker and, unless the confirmation is turned off, the confirmation dialog. The dialog's
   * "Change target" action sends the flow back to the picker, so this loops until the user confirms a
   * destination or cancels — the same shape as the swap/merge target-choosing flows.
   *
   * @param folder - The folder being moved.
   * @returns The confirmed destination, or `null` when the flow was cancelled.
   */
  private async resolveTargetFolder(folder: TFolder): Promise<null | TFolder> {
    for (;;) {
      const targetFolder = await selectTargetFolderForMove({
        app: this.app,
        pluginSettingsComponent: this.pluginSettingsComponent,
        sourceFolder: folder
      });
      if (!targetFolder) {
        return null;
      }
      if (!this.pluginSettingsComponent.settings.shouldAskBeforeMovingFolder) {
        return targetFolder;
      }

      const confirmResult = await this.confirmMove(folder, targetFolder);
      if (confirmResult.shouldReselectTarget) {
        // Go back to the folder picker to choose a different destination.
        continue;
      }
      if (!confirmResult.isConfirmed) {
        return null;
      }
      await this.pluginSettingsComponent.editAndSave((settings) => {
        settings.shouldAskBeforeMovingFolder = confirmResult.shouldAskAgain;
      });
      return targetFolder;
    }
  }
}

/**
 * Builds the move confirmation body: the folder being moved and the destination it is going into.
 *
 * @param params - The parameters.
 */
async function buildMoveConfirmContent(params: BuildMoveConfirmContentParams): Promise<void> {
  const {
    app,
    fragment,
    sourceFolder,
    targetFolder
  } = params;
  fragment.appendText('Are you sure you want to move ');
  appendCodeBlock(fragment, 'Source');
  fragment.appendText(' into ');
  appendCodeBlock(fragment, 'Destination');
  fragment.appendText('?');
  fragment.createEl('br');
  fragment.createEl('br');
  appendCodeBlock(fragment, 'Source');
  fragment.appendText(': ');
  fragment.appendChild(await renderInternalLink({ app, pathOrAbstractFile: sourceFolder }));
  fragment.createEl('br');
  fragment.createEl('br');
  appendCodeBlock(fragment, 'Destination');
  fragment.appendText(': ');
  // The destination always exists, so it is a link like every other confirmation dialog's paths
  // (issue #165) — clicking a folder link reveals it in the file explorer, it never creates anything.
  // The root is labelled `/`, matching the picker's own `getItemText`, so the two always agree.
  fragment.appendChild(
    await renderInternalLink({
      app,
      displayText: targetFolder.isRoot() ? '/' : targetFolder.path,
      pathOrAbstractFile: targetFolder
    })
  );
}
