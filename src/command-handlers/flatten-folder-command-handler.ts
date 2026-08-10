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
import { isChildOrSelf } from 'obsidian-dev-utils/obsidian/vault';
import { join } from 'obsidian-dev-utils/path';

import type { CollectFlattenItemsParams } from '../flatten-items.ts';
import type { FlattenPreviewRow } from '../flatten-preview.ts';
import type { ConfirmDialogModalResult } from '../modals/confirm-dialog-modal.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { getAvailablePathForAbstractFile } from '../available-folder-path.ts';
import { isFileOrFolderCommandBlocked } from '../command-block.ts';
import {
  collectFlattenItems,
  collectFlattenItemsSyncOrNull,
  isFlattenModeDistinct
} from '../flatten-items.ts';
import { buildFlattenPreviewRows } from '../flatten-preview.ts';
import { runLockedTransaction } from '../locked-transaction.ts';
import { ConfirmDialogModal } from '../modals/confirm-dialog-modal.ts';
import { selectFolder } from '../modals/select-folder-modal.ts';
import { openConfirmDialogModal } from '../open-minimizable-modal.ts';
import {
  buildOperationNoticeContent,
  showOperationCompletionNotice,
  showOperationProgressNotice
} from '../operation-notices.ts';
import { FlattenMode } from '../plugin-settings.ts';
import { recordRecentTarget } from '../recent-targets.ts';

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

  /**
  Which flatten this handler is. Registered once per {@link FlattenMode}.
  */
  readonly flattenMode: FlattenMode;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

/**
 * The command identity of each flatten (issue #177).
 *
 * `AllChildren` keeps the ORIGINAL `flatten-folder` id, because a hotkey is bound to an id and hotkeys
 * cannot be migrated by a settings converter. Keeping the id on the default mode preserves the binding for
 * everyone who never changed the old `Flatten mode` dropdown; the two new ids start unbound.
 *
 * A `Record` keyed by the enum rather than a `switch`, so a new member is a compile error instead of a
 * command silently left unregistered.
 */
const FLATTEN_COMMAND_DEFINITIONS: Record<FlattenMode, FlattenCommandDefinition> = {
  [FlattenMode.AllChildren]: {
    id: 'flatten-folder',
    name: 'Flatten folder...'
  },
  [FlattenMode.AllFoldersRecursively]: {
    id: 'flatten-folder-all-folders-recursively',
    name: 'Flatten folder recursively (all folders at any depth)...'
  },
  [FlattenMode.ChildFoldersOnly]: {
    id: 'flatten-folder-child-folders-only',
    name: 'Flatten folder (child folders only)...'
  }
};

/**
 * The id and name a flatten command is registered under.
 */
interface FlattenCommandDefinition {
  readonly id: string;
  readonly name: string;
}

interface FlattenFolderCommandHandlerFlattenImplParams {
  readonly abortController: AbortController;
  readonly itemsToMove: readonly TAbstractFile[];
  readonly parentFolder: TFolder;
  readonly vaultTransaction: VaultTransaction;
}

interface FlattenFolderCommandHandlerResolveDestinationFolderParams {
  /**
   * Where the children land unless the user picks somewhere else: the folder's own parent, which is what
   * flatten meant before issue #205 made the destination changeable.
   */
  readonly defaultParentFolder: TFolder;
  readonly folder: TFolder;
  readonly itemsToMove: readonly TAbstractFile[];
  readonly mode: FlattenMode;
}

interface IsAllowedFlattenDestinationParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly sourceFolder: TFolder;
  readonly targetFolder: TFolder;
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
 * WHAT moves is fixed per command (issues #170/#171/#177), resolved by `flatten-items.ts`: every direct
 * child (the original behavior), only the direct child folders, or every folder at any depth. The
 * folder-only modes leave the folder's own files — and the attachment folder belonging to them — exactly
 * where they are.
 *
 * Registered once per {@link FlattenMode}, so the variant is chosen at INVOCATION time from the folder
 * menu (issue #177) rather than pre-committed in settings. That is the faithful translation of the
 * reporter's ask: they modelled it as *flatten* + *flatten recursively* plus a `child folders only`
 * toggle, but {@link FlattenMode} deliberately is NOT that cross product — issues #170/#171 collapsed
 * WHAT-moves × HOW-DEEP into three cells and rejected the fourth (dissolving every descendant FILE into
 * the parent), which nobody asked for. One command per existing member keeps that call.
 *
 * A variant is only OFFERED on a folder where it would move something a simpler variant would not (issue
 * #210) — see {@link FlattenFolderCommandHandler.canExecuteFolder}.
 */
export class FlattenFolderCommandHandler extends FolderCommandHandler {
  private readonly app: App;
  private readonly flattenMode: FlattenMode;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: FlattenFolderCommandHandlerConstructorParams) {
    super({
      fileMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-list-tree',
      ...FLATTEN_COMMAND_DEFINITIONS[params.flattenMode]
    });

    this.app = params.app;
    this.flattenMode = params.flattenMode;
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
    if (this.flattenMode !== FlattenMode.AllChildren && folder.children.every((child) => !isFolder(child))) {
      // Cheapest answer first: a folder-only mode needs at least one child folder — and a descendant folder
      // Implies one, so the same check covers the recursive mode. It also spares the subtree walk below on
      // Every folder-menu open.
      return false;
    }
    /*
     * The attachment-folder exclusion IS applied here (issue #185), through the very collector
     * `executeFolder` uses, so the two cannot disagree about whether anything would move. Every mode goes
     * through it, `AllChildren` included: excluded paths do not move either (issue #193), so its own count
     * is no longer just `folder.children.length`.
     *
     * `null` means an attachment-location plugin (Custom Attachment Location and friends) owns the
     * resolution and it is genuinely asynchronous, which Obsidian's synchronous menu / `checkCallback` pass
     * cannot wait for. There the original behavior stands verbatim: the command is offered, and
     * `executeFolder` says so with a notice rather than silently doing nothing.
     */
    const collectFlattenItemsParams = this.buildCollectFlattenItemsParams(folder);
    const itemsToMove = collectFlattenItemsSyncOrNull(collectFlattenItemsParams);
    if (!itemsToMove) {
      return true;
    }
    if (itemsToMove.length === 0) {
      return false;
    }
    /*
     * Nothing is offered twice (issue #210): a mode that would move exactly what a simpler variant moves is
     * a second menu entry promising the same result. The reporter met it as `Flatten folder recursively (all
     * folders at any depth)...` on a folder whose sub-folders hold no sub-folders of their own, where it can
     * only repeat `Flatten folder (child folders only)...`; the same collision exists one step over, on a
     * folder holding nothing but folders. The SIMPLER variant is the one kept, which is why this can only
     * ever hide the two newer commands and never `Flatten folder...` — the one carrying the original command
     * id and any hotkey bound to it.
     */
    return isFlattenModeDistinct({ ...collectFlattenItemsParams, items: itemsToMove });
  }

  protected override async executeFolder(folder: TFolder): Promise<void> {
    if (this.pluginSettingsComponent.settings.isPathIgnored(folder.path)) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot flatten folder ');
          f.append(await renderInternalLink({ app: this.app, pathOrAbstractFile: folder }));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }

    const defaultParentFolder = folder.parent;
    /* v8 ignore start -- a non-root folder always has a parent. */
    if (!defaultParentFolder) {
      return;
    }
    /* v8 ignore stop */

    const mode = this.flattenMode;
    const itemsToMove = await collectFlattenItems(this.buildCollectFlattenItemsParams(folder));

    if (itemsToMove.length === 0) {
      // Only reachable in a folder-only mode, and only in a vault where an attachment-location plugin owns
      // The resolution: everywhere else `canExecuteFolder` already answered this synchronously and never
      // Offered the command (issue #185) — both of the other reasons a folder is left alone (excluded, or
      // The configured attachment folder) are themselves synchronous.
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('There is nothing to flatten in ');
          f.append(await renderInternalLink({ app: this.app, pathOrAbstractFile: folder }));
          f.appendText(': its only child folders hold attachments of the notes that stay in it, are excluded in the plugin settings, or are the configured attachment folder.');
        })
      );
      return;
    }

    const parentFolder = await this.resolveDestinationFolder({
      defaultParentFolder,
      folder,
      itemsToMove,
      mode
    });
    if (!parentFolder) {
      return;
    }

    const abortController = new AbortController();
    const progressNotice = showOperationProgressNotice({
      abortController,
      content: () =>
        buildOperationNoticeContent({
          app: this.app,
          isLoading: true,
          sourcePathOrAbstractFile: folder,
          targetPathOrAbstractFile: parentFolder,
          verb: 'Flattening folder'
        }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
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
    } finally {
      progressNotice?.[Symbol.dispose]();
    }

    // The flatten landed, so the folder its items were promoted into counts as clicked-on for the next
    // Picker (issue #206).
    recordRecentTarget(parentFolder);

    showOperationCompletionNotice({
      content: await buildOperationNoticeContent({
        app: this.app,
        sourcePathOrAbstractFile: folder,
        suffix: `, promoting ${String(itemsToMove.length)} item(s)`,
        targetPathOrAbstractFile: parentFolder,
        verb: 'Flattened folder'
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
   * The ONE place the collector's inputs are assembled, so `canExecuteFolder` and `executeFolder` cannot
   * hand it different settings and disagree about what would move.
   *
   * @param folder - The folder being flattened.
   * @returns The collector parameters.
   */
  private buildCollectFlattenItemsParams(folder: TFolder): CollectFlattenItemsParams {
    const { settings } = this.pluginSettingsComponent;
    return {
      app: this.app,
      attachmentExtensions: settings.attachmentExtensions,
      folder,
      isPathIgnored: (path) => settings.isPathIgnored(path),
      mode: this.flattenMode
    };
  }

  /**
   * Asks before promoting the folder's children, listing every one of them (issue #154). Mirrors the other
   * flows in mapping "Don't ask again" back onto the flow's own `shouldAskBefore*` setting.
   *
   * "Change target" is enabled (issue #205): the destination DEFAULTS to the folder's own parent, but it is
   * not fixed to it — see {@link FlattenFolderCommandHandler.resolveDestinationFolder}.
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
      openConfirmDialogModal(
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
          canReselectTarget: true,
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

  /**
   * Runs the confirmation dialog and, whenever it comes back with "Change target", the destination picker —
   * looping until the user confirms a destination or cancels (issue #205).
   *
   * The loop is INVERTED relative to the picker-first flows (merge/move/swap, e.g.
   * `MoveFolderCommandHandler.resolveTargetFolder`): flatten's destination is DERIVED — the folder's own
   * parent — so the picker must not run first. It appears only when asked for, and the preview rows are
   * rebuilt each pass so the dialog never lists where the children were going to land before the change.
   *
   * Cancelling the picker returns to the same dialog with the destination unchanged, rather than abandoning
   * the flatten: "Change target" is a detour, and cancelling a detour is not cancelling the journey.
   *
   * @param params - The parameters.
   * @returns The confirmed destination, or `null` when the flow was cancelled.
   */
  private async resolveDestinationFolder(params: FlattenFolderCommandHandlerResolveDestinationFolderParams): Promise<null | TFolder> {
    const { defaultParentFolder, folder, itemsToMove, mode } = params;
    if (!this.pluginSettingsComponent.settings.shouldAskBeforeFlattening) {
      return defaultParentFolder;
    }

    let parentFolder = defaultParentFolder;
    for (;;) {
      /*
       * Flatten has no target picker of its own, so this dialog is the only chance to see what the command
       * is about to do. It is asked before the lock and the transaction are taken, so cancelling costs
       * nothing.
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
      if (confirmResult.shouldReselectTarget) {
        const selectedFolder = await selectFolder({
          app: this.app,
          isAllowedFolder: (targetFolder) =>
            isAllowedFlattenDestination({
              app: this.app,
              pluginSettingsComponent: this.pluginSettingsComponent,
              sourceFolder: folder,
              targetFolder
            }),
          placeholder: 'Select folder to flatten into...',
          pluginSettingsComponent: this.pluginSettingsComponent
        });
        if (selectedFolder) {
          parentFolder = selectedFolder;
        }
        continue;
      }
      if (!confirmResult.isConfirmed) {
        return null;
      }
      await this.pluginSettingsComponent.editAndSave((settings) => {
        settings.shouldAskBeforeFlattening = confirmResult.shouldAskAgain;
      });
      return parentFolder;
    }
  }
}

/**
 * Whether `targetFolder` is a valid destination for flattening `sourceFolder`'s children into it: not the
 * source itself or one of its descendants (the children are already inside it, and a folder cannot be moved
 * into its own subtree), and not an ignored path.
 *
 * Deliberately NOT `isAllowedMoveTarget`, which additionally rejects the source's current parent as a
 * no-op. Here that parent is flatten's DEFAULT destination, so it has to stay offered — picking it is how
 * the user undoes a change of mind and goes back to plain flatten.
 *
 * @param params - The parameters.
 * @returns Whether the folder is offered as a flatten destination.
 */
export function isAllowedFlattenDestination(params: IsAllowedFlattenDestinationParams): boolean {
  const { app, pluginSettingsComponent, sourceFolder, targetFolder } = params;
  if (isChildOrSelf({ app, childPathOrFile: targetFolder, parentPathOrFile: sourceFolder })) {
    return false;
  }
  return !pluginSettingsComponent.settings.isPathIgnored(targetFolder.path);
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
  fragment.append(await renderInternalLink({ app, pathOrAbstractFile: folder }));
  fragment.createEl('br');
  fragment.createEl('br');
  appendCodeBlock(fragment, 'Destination');
  fragment.appendText(': ');
  // The destination always exists (it is the folder's own parent), so it is a link like every other
  // Confirmation dialog's paths (issue #165) — clicking a folder link reveals it in the file explorer,
  // It never creates anything. The root is labelled `/`, matching the move picker's `getItemText`.
  fragment.append(
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
