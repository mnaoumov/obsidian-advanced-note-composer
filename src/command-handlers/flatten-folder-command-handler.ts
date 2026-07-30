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
import { isFolder } from 'obsidian-dev-utils/obsidian/file-system';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { join } from 'obsidian-dev-utils/path';

import type { FlattenPreviewRow } from '../flatten-preview.ts';
import type { ConfirmDialogModalResult } from '../modals/confirm-dialog-modal.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { getAvailablePathForAbstractFile } from '../available-folder-path.ts';
import { isFileOrFolderCommandBlocked } from '../command-block.ts';
import { collectFlattenItems } from '../flatten-items.ts';
import { buildFlattenPreviewRows } from '../flatten-preview.ts';
import { runLockedTransaction } from '../locked-transaction.ts';
import { ConfirmDialogModal } from '../modals/confirm-dialog-modal.ts';
import { openModal } from '../open-minimizable-modal.ts';
import { FlattenMode } from '../plugin-settings.ts';

interface BuildFlattenConfirmContentParams {
  readonly app: App;
  readonly folder: TFolder;
  readonly fragment: DocumentFragment;
  readonly mode: FlattenMode;
  readonly parentFolder: TFolder;
  readonly previewRows: readonly FlattenPreviewRow[];
}

interface FlattenFolderCommandHandlerConfirmFlattenParams {
  readonly folder: TFolder;
  readonly mode: FlattenMode;
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
  readonly itemsToMove: readonly TAbstractFile[];
  readonly parentFolder: TFolder;
  readonly vaultTransaction: VaultTransaction;
}

/**
 * The rest of the confirmation dialog's opening sentence, which follows the count of items about to move.
 * A `Record` keyed by the enum, so a new {@link FlattenMode} member is a compile error rather than a
 * dialog silently left without wording.
 */
const FLATTEN_CONFIRM_SUMMARIES: Record<FlattenMode, string> = {
  [FlattenMode.AllChildren]: ' direct children move up one level and the emptied folder is left in place.',
  [FlattenMode.AllFoldersRecursively]: ' folders, from any depth under it, move up to become its siblings. Each keeps its own files, and the folder itself is left in place with its own files and its attachment folder.',
  [FlattenMode.ChildFoldersOnly]: ' child folders move up one level. The folder itself is left in place with its own files and its attachment folder.'
};

/**
 * `Flatten folder` command (issue #105): moves children of the chosen folder up one level, so they become
 * siblings of that folder. Folders keep their internal structure (they are moved wholesale, not
 * collapsed). Links are updated by the underlying rename. Name collisions with existing siblings are
 * de-duplicated. The source folder is left in place (delete it manually if desired) — matching the manual
 * "select all and drag up" workflow the issue describes.
 *
 * WHAT moves is the `flattenMode` setting's call (issues #170/#171), resolved by `flatten-items.ts`:
 * every direct child (the default, and the original behavior), only the direct child folders, or every
 * folder at any depth. The folder-only modes leave the folder's own files — and the attachment folder
 * belonging to them — exactly where they are.
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
    if (this.pluginSettingsComponent.settings.flattenMode === FlattenMode.AllChildren) {
      return folder.children.length > 0;
    }
    /*
     * A folder-only mode needs at least one child folder — and a descendant folder implies one, so the same
     * check covers the recursive mode. The attachment-folder exclusion is deliberately NOT applied here:
     * resolving it is async (it goes through the attachment-location machinery) and `canExecuteFolder` is
     * not. In the corner case where the only child folder IS the attachment folder, the command is offered
     * and `executeFolder` says so with a notice rather than silently doing nothing.
     */
    return folder.children.some((child) => isFolder(child));
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

    const mode = this.pluginSettingsComponent.settings.flattenMode;
    const itemsToMove = await collectFlattenItems({
      app: this.app,
      attachmentExtensions: this.pluginSettingsComponent.settings.attachmentExtensions,
      folder,
      mode
    });

    if (itemsToMove.length === 0) {
      // Only reachable in a folder-only mode: `canExecuteFolder` saw a child folder, and it turned out to
      // Be the attachment folder of a note staying behind.
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('There is nothing to flatten in ');
          f.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: folder }));
          f.appendText(': its only child folders hold attachments of the notes that stay in it.');
        })
      );
      return;
    }

    if (this.pluginSettingsComponent.settings.shouldAskBeforeFlattening) {
      /*
       * Flatten has no target picker, so this dialog is the only chance to see what the command is about
       * to do. It is asked before the lock and the transaction are taken, so cancelling costs nothing.
       */
      const previewRows = buildFlattenPreviewRows({
        app: this.app,
        children: itemsToMove,
        folder,
        parentFolder
      });
      const confirmResult = await this.confirmFlatten({
        folder,
        mode,
        parentFolder,
        previewRows
      });
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
          await this.flattenImpl({
            abortController,
            itemsToMove,
            parentFolder,
            vaultTransaction
          });
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
      mode,
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
              mode,
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
    const { abortController, itemsToMove, parentFolder, vaultTransaction } = params;
    for (const item of itemsToMove) {
      if (abortController.signal.aborted) {
        throw new Error('Flatten folder aborted.');
      }
      /*
       * `item.name` and `item.path` are read AFTER the earlier renames have run: the recursive mode moves a
       * folder before its own sub-folders, and Obsidian's rename cascades to descendants, so a nested item
       * is already at its promoted parent's new path by the time its turn comes.
       */
      const targetPath = getAvailablePathForAbstractFile(this.app, item, join(parentFolder.path, item.name));
      await vaultTransaction.rename(item, targetPath);
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
    mode,
    parentFolder,
    previewRows
  } = params;
  fragment.appendText('Are you sure you want to flatten ');
  appendCodeBlock(fragment, 'Folder');
  fragment.appendText('? Its ');
  appendCodeBlock(fragment, String(previewRows.length));
  fragment.appendText(FLATTEN_CONFIRM_SUMMARIES[mode]);
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
    // A nested item's name is its path under the flattened folder, which is why the arrow is driven by
    // `isRenamed` rather than by comparing the two fields.
    appendCodeBlock(fragment, row.isRenamed ? `${row.name} → ${row.targetName}` : row.name);
    fragment.createEl('br');
  }
}
