import type {
  TFile,
  TFolder
} from 'obsidian';

import type {
  ItemSelectorBaseConstructorParams,
  SelectItemResult
} from './item-selector-base.ts';

import { createNoteFromTypedName } from '../create-note.ts';
import { resolveExistingItemFile } from '../modals/existing-item-file.ts';
import { moveIntoOwnFolder } from '../move-into-own-folder.ts';
import {
  CommandCategory,
  SplitTargetMode
} from '../plugin-settings.ts';
import { ItemSelectorBase } from './item-selector-base.ts';

interface SplitItemSelectorConstructorParams extends ItemSelectorBaseConstructorParams {
  readonly shouldAllowOnlyCurrentFolder: boolean;

  /**
   * Puts the new note into its own folder even when the `shouldSplitIntoFolder` setting is off. Set by the
   * recursive split, whose folder tree IS the feature, so it cannot be at the mercy of that setting.
   */
  readonly shouldForceSplitIntoFolder?: boolean;
  readonly shouldTreatTitleAsPath: boolean;

  /**
   * Whether this split CREATES its target note or MERGES into an existing one (issue #227). It is the
   * picker's switch, and it replaced the implicit `isModifier`-or-nothing-typed rule that used to decide
   * the same fork — which is why `SplitItemSelector` is the one selector that does not read
   * {@link ItemSelectorBaseConstructorParams.isModifier}.
   */
  readonly splitTargetMode: SplitTargetMode;

  /**
   * Creates the new note in THIS folder, whatever `shouldAllowOnlyCurrentFolder` would otherwise have
   * resolved to. Set by the recursive split when the user changed the target of its root pass (issue #205),
   * which is the only way to state a destination that is neither "beside the source" nor Obsidian's default
   * new-note location.
   */
  readonly targetParentFolderOverride?: null | TFolder;
}

export class SplitItemSelector extends ItemSelectorBase {
  private readonly shouldAllowOnlyCurrentFolder: boolean;
  private readonly shouldForceSplitIntoFolder: boolean;
  private readonly shouldTreatTitleAsPath: boolean;
  private readonly splitTargetMode: SplitTargetMode;
  private readonly targetParentFolderOverride: null | TFolder;

  public constructor(params: SplitItemSelectorConstructorParams) {
    super(params);
    this.shouldAllowOnlyCurrentFolder = params.shouldAllowOnlyCurrentFolder;
    this.shouldForceSplitIntoFolder = params.shouldForceSplitIntoFolder ?? false;
    this.shouldTreatTitleAsPath = params.shouldTreatTitleAsPath;
    this.splitTargetMode = params.splitTargetMode;
    this.targetParentFolderOverride = params.targetParentFolderOverride ?? null;
  }

  public override async selectItem(): Promise<SelectItemResult> {
    if (this.splitTargetMode === SplitTargetMode.Merge) {
      const targetFile = resolveExistingItemFile(this.app, this.item);
      // The picker offers nothing creatable in this mode — no `Enter to create` row, no unresolved links —
      // So an item without a file behind it cannot be chosen. Refusing rather than falling through to the
      // Create branch is what keeps an explicit `Merge` from quietly creating a note nobody asked for.
      if (!targetFile) {
        throw new Error('File not found');
      }

      return {
        isNewTargetFile: false,
        targetFile
      };
    }

    if (this.item?.type === 'unresolved') {
      return {
        isNewTargetFile: true,
        targetFile: await this.createNewMarkdownFileFromLinktext(this.item.linktext ?? '')
      };
    }

    const existingFile = this.app.metadataCache.getFirstLinkpathDest(this.inputValue, '');
    // An IGNORED note is absent from the suggestions, so typing its exact name is the only way to reach it
    // — which is why `Create` still resolves to it rather than making a numbered duplicate beside it.
    if (existingFile && this.pluginSettingsComponent.settings.isPathIgnored(existingFile.path, CommandCategory.SplitAndExtract)) {
      return {
        isNewTargetFile: false,
        targetFile: existingFile
      };
    }

    return {
      isNewTargetFile: true,
      targetFile: await this.createNewMarkdownFileFromLinktext(this.inputValue)
    };
  }

