import type {
  TFile,
  TFolder
} from 'obsidian';

import { normalizePath } from 'obsidian';
import { addAlias } from 'obsidian-dev-utils/obsidian/file-manager';
import { createFolderSafe } from 'obsidian-dev-utils/obsidian/vault';
import { trimEnd } from 'obsidian-dev-utils/string';

import type { Frontmatter } from '../frontmatter-merge.ts';
import type {
  ItemSelectorBaseConstructorParams,
  SelectItemResult
} from './item-selector-base.ts';

import { getAvailableFolderPath } from '../available-folder-path.ts';
import { fixFileName } from '../filename-validation.ts';
import { transformAndFixFileName } from '../name-transform.ts';
import {
  FrontmatterTitleMode,
  SplitTargetMode
} from '../plugin-settings.ts';
import { resolveTemplateTokens } from '../template-tokens.ts';
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
      const targetFile = this.resolveExistingTargetFile();
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
    if (existingFile && this.pluginSettingsComponent.settings.isPathIgnored(existingFile.path)) {
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

  private async createNewMarkdownFileFromLinktext(fileName: string): Promise<TFile> {
    fileName = trimEnd({ $string: fileName, suffix: '.md' });
    const fixedFileName = `${await this.resolveFileName(fileName)}.md`;
    const prefix = this.resolveTargetFolderPrefix();
    const file = await this.app.fileManager.createNewMarkdownFileFromLinktext(prefix + fixedFileName, this.sourceFile.path);

    const overriddenBasename = this.shouldForceSplitIntoFolder || this.pluginSettingsComponent.settings.shouldSplitIntoFolder
      ? await this.moveIntoOwnFolder(file)
      : null;

    /*
     * A `splitIntoFolderNoteNameTemplate` override renames the note away from the typed name, so the
     * typed name is recorded as an alias / frontmatter title exactly like any other changed title
     * (issue #153) — `Foo/Overview.md` still carries `Foo`, so `[[Foo]]` keeps resolving.
     */
    const isInvalidTitle = (overriddenBasename ?? file.basename) !== fileName;

    if (isInvalidTitle && this.pluginSettingsComponent.settings.shouldAddInvalidTitleToNoteAlias) {
      // The note was just created, so there is no open editor to lock while its alias is added.
      await addAlias({ alias: fileName, app: this.app, pathOrFile: file, resourceLockComponent: null });
    }

    let shouldAddTitleToFrontmatter = false;

    switch (this.pluginSettingsComponent.settings.frontmatterTitleMode) {
      case FrontmatterTitleMode.None: {
        break;
      }
      case FrontmatterTitleMode.UseAlways: {
        shouldAddTitleToFrontmatter = true;
        break;
      }
      case FrontmatterTitleMode.UseForInvalidTitleOnly: {
        shouldAddTitleToFrontmatter = isInvalidTitle;
        break;
      }
      default: {
        throw new Error(`Invalid frontmatter title mode: ${this.pluginSettingsComponent.settings.frontmatterTitleMode as string}`);
      }
    }

    if (shouldAddTitleToFrontmatter) {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Frontmatter) => {
        frontmatter.title = fileName;
      });
    }

    return file;
  }

  /**
   * Relocates a freshly-created split/extract note into a brand-new folder named after it, so the note
   * lives at `<dir>/<name>/<name>.md` instead of `<dir>/<name>.md` (issue #79). The folder name is
   * de-duplicated against existing siblings. The note keeps its own base name inside the new folder
   * unless the `splitIntoFolderNoteNameTemplate` setting overrides it (issue #153). The note is
   * brand-new and empty, so the move carries no links or backlinks to fix.
   *
   * @param file - The just-created note to move into its own folder (mutated in place by the rename).
   * @returns The overriding base name the note was given inside the folder, or `null` when it kept the
   * folder's name.
   */
  private async moveIntoOwnFolder(file: TFile): Promise<null | string> {
    const parentPath = file.parent?.path ?? '';
    const originalBasename = file.basename;
    const desiredFolderPath = normalizePath(parentPath ? `${parentPath}/${originalBasename}` : originalBasename);
    const folderPath = getAvailableFolderPath(this.app, desiredFolderPath);
    await createFolderSafe(this.app, folderPath);
    const noteBasename = this.resolveNoteBasenameInOwnFolder(file, folderPath);
    // The folder was just created and is therefore empty, so the note can never collide inside it.
    await this.app.fileManager.renameFile(file, normalizePath(`${folderPath}/${noteBasename}.md`));
    return noteBasename === originalBasename ? null : noteBasename;
  }

  /**
   * The existing note a `Merge` split writes into, or `null` when the chosen item has none.
   *
   * A bookmark carries its path rather than a `file` (`SuggestModalBase` offers bookmarked notes in the
   * split picker too), so it is resolved the same way `MergeItemSelector` resolves it — before the switch
   * existed, choosing a bookmarked note here silently created a note named after the typed query instead.
   *
   * @returns The existing target note, or `null` when the item does not name one.
   */
  private resolveExistingTargetFile(): null | TFile {
    if (this.item?.file) {
      return this.item.file;
    }

    if (this.item?.type === 'bookmark' && this.item.item?.type === 'file') {
      return this.app.vault.getFileByPath(this.item.item.path ?? '');
    }

    return null;
  }

  /**
   * Runs the typed target name through the `Name transform template` and then the invalid-character pass
   * (issue #196), in that order. The split's SOURCE note is the Templater context, which is the note the
   * user is actually working on.
   *
   * @param fileName - The name as typed.
   * @returns The transformed, sanitized name.
   */
  private async resolveFileName(fileName: string): Promise<string> {
    const { settings } = this.pluginSettingsComponent;
    return await transformAndFixFileName({
      app: this.app,
      contextFile: this.sourceFile,
      fileName,
      nameTransformTemplate: settings.nameTransformTemplate,
      replacement: settings.replacement,
      shouldReplaceInvalidCharacters: settings.shouldReplaceInvalidTitleCharacters,
      shouldTreatTitleAsPath: this.shouldTreatTitleAsPath
    });
  }

  /**
   * Resolves the base name a split/extract note gets inside its own folder from the
   * `splitIntoFolderNoteNameTemplate` setting (issue #153), so every folder split can produce e.g.
   * `<dir>/<name>/Overview.md`. Tokens are resolved against the note as it exists *before* the move, so
   * `{{newTitle}}` is the folder's name. An empty setting, a template resolving to nothing, or a name
   * that still spans folders after sanitization all fall back to the folder's name (today's behavior).
   *
   * The `Name transform template` deliberately does NOT run here (issue #196): `{{newTitle}}` is the note
   * whose name the transform already produced, so running it again would apply the rewrite twice.
   *
   * The folder-flavored tokens (`{{folderName}}`, `{{index}}`, ... — issue #227) are pointed at
   * `folderPath` explicitly, because at this moment the note has NOT been renamed into that folder yet:
   * left to resolve against the note's own parent they would name the folder ABOVE the one being created,
   * which is never what a note-name template inside it means. `{{parentFolder}}` is deliberately left
   * alone and still names that folder above — it is a shipped token in a shipped template.
   *
   * @param file - The just-created note, before it is moved into its folder.
   * @param folderPath - The folder the note is about to be moved into.
   * @returns The base name to give the note inside its folder, without the `.md` extension.
   */
  private resolveNoteBasenameInOwnFolder(file: TFile, folderPath: string): string {
    const template = this.pluginSettingsComponent.settings.splitIntoFolderNoteNameTemplate;
    if (!template) {
      return file.basename;
    }

    const resolved = resolveTemplateTokens({
      content: '',
      folderNameTemplate: this.pluginSettingsComponent.settings.reorderedFolderNameTemplate,
      folderPath,
      sourceFile: this.sourceFile,
      targetFile: file,
      template
    });

    const noteName = trimEnd({ $string: resolved.trim(), suffix: '.md' }).trim();
    if (!noteName) {
      return file.basename;
    }

    const { settings } = this.pluginSettingsComponent;
    const fixedNoteName = fixFileName({
      fileName: noteName,
      replacement: settings.replacement,
      shouldReplaceInvalidCharacters: settings.shouldReplaceInvalidTitleCharacters,
      shouldTreatTitleAsPath: false
    });
    // Only reachable when `shouldReplaceInvalidTitleCharacters` is off, leaving a separator in place.
    // Renaming into the folder that separator implies would fail, since it does not exist.
    if (fixedNoteName.includes('/') || fixedNoteName.includes('\\')) {
      return file.basename;
    }

    return fixedNoteName;
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
    return this.resolveExistingTargetFile()?.parent ?? null;
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
