import type {
  App,
  TFile,
  TFolder
} from 'obsidian';
import type { FolderCommandHandlerShouldAddToFolderMenuParams } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';
import type { VaultTransaction } from 'obsidian-dev-utils/obsidian/vault-transaction';

import { normalizePath } from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { FolderCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/folder-command-handler';
import {
  isFile,
  isFolder
} from 'obsidian-dev-utils/obsidian/file-system';
import {
  parseFrontmatter,
  setFrontmatter
} from 'obsidian-dev-utils/obsidian/frontmatter';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { getAvailablePath } from 'obsidian-dev-utils/obsidian/vault';
import {
  basename,
  join
} from 'obsidian-dev-utils/path';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type {
  RenumberedItem,
  ReorderItemInput
} from '../reorder-items.ts';

import { getAvailableFolderPath } from '../available-folder-path.ts';
import { isFileOrFolderCommandBlocked } from '../command-block.ts';
import {
  resolveFolderNote,
  resolveFolderNoteConfig
} from '../folder-note.ts';
import { runLockedTransaction } from '../locked-transaction.ts';
import { didConfirmReorderModal } from '../modals/reorder-modal.ts';
import { compareNatural } from '../natural-sort.ts';
import { parseNumberedName } from '../numbered-name.ts';
import {
  buildOperationNoticeContent,
  showOperationCompletionNotice,
  showOperationProgressNotice
} from '../operation-notices.ts';
import { recordRecentTarget } from '../recent-targets.ts';
import { ReorderItemsModel } from '../reorder-items-model.ts';
import {
  BASE_TOKEN_KEYS,
  buildRenameSteps,
  buildRenumberPlan,
  ReorderItemKind
} from '../reorder-items.ts';
import {
  resolveCreateFolderTemplateTokens,
  resolveFolderTemplateTokens,
  resolveReorderedFileTemplateTokens
} from '../template-tokens.ts';

/**
 * Parameters for {@link ReorderItemsCommandHandlerBase} — what a concrete reorder command passes, plus the
 * identity it registers under.
 */
export interface ReorderItemsCommandHandlerBaseConstructorParams extends ReorderItemsCommandHandlerParams {
  readonly commandId: string;
  readonly commandName: string;
}

/**
 * What the plugin passes to either reorder command. The command's own id and name are not here — each
 * command supplies its own.
 */
export interface ReorderItemsCommandHandlerParams {
  readonly app: App;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

/**
 * The smallest number of items a group needs before reordering means anything.
 */
const MIN_REORDERABLE_ITEM_COUNT = 2;

const TITLE_PROPERTY_NAME = 'title';

interface PlannedReorderFile {
  readonly file: TFile;
  readonly item: RenumberedItem;
  readonly kind: ReorderItemKind.File;
}

interface PlannedReorderFolder {
  readonly folder: TFolder;
  readonly item: RenumberedItem;
  readonly kind: ReorderItemKind.Folder;
}

/**
 * One renumbered item, discriminated by its kind so that nothing downstream has to re-derive whether a path
 * is a folder or a note — and so the vault object each step needs is simply there.
 *
 * The object is the LIVE one: Obsidian renames in place, so this same instance reports the NEW path once
 * the renames have run.
 */
type PlannedReorderItem = PlannedReorderFile | PlannedReorderFolder;

/**
 * The shared half of `Reorder sibling folders...` and `Reorder child folders...` (issue #216) — everything
 * except WHICH folder supplies the items.
 *
 * The whole sequence is renumbered on confirm, not only the item that moved: that is what the reporter's
 * own `folder-note-extended` does, and the only thing that keeps the numbering contiguous. Folders and
 * files are renumbered as two independent sequences, since the file explorer always sorts folders above
 * files.
 */
export abstract class ReorderItemsCommandHandlerBase extends FolderCommandHandler {
  protected readonly app: App;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;

  protected constructor(params: ReorderItemsCommandHandlerBaseConstructorParams) {
    super({
      fileMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-list-ordered',
      id: params.commandId,
      name: params.commandName
    });

    this.app = params.app;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.resourceLockComponent = params.resourceLockComponent;
  }

  protected override canExecuteFolder(folder: TFolder): boolean {
    super.canExecuteFolder(folder);
    if (isFileOrFolderCommandBlocked(this.pluginSettingsComponent, folder)) {
      return false;
    }

    const parentFolder = this.resolveParentFolder(folder);
    return !!parentFolder && this.collectItems(parentFolder, ReorderItemKind.Folder).length >= MIN_REORDERABLE_ITEM_COUNT;
  }

  protected override async executeFolder(folder: TFolder): Promise<void> {
    const parentFolder = this.resolveParentFolder(folder);
    if (!parentFolder) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot reorder around ');
          f.append(await renderInternalLink({ app: this.app, pathOrAbstractFile: folder }));
          f.appendText(' because it has no parent folder.');
        })
      );
      return;
    }

    if (this.pluginSettingsComponent.settings.isPathIgnored(parentFolder.path)) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot reorder the contents of ');
          f.append(await renderInternalLink({ app: this.app, pathOrAbstractFile: parentFolder }));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }

    const settings = this.pluginSettingsComponent.settings;
    const model = new ReorderItemsModel({
      fileItems: this.collectItems(parentFolder, ReorderItemKind.File),
      fileNameTemplate: settings.reorderedFileNameTemplate,
      folderItems: this.collectItems(parentFolder, ReorderItemKind.Folder),
      folderNameTemplate: settings.reorderedFolderNameTemplate,
      shouldIncludeFiles: settings.shouldIncludeFilesWhenReorderingByDefault
    });

    const isConfirmed = await didConfirmReorderModal({
      app: this.app,
      confirmButtonText: 'Reorder',
      description: 'Drag an item, or move it with the arrows. Folders and notes are numbered separately, and every item is renumbered to match the order you leave.',
      model,
      title: `Reorder ${parentFolder.isRoot() ? '/' : parentFolder.name}`,
      toggle: {
        isEnabled: settings.shouldIncludeFilesWhenReorderingByDefault,
        label: 'Include files',
        onChanged: (isEnabled) => {
          model.setShouldIncludeFiles(isEnabled);
        }
      }
    });
    if (!isConfirmed) {
      return;
    }

    const plan = [
      ...this.buildPlan(model, parentFolder, ReorderItemKind.Folder),
      ...this.buildPlan(model, parentFolder, ReorderItemKind.File)
    ];
    const renamedItems = plan.filter((plannedItem) => plannedItem.item.newPath !== plannedItem.item.oldPath);
    if (renamedItems.length === 0) {
      return;
    }

    if (!await this.reorder(plan, parentFolder)) {
      return;
    }

    recordRecentTarget(parentFolder);
    showOperationCompletionNotice({
      content: await buildOperationNoticeContent({
        app: this.app,
        preposition: 'in',
        shouldLinkSource: false,
        sourcePathOrAbstractFile: `${renamedItems.length.toString()} item(s)`,
        targetPathOrAbstractFile: parentFolder,
        verb: 'Reordered'
      }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }

  /**
   * Resolves the folder whose children are reordered — the whole difference between the two commands.
   *
   * @param folder - The folder the command was invoked on.
   * @returns The folder holding the items, or `null` when this command has nothing to reorder there.
   */
  protected abstract resolveParentFolder(folder: TFolder): null | TFolder;

  protected override shouldAddCommandToSubmenu(): boolean {
    return super.shouldAddCommandToSubmenu() ?? this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  // eslint-disable-next-line obsidian-dev-utils/params-options-name-match -- Override must keep the base param type.
  protected override shouldAddToFolderMenu(params: FolderCommandHandlerShouldAddToFolderMenuParams): boolean {
    super.shouldAddToFolderMenu(params);
    return true;
  }

  private buildPlan(model: ReorderItemsModel, parentFolder: TFolder, kind: ReorderItemKind): readonly PlannedReorderItem[] {
    const items = model.getOrderedItems(kind);
    if (items.length === 0) {
      return [];
    }

    const settings = this.pluginSettingsComponent.settings;
    return buildRenumberPlan({
      items,
      kind,
      nameTemplate: kind === ReorderItemKind.File ? settings.reorderedFileNameTemplate : settings.reorderedFolderNameTemplate,
      parentFolder: parentFolder.name,
      parentFolderPath: parentFolder.path
    }).map((item): PlannedReorderItem =>
      // The LIVE object, captured now rather than looked up later: Obsidian renames in place, so this same
      // Instance carries the new path afterwards. Every later step therefore needs no lookup — and no
      // "what if it is gone" branch that nothing could reach.
      kind === ReorderItemKind.File
        ? { file: ensureNonNullable(this.app.vault.getFileByPath(item.oldPath)), item, kind }
        : { folder: ensureNonNullable(this.app.vault.getFolderByPath(item.oldPath)), item, kind }
    );
  }

  /**
   * Records what each renumbered folder's folder note is currently CALLED, before any rename happens.
   *
   * @param plan - Every item's new name, both kinds together.
   * @returns The folder note's file name, keyed by its folder's old path. A folder with no folder note is
   * simply absent.
   */
  private collectFolderNotes(plan: readonly PlannedReorderItem[]): ReadonlyMap<string, TFile> {
    const settings = this.pluginSettingsComponent.settings;
    const folderNotesByOldPath = new Map<string, TFile>();

    for (const plannedItem of plan) {
      if (plannedItem.kind === ReorderItemKind.File) {
        continue;
      }

      const folderNote = resolveFolderNote({
        app: this.app,
        folder: plannedItem.folder,
        location: settings.folderNoteLocation,
        nameTemplate: settings.folderNoteNameTemplate
      });
      if (folderNote) {
        folderNotesByOldPath.set(plannedItem.item.oldPath, folderNote);
      }
    }

    return folderNotesByOldPath;
  }

  /**
   * Lists the reorderable children of one kind, in the order the modal first shows them: already-numbered
   * items in their current order, then the unnumbered ones by name — the reporter's own ordering, and the
   * only one under which the first reorder is a no-op for a vault that is already numbered.
   *
   * Items ignored by the plugin's paths are left out entirely, so a reorder can neither rename nor
   * renumber around them.
   *
   * @param parentFolder - The folder holding the items.
   * @param kind - Which kind to list.
   * @returns The items.
   */
  private collectItems(parentFolder: TFolder, kind: ReorderItemKind): readonly ReorderItemInput[] {
    const settings = this.pluginSettingsComponent.settings;
    const nameTemplate = kind === ReorderItemKind.File ? settings.reorderedFileNameTemplate : settings.reorderedFolderNameTemplate;

    return parentFolder.children
      .filter((child) => (kind === ReorderItemKind.File ? isFile(child) : isFolder(child)) && !settings.isPathIgnored(child.path))
      .map((child) =>
        isFile(child)
          ? { extension: `.${child.extension}`, name: child.basename, path: child.path }
          : { extension: '', name: child.name, path: child.path }
      )
      .sort((a, b) => {
        const aIndex = parseNumberedName({ baseTokenKey: BASE_TOKEN_KEYS[kind], name: a.name, nameTemplate }).index;
        const bIndex = parseNumberedName({ baseTokenKey: BASE_TOKEN_KEYS[kind], name: b.name, nameTemplate }).index;
        if (aIndex !== null && bIndex !== null) {
          return aIndex - bIndex;
        }
        if (aIndex !== null) {
          return -1;
        }
        if (bIndex !== null) {
          return 1;
        }
        return compareNatural(a.name, b.name);
      });
  }

  /**
   * Renames each renumbered folder's folder note so it keeps BEING that folder's folder note.
   *
   * Only matters where the folder-note name is derived from the folder's own name (`{{folderName}}`, the
   * commonest layout and the `Auto` fallback): renaming `1. Alpha` to `3. Alpha` would otherwise leave its
   * note called `1. Alpha.md`, which by that very rule is no longer a folder note — the rename would
   * quietly dissolve the relationship it exists to maintain. A fixed name (`!`, `index`) resolves to the
   * same name before and after, so nothing happens.
   *
   * Skipped when the note has already moved itself: with `Folder notes` installed and `syncFolderName` on,
   * that plugin renames it as soon as the folder is renamed, and it is already where it belongs.
   *
   * @param plan - Every item's new name, both kinds together.
   * @param folderNoteNamesByOldPath - What each folder's note was called before the renames.
   * @param vaultTransaction - The transaction owning the operation.
   */
  private async renameFolderNotes(
    plan: readonly PlannedReorderItem[],
    folderNotesByOldPath: ReadonlyMap<string, TFile>,
    vaultTransaction: VaultTransaction
  ): Promise<void> {
    const settings = this.pluginSettingsComponent.settings;

    for (const plannedItem of plan) {
      const folderNote = folderNotesByOldPath.get(plannedItem.item.oldPath);
      if (!folderNote || plannedItem.kind === ReorderItemKind.File) {
        continue;
      }

      const folder = plannedItem.folder;

      const config = resolveFolderNoteConfig({
        app: this.app,
        location: settings.folderNoteLocation,
        nameTemplate: settings.folderNoteNameTemplate
      });
      // The note's own path is LIVE: an inside-the-folder note moved with its folder's rename, and a
      // `Folder notes` install with `syncFolderName` on may already have renamed it outright.
      const noteParentPath = ensureNonNullable(folderNote.parent).path;
      // Never empty: `collectFolderNotes` only recorded this note because the same template resolved to a
      // Name, and the only token it can carry is the folder's own name.
      const newNoteName = resolveFolderTemplateTokens({ sourceFolder: folder, template: config.nameTemplate }).trim();
      const newNotePath = normalizePath(join(noteParentPath, `${newNoteName}.${folderNote.extension}`));
      if (newNotePath === folderNote.path) {
        continue;
      }

      await vaultTransaction.rename(folderNote, newNotePath);
    }
  }

  /**
   * Performs the renames and the property writes in one reversible transaction.
   *
   * @param plan - Every item's new name, both kinds together.
   * @param parentFolder - The folder holding them, subtree-locked for the operation.
   * @returns Whether the reorder ran to completion — `false` when it was cancelled and rolled back.
   */
  private async reorder(plan: readonly PlannedReorderItem[], parentFolder: TFolder): Promise<boolean> {
    const abortController = new AbortController();
    const progressNotice = showOperationProgressNotice({
      abortController,
      content: () =>
        buildOperationNoticeContent({
          app: this.app,
          isLoading: true,
          sourcePathOrAbstractFile: parentFolder,
          verb: 'Reordering the contents of'
        }),
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent
    });

    try {
      await runLockedTransaction({
        abortController,
        app: this.app,
        body: async (vaultTransaction) => {
          // Captured BEFORE anything is renamed: a folder note named after its folder can only be found
          // Under the folder's OLD name.
          const folderNotesByOldPath = this.collectFolderNotes(plan);

          const kindsByNewPath = new Map(plan.map((plannedItem) => [plannedItem.item.newPath, plannedItem.kind]));
          const renameSteps = buildRenameSteps({
            items: plan.map((plannedItem) => plannedItem.item),
            resolveTemporaryPath: (desiredPath) => this.resolveTemporaryPath(desiredPath, ensureNonNullable(kindsByNewPath.get(desiredPath)))
          });
          for (const step of renameSteps) {
            await vaultTransaction.rename(step.fromPath, step.toPath);
          }

          await this.renameFolderNotes(plan, folderNotesByOldPath, vaultTransaction);
          await this.writeTitles(plan, vaultTransaction);
        },
        lockTargets: [{ mode: 'subtree', pathOrFile: parentFolder.path }],
        operationName: 'Reorder',
        resourceLockComponent: this.resourceLockComponent
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        // The operation was cancelled (user or external change); the transaction has rolled back.
        return false;
      }
      throw error;
    } finally {
      progressNotice?.[Symbol.dispose]();
    }

    return true;
  }

  /**
   * The note whose `title` a renumbered item owns: a FILE is its own note, a FOLDER is described by its
   * folder note.
   *
   * @param plannedItem - The renumbered item.
   * @returns The note, or `null` when a folder has no folder note (or this vault has none at all).
   */
  private resolveNoteToTitle(plannedItem: PlannedReorderItem): null | TFile {
    if (plannedItem.kind === ReorderItemKind.File) {
      // A file is its own note.
      return plannedItem.file;
    }

    const settings = this.pluginSettingsComponent.settings;
    return resolveFolderNote({
      app: this.app,
      folder: plannedItem.folder,
      location: settings.folderNoteLocation,
      nameTemplate: settings.folderNoteNameTemplate
    });
  }

  /**
   * Finds a free path for the one item a rename cycle has to park out of the way.
   *
   * Which de-duplicator applies is decided by the item's KIND rather than by whether the path contains a
   * dot: a folder is perfectly entitled to be called `v1.2`, and reading that as an extension would append
   * the disambiguating suffix in the wrong place.
   *
   * @param desiredPath - The final path it is heading for.
   * @param kind - What is being parked.
   * @returns A path nothing occupies.
   */
  private resolveTemporaryPath(desiredPath: string, kind: ReorderItemKind): string {
    return kind === ReorderItemKind.File
      ? getAvailablePath(this.app, desiredPath)
      : getAvailableFolderPath(this.app, desiredPath);
  }

  /**
   * Renders the `title` an item's note should carry, through its kind's own template and vocabulary.
   *
   * @param plannedItem - The renumbered item.
   * @returns The title, or an empty string when this kind's template is empty — the opt-out that leaves the
   * property alone.
   */
  private resolveTitle(plannedItem: PlannedReorderItem): string {
    const { item, kind } = plannedItem;
    const settings = this.pluginSettingsComponent.settings;
    const template = kind === ReorderItemKind.File ? settings.reorderedFileTitleTemplate : settings.folderNoteTitleTemplate;
    if (!template) {
      return '';
    }

    const parentFolderPath = item.newPath.slice(0, Math.max(0, item.newPath.lastIndexOf('/')));
    const parentFolder = basename(parentFolderPath);

    if (kind === ReorderItemKind.File) {
      const extensionIndex = item.newName.lastIndexOf('.');
      return resolveReorderedFileTemplateTokens({
        template,
        tokens: {
          extension: item.newName.slice(extensionIndex),
          index: item.index,
          name: item.newName.slice(0, extensionIndex),
          parentFolder,
          parentFolderPath,
          path: item.newPath,
          safeName: item.baseName
        }
      }).trim();
    }

    return resolveCreateFolderTemplateTokens({
      template,
      tokens: {
        folderName: item.newName,
        folderPath: item.newPath,
        index: item.index,
        parentFolder,
        parentFolderPath,
        rawFolderName: '',
        safeFolderName: item.baseName
      }
    }).trim();
  }

  /**
   * Writes the `title` property of everything that was renumbered.
   *
   * Runs AFTER every rename and re-resolves each folder note from the folder's NEW path, deliberately: with
   * the `Folder notes` plugin installed and its `syncFolderName` on, it renames the folder note itself when
   * the folder is renamed, so a `TFile` captured beforehand would point at a path that no longer exists.
   *
   * The write goes through the transaction rather than `processFrontMatter`, so a cancelled reorder rolls
   * the properties back together with the names.
   *
   * @param plan - Every item's new name, both kinds together.
   * @param vaultTransaction - The transaction owning the operation.
   */
  private async writeTitles(plan: readonly PlannedReorderItem[], vaultTransaction: VaultTransaction): Promise<void> {
    for (const plannedItem of plan) {
      const title = this.resolveTitle(plannedItem);
      if (!title) {
        continue;
      }

      const noteFile = this.resolveNoteToTitle(plannedItem);
      if (!noteFile) {
        continue;
      }

      await vaultTransaction.process(noteFile, (content) =>
        setFrontmatter(content, {
          ...parseFrontmatter(content),
          [TITLE_PROPERTY_NAME]: title
        }));
    }
  }
}
