import type {
  AbstractFileCommandHandlerShouldAddToAbstractFileMenuParams,
  AbstractFileCommandHandlerShouldAddToAbstractFilesMenuParams
} from '@mnaoumov/obsidian-lib/command-handlers/abstract-file-command-handler';
import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type { ResourceLockComponent } from '@mnaoumov/obsidian-lib/resource-lock';
import type { VaultTransaction } from '@mnaoumov/obsidian-lib/vault-transaction';
import type {
  App,
  TAbstractFile,
  TFile,
  TFolder
} from 'obsidian';

import { reportBulkOperationProgress } from '@mnaoumov/obsidian-lib/bulk-operation-progress';
import { AbstractFileCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/abstract-file-command-handler';
import {
  isFile,
  isFolder
} from '@mnaoumov/obsidian-lib/file-system';
import { getAvailablePath } from '@mnaoumov/obsidian-lib/vault';
import { join } from '@mnaoumov/typescript-lib/path';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { normalizePath } from 'obsidian';

import type { BulkOperationRunner } from '../bulk-operations/bulk-operation-runner.ts';
import type { LockTarget } from '../composers/locked-transaction.ts';
import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';
import type {
  BulkRenameItem,
  BulkRenamePlan,
  BulkRenameRequest
} from './bulk-rename-plan.ts';

import { runLockedTransaction } from '../composers/locked-transaction.ts';
import { getAvailableFolderPath } from '../folders/available-folder-path.ts';
import {
  resolveFolderNoteConfigFromSettings,
  resolveFolderNoteFromSettings
} from '../folders/folder-note.ts';
import { compareNatural } from '../natural-sort.ts';
import { isFileOrFolderCommandBlocked } from '../settings/command-visibility/command-block.ts';
import { CommandCategory } from '../settings/plugin-settings.ts';
import {
  buildOperationNoticeContent,
  disposeOperationProgressNotice,
  showOperationCompletionNotice,
  showOperationProgressNotice
} from '../ui/operation-notices.ts';
import {
  buildBulkRenamePlan,
  buildBulkRenameSteps
} from './bulk-rename-plan.ts';

/**
 * Parameters for {@link BulkRenameCommandHandler}.
 */
export interface BulkRenameCommandHandlerConstructorParams {
  readonly app: App;
  readonly bulkOperationRunner: BulkOperationRunner;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;

  /**
   * The dialog. Injected so the handler's unit tests can answer it; the plugin passes the real modal.
   */
  readonly selectBulkRenameRequest: SelectBulkRenameRequest;
}

/**
 * Asks the user for the rename options, showing the plan they produce as they are typed.
 *
 * @param params - The app, the number of items and the planner the dialog previews through.
 * @returns The options, or `null` when the dialog was cancelled.
 */
export type SelectBulkRenameRequest = (this: void, params: SelectBulkRenameRequestParams) => Promise<BulkRenameRequest | null>;

/**
 * What the dialog is handed.
 */
export interface SelectBulkRenameRequestParams {
  readonly app: App;

  /**
   * Builds the plan the given options would produce, for the live preview.
   */
  readonly buildPlan: (this: void, options: BulkRenameRequest) => BulkRenamePlan;
}

/**
 * The folders whose folder notes follow them, captured before anything is renamed.
 */
interface FollowingFolderNote {
  readonly folder: TFolder;
  readonly folderNote: TFile;
}

/**
 * `Bulk rename...` — renames every item selected in the file explorer at once: find and replace (plain text or
 * a regular expression), a letter-case change, and a prefix and suffix that take `{{index}}`, so numbering a
 * batch is a prefix such as `{{index:00}}. `.
 *
 * It lives on the explorer's MULTI-item menu only (`files-menu`), which is what core's Alt- and Shift-click
 * selection opens, and what `Explorer Multi-Select`'s More button opens too. A single item already has
 * Obsidian's own rename.
 *
 * Every rename goes through the vault transaction, which renames through `FileManager.renameFile`, so links
 * follow. The whole batch is one locked transaction (all or nothing) and one bulk operation, so with
 * bulk-operation commits on, `Undo a bulk operation...` reverts it.
 */
export class BulkRenameCommandHandler extends AbstractFileCommandHandler {
  private readonly app: App;
  private readonly bulkOperationRunner: BulkOperationRunner;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;
  private readonly selectBulkRenameRequest: SelectBulkRenameRequest;

  public constructor(params: BulkRenameCommandHandlerConstructorParams) {
    super({
      fileMenuSubmenuIcon: 'lucide-git-merge',
      filesMenuItemName: 'Bulk rename...',
      icon: 'lucide-text-cursor-input',
      id: 'bulk-rename',
      name: 'Bulk rename...'
    });

    this.app = params.app;
    this.bulkOperationRunner = params.bulkOperationRunner;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.resourceLockComponent = params.resourceLockComponent;
    this.selectBulkRenameRequest = params.selectBulkRenameRequest;
  }

  protected override canExecuteAbstractFile(abstractFile: TAbstractFile): boolean {
    return this.canBeRenamed(abstractFile);
  }

  protected override canExecuteAbstractFiles(abstractFiles: TAbstractFile[]): boolean {
    return abstractFiles.some((abstractFile) => this.canBeRenamed(abstractFile));
  }

  protected override async executeAbstractFile(abstractFile: TAbstractFile): Promise<void> {
    await this.executeAbstractFiles([abstractFile]);
  }

  protected override async executeAbstractFiles(abstractFiles: TAbstractFile[]): Promise<void> {
    const items = abstractFiles.filter((abstractFile) => this.canBeRenamed(abstractFile)).sort(compareExplorerOrder).map((abstractFile) => toBulkRenameItem(abstractFile));
    if (items.length === 0) {
      return;
    }

    const options = await this.selectBulkRenameRequest({ app: this.app, buildPlan: (dialogOptions) => this.buildPlan(items, dialogOptions) });
    if (!options) {
      return;
    }

    const plan = this.buildPlan(items, options);
    if (plan.error !== null || plan.problemCount > 0 || plan.changedCount === 0 || !await this.rename(plan)) {
      return;
    }

    showOperationCompletionNotice({
      content: await buildOperationNoticeContent({
        app: this.app,
        pluginSettingsComponent: this.pluginSettingsComponent,
        shouldLinkSource: false,
        sourcePathOrAbstractFile: `${plan.changedCount.toString()} item(s)`,
        verb: 'Renamed'
      }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return super.shouldAddCommandToSubmenu() ?? this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  // eslint-disable-next-line typescript-dev-toolkit/params-options-name-match -- Override must keep the base param type.
  protected override shouldAddToAbstractFileMenu(params: AbstractFileCommandHandlerShouldAddToAbstractFileMenuParams): boolean {
    super.shouldAddToAbstractFileMenu(params);
    // One item already has Obsidian's own rename; the bulk rename is for a selection.
    return false;
  }

  // eslint-disable-next-line typescript-dev-toolkit/params-options-name-match -- Override must keep the base param type.
  protected override shouldAddToAbstractFilesMenu(params: AbstractFileCommandHandlerShouldAddToAbstractFilesMenuParams): boolean {
    super.shouldAddToAbstractFilesMenu(params);
    return true;
  }

  protected override shouldAddToCommandPalette(): boolean {
    // The palette has no selection to rename.
    return false;
  }

  private buildPlan(items: readonly BulkRenameItem[], bulkRenameRequest: BulkRenameRequest): BulkRenamePlan {
    return buildBulkRenamePlan({
      isPathOccupied: (path) => this.isPathOccupied(path),
      items,
      request: bulkRenameRequest
    });
  }

  private canBeRenamed(abstractFile: TAbstractFile): boolean {
    return !(isFolder(abstractFile) && abstractFile.isRoot()) && !isFileOrFolderCommandBlocked({ abstractFile, commandCategory: CommandCategory.Rename, pluginSettingsComponent: this.pluginSettingsComponent });
  }

  /**
   * Finds the folder notes that follow their folders: the note of every renamed folder, unless that note is
   * itself in the batch, where the user named it explicitly.
   *
   * @param plan - The plan.
   * @returns The folders with their notes, captured under the folders' OLD names.
   */
  private collectFollowingFolderNotes(plan: BulkRenamePlan): readonly FollowingFolderNote[] {
    const batchPaths = new Set(plan.entries.map((entry) => entry.oldPath));
    const followingFolderNotes: FollowingFolderNote[] = [];
    for (const entry of plan.entries) {
      if (!entry.isChanged || !entry.isFolder) {
        continue;
      }
      const folder = ensureNonNullable(this.app.vault.getFolderByPath(entry.oldPath));
      const folderNote = resolveFolderNoteFromSettings({
        app: this.app,
        folder,
        settings: this.pluginSettingsComponent.settings
      });
      if (folderNote && !batchPaths.has(folderNote.path)) {
        followingFolderNotes.push({ folder, folderNote });
      }
    }
    return followingFolderNotes;
  }

  private isPathOccupied(path: string): boolean {
    const slashIndex = path.lastIndexOf('/');
    const parentPath = slashIndex === -1 ? '/' : path.slice(0, slashIndex);
    const name = path.slice(slashIndex + 1).toLowerCase();
    const parentFolder = this.app.vault.getFolderByPath(parentPath);
    return !!parentFolder && parentFolder.children.some((child) => child.name.toLowerCase() === name);
  }

  /**
   * Runs the renames, then renames each renamed folder's folder note so it keeps being that folder's note,
   * all in one reversible transaction.
   *
   * @param plan - The plan, known to have no problem.
   * @returns Whether the batch ran to completion — `false` when it was cancelled and rolled back.
   */
  private async rename(plan: BulkRenamePlan): Promise<boolean> {
    const abortController = new AbortController();
    const progressNotice = showOperationProgressNotice({
      abortController,
      app: this.app,
      content: () =>
        buildOperationNoticeContent({
          app: this.app,
          isLoading: true,
          pluginSettingsComponent: this.pluginSettingsComponent,
          shouldLinkSource: false,
          sourcePathOrAbstractFile: `${plan.changedCount.toString()} item(s)`,
          verb: 'Renaming'
        }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });

    const lockTargets: LockTarget[] = plan.entries
      .filter((entry) => entry.isChanged)
      .map((entry) => ({ mode: entry.isFolder ? 'subtree' : 'file', pathOrFile: entry.oldPath }));

    try {
      await this.bulkOperationRunner.runBulkOperation({
        operation: () =>
          runLockedTransaction({
            abortController,
            app: this.app,
            body: async (vaultTransaction) => {
              // Captured BEFORE anything is renamed: a folder note named after its folder can only be found
              // under the folder's OLD name.
              const followingFolderNotes = this.collectFollowingFolderNotes(plan);

              const steps = buildBulkRenameSteps({
                entries: plan.entries,
                resolveTemporaryPath: (desiredPath, isFolderPath) => this.resolveTemporaryPath(desiredPath, isFolderPath)
              });
              for (const step of steps) {
                await vaultTransaction.rename(step.fromPath, step.toPath);
                // The batch does not iterate through `loop()`, so it refreshes a bulk-operation commit's lease lock itself.
                reportBulkOperationProgress();
              }

              for (const followingFolderNote of followingFolderNotes) {
                await this.renameFolderNote(followingFolderNote, vaultTransaction);
              }
            },
            lockTargets,
            operationName: 'Bulk rename',
            resourceLockComponent: this.resourceLockComponent
          }),
        summary: `Bulk rename ${plan.changedCount.toString()} item(s)`
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        // The operation was cancelled (user or external change); the transaction has rolled back.
        return false;
      }
      throw error;
    } finally {
      disposeOperationProgressNotice(progressNotice);
    }

    return true;
  }

  /**
   * Renames a folder note so it keeps BEING its folder's folder note, as `Rename folder...` does. Only matters
   * where the note's name is derived from the folder's (`{{folderName}}`); a fixed name resolves the same
   * before and after, and a note `Folder notes` already moved is where it belongs.
   *
   * @param followingFolderNote - The folder, now carrying its new name, and its note.
   * @param vaultTransaction - The transaction owning the operation.
   */
  private async renameFolderNote(followingFolderNote: FollowingFolderNote, vaultTransaction: VaultTransaction): Promise<void> {
    const { folder, folderNote } = followingFolderNote;
    const config = resolveFolderNoteConfigFromSettings({
      app: this.app,
      settings: this.pluginSettingsComponent.settings
    });
    const noteParentPath = ensureNonNullable(folderNote.parent).path;
    const newNotePath = normalizePath(join(noteParentPath, `${config.resolveName(folder).trim()}.${folderNote.extension}`));
    if (newNotePath === folderNote.path) {
      return;
    }
    await vaultTransaction.rename(folderNote, newNotePath);
  }

  /**
   * Finds a free path to park one member of a rename cycle on. The name differs from the final one by more
   * than letter case, so a case-only cycle cannot park an item on its own destination.
   *
   * @param desiredPath - The path the item is heading for.
   * @param isFolderPath - Whether the item is a folder, which has no extension to keep.
   * @returns A free path.
   */
  private resolveTemporaryPath(desiredPath: string, isFolderPath: boolean): string {
    if (isFolderPath) {
      return getAvailableFolderPath(this.app, `${desiredPath} (renaming)`);
    }
    const slashIndex = desiredPath.lastIndexOf('/');
    const dotIndex = desiredPath.lastIndexOf('.');
    const parkedPath = dotIndex > slashIndex
      ? `${desiredPath.slice(0, dotIndex)} (renaming)${desiredPath.slice(dotIndex)}`
      : `${desiredPath} (renaming)`;
    return getAvailablePath(this.app, parkedPath);
  }
}

/**
 * Orders items the way the file explorer lists them: by folder, folders before files, then naturally by name.
 * That is the order the batch is numbered in.
 *
 * @param a - One item.
 * @param b - The other.
 * @returns The comparison.
 */
function compareExplorerOrder(a: TAbstractFile, b: TAbstractFile): number {
  // Never the vault root: only items that can be renamed are sorted, and the root is not one.
  const parentComparison = compareNatural(ensureNonNullable(a.parent).path, ensureNonNullable(b.parent).path);
  if (parentComparison !== 0) {
    return parentComparison;
  }
  const kindComparison = Number(isFile(a)) - Number(isFile(b));
  return kindComparison === 0 ? compareNatural(a.name, b.name) : kindComparison;
}

function toBulkRenameItem(abstractFile: TAbstractFile): BulkRenameItem {
  const parentFolder = ensureNonNullable(abstractFile.parent);
  return {
    extension: isFile(abstractFile) && abstractFile.extension ? `.${abstractFile.extension}` : '',
    isFolder: isFolder(abstractFile),
    name: isFile(abstractFile) ? abstractFile.basename : abstractFile.name,
    parentFolder: parentFolder.name,
    parentFolderPath: parentFolder.path,
    path: abstractFile.path
  };
}
