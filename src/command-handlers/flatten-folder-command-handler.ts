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
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { getAvailablePath } from 'obsidian-dev-utils/obsidian/vault';
import { join } from 'obsidian-dev-utils/path';

import type { FlattenPreviewRow } from '../flatten-preview.ts';
import type { ConfirmDialogModalResult } from '../modals/confirm-dialog-modal.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { isFileOrFolderCommandBlocked } from '../command-block.ts';
import { buildFlattenPreviewRows } from '../flatten-preview.ts';
import { runLockedTransaction } from '../locked-transaction.ts';
import { ConfirmDialogModal } from '../modals/confirm-dialog-modal.ts';
import { openModal } from '../open-minimizable-modal.ts';

interface BuildFlattenConfirmContentParams {
  readonly app: App;
  readonly folder: TFolder;
  readonly fragment: DocumentFragment;
  readonly parentFolder: TFolder;
  readonly previewRows: readonly FlattenPreviewRow[];
}

interface FlattenFolderCommandHandlerConfirmFlattenParams {
  readonly folder: TFolder;
  readonly parentFolder: TFolder;
  readonly previewRows: readonly FlattenPreviewRow[];
}

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
    if (isFileOrFolderCommandBlocked(this.pluginSettingsComponent, folder)) {
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

    if (this.pluginSettingsComponent.settings.shouldAskBeforeFlattening) {
      /*
       * Flatten has no target picker, so this dialog is the only chance to see what the command is about
       * to do. It is asked before the lock and the transaction are taken, so cancelling costs nothing.
       */
      const previewRows = buildFlattenPreviewRows({ app: this.app, children, parentFolder });
      const confirmResult = await this.confirmFlatten({ folder, parentFolder, previewRows });
      if (!confirmResult.isConfirmed) {
        return;
      }
      await this.pluginSettingsComponent.editAndSave((settings) => {
        settings.shouldAskBeforeFlattening = confirmResult.shouldAskAgain;
      });
    }

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

  /**
   * Asks before promoting the folder's children, listing every one of them (issue #154). There is no
   * target to reselect — the destination is always the folder's own parent — so the dialog's
   * "Change target" action is disabled. Mirrors the other flows in mapping "Don't ask again" back onto
   * the flow's own `shouldAskBefore*` setting.
   *
   * @param params - The parameters.
   * @returns The dialog result.
   */
  private async confirmFlatten(params: FlattenFolderCommandHandlerConfirmFlattenParams): Promise<ConfirmDialogModalResult> {
    const {
      folder,
      parentFolder,
      previewRows
    } = params;
    const app = this.app;
    return await new Promise<ConfirmDialogModalResult>((promiseResolve) => {
      openModal(
        new ConfirmDialogModal({
          app,
          buildContent: (fragment): Promise<void> =>
            buildFlattenConfirmContent({
              app,
              folder,
              fragment,
              parentFolder,
              previewRows
            }),
          canReselectTarget: false,
          confirmButtonMobileText: 'Flatten and don\'t ask again',
          confirmButtonText: 'Flatten',
          promiseResolve,
          title: 'Flatten folder'
        })
      );
    });
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

/**
 * Builds the flatten confirmation body: what is being flattened, where its children land, and the full
 * list of those children — the command has no preview otherwise.
 *
 * @param params - The parameters.
 */
async function buildFlattenConfirmContent(params: BuildFlattenConfirmContentParams): Promise<void> {
  const {
    app,
    folder,
    fragment,
    parentFolder,
    previewRows
  } = params;
  fragment.appendText('Are you sure you want to flatten ');
  appendCodeBlock(fragment, 'Folder');
  fragment.appendText('? Its ');
  appendCodeBlock(fragment, String(previewRows.length));
  fragment.appendText(' direct children move up one level and the emptied folder is left in place.');
  fragment.createEl('br');
  fragment.createEl('br');
  appendCodeBlock(fragment, 'Folder');
  fragment.appendText(': ');
  fragment.appendChild(await renderInternalLink({ app, pathOrAbstractFile: folder }));
  fragment.createEl('br');
  fragment.createEl('br');
  appendCodeBlock(fragment, 'Destination');
  fragment.appendText(': ');
  // The destination always exists (it is the folder's own parent), so it is a link like every other
  // Confirmation dialog's paths (issue #165) — clicking a folder link reveals it in the file explorer,
  // It never creates anything. The root is labelled `/`, matching the move picker's `getItemText`.
  fragment.appendChild(
    await renderInternalLink({
      app,
      displayText: parentFolder.isRoot() ? '/' : parentFolder.path,
      pathOrAbstractFile: parentFolder
    })
  );
  fragment.createEl('br');
  fragment.createEl('br');
  fragment.createEl('h2', { text: 'Items that will be moved' });
  for (const row of previewRows) {
    // A renamed item is shown as `old → new`, so a de-duplicated collision is visible before it happens.
    appendCodeBlock(fragment, row.name === row.targetName ? row.name : `${row.name} → ${row.targetName}`);
    fragment.createEl('br');
  }
}