  /**
   * Creates the note the picker's `Create` mode resolved to, through the shared
   * {@link createNoteFromTypedName} so the file explorer's `Create empty note in folder...` applies exactly
   * the same naming rules (issue #244).
   *
   * What stays here is what only a SPLIT has: the source note the transform and the links resolve against,
   * the folder prefix the picker's own choices produce, and the own-folder move — whose
   * `splitIntoFolderNoteNameTemplate` reads that source note through its tokens.
   *
   * @param fileName - The name as typed.
   * @returns The created note.
   */
  private async createNewMarkdownFileFromLinktext(fileName: string): Promise<TFile> {
    return await createNoteFromTypedName({
      app: this.app,
      contextFile: this.sourceFile,
      fileName,
      folderPrefix: this.resolveTargetFolderPrefix(),
      pluginSettingsComponent: this.pluginSettingsComponent,
      relocateNote: this.shouldForceSplitIntoFolder || this.pluginSettingsComponent.settings.shouldSplitIntoFolder
        ? async (file: TFile): Promise<null | string> =>
          await moveIntoOwnFolder({
            app: this.app,
            file,
            pluginSettingsComponent: this.pluginSettingsComponent,
            sourceFile: this.sourceFile
          })
        : null,
      shouldTreatTitleAsPath: this.shouldTreatTitleAsPath,
      sourcePath: this.sourceFile.path
    });
  }

  /**
   * The folder named by the note the user picked in the picker, or `null` when they picked nothing that
   * names one (issue #238).
   *
   * A `Create` picks nothing to WRITE into — the target is built from what was typed — so before this the
   * chosen row was read only by the `unresolved` branch and otherwise silently discarded. That is how the
   * reporter's "choose a folder" step did nothing: they clicked `B/Note` and the note was created wherever
   * Obsidian's new-file resolution put it. A picked row now answers WHERE, which is the only question a
   * `Create` still has left once the name is typed.
   *
   * `Mod+Enter` and the `Enter to create` row both choose with no item at all, so forcing a creation keeps
   * resolving exactly as it did. An UNRESOLVED link is left alone for a different reason: it already
   * carries the path it names, so it has no folder to lend.
   *
   * @returns The picked note's folder, or `null`.
   */
  private resolvePickedParentFolder(): null | TFolder {
    if (this.item?.type === 'unresolved') {
      return null;
    }
    return resolveExistingItemFile(this.app, this.item)?.parent ?? null;
  }

  /**
   * The linktext prefix that decides which folder the new note is created in.
   *
   * An explicit override wins over everything: it is the only way to name a folder that is neither the
   * source's own (`shouldAllowOnlyCurrentFolder`) nor whatever Obsidian's new-file resolution picks from an
   * empty prefix. Below it sits the folder of the note the user picked in the picker (issue #238), and only
   * then the original two-way choice, unchanged.
   *
   * The order matters: the override is the answer to a question the user was ASKED (the folder prompt, or
   * the recursive split's changed root — issue #205), while a picked row is a folder they merely implied,
   * so an explicit answer must not be overridden by an implicit one.
   *
   * @returns The prefix to prepend to the file name, or an empty string to let Obsidian resolve the folder.
   */
  private resolveTargetFolderPrefix(): string {
    if (this.targetParentFolderOverride) {
      return `/${this.targetParentFolderOverride.getParentPrefix()}`;
    }
    const pickedParentFolder = this.resolvePickedParentFolder();
    if (pickedParentFolder) {
      return `/${pickedParentFolder.getParentPrefix()}`;
    }
    return this.shouldAllowOnlyCurrentFolder ? `/${this.sourceFile.parent?.getParentPrefix() ?? ''}` : '';
  }
}
