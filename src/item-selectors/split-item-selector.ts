import type { TFile } from 'obsidian';

import { normalizePath } from 'obsidian';
import { addAlias } from 'obsidian-dev-utils/obsidian/file-manager';
import { createFolderSafe } from 'obsidian-dev-utils/obsidian/vault';
import { trimEnd } from 'obsidian-dev-utils/string';

import type { Frontmatter } from '../composers/composer-base.ts';
import type {
  ItemSelectorBaseConstructorParams,
  SelectItemResult
} from './item-selector-base.ts';

import { fixFileName } from '../filename-validation.ts';
import { FrontmatterTitleMode } from '../plugin-settings.ts';
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
}

export class SplitItemSelector extends ItemSelectorBase {
  private readonly shouldAllowOnlyCurrentFolder: boolean;
  private readonly shouldForceSplitIntoFolder: boolean;
  private readonly shouldTreatTitleAsPath: boolean;

  public constructor(params: SplitItemSelectorConstructorParams) {
    super(params);
    this.shouldAllowOnlyCurrentFolder = params.shouldAllowOnlyCurrentFolder;
    this.shouldForceSplitIntoFolder = params.shouldForceSplitIntoFolder ?? false;
    this.shouldTreatTitleAsPath = params.shouldTreatTitleAsPath;
  }

  public override async selectItem(): Promise<SelectItemResult> {
    if (this.isMod || !this.item) {
      const existingFile = this.app.metadataCache.getFirstLinkpathDest(this.inputValue, '');
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

    if (this.item.type === 'unresolved') {
      return {
        isNewTargetFile: true,
        targetFile: await this.createNewMarkdownFileFromLinktext(this.item.linktext ?? '')
      };
    }

    if (this.item.type === 'file' || this.item.type === 'alias') {
      if (!this.item.file) {
        throw new Error('File not found');
      }

      return {
        isNewTargetFile: false,
        targetFile: this.item.file
      };
    }

    return {
      isNewTargetFile: true,
      targetFile: await this.createNewMarkdownFileFromLinktext(this.inputValue)
    };
  }

  private async createNewMarkdownFileFromLinktext(fileName: string): Promise<TFile> {
    fileName = trimEnd({ str: fileName, suffix: '.md' });
    const fixedFileName = `${this.fixFileName(fileName)}.md`;
    const prefix = this.shouldAllowOnlyCurrentFolder ? `/${this.sourceFile.parent?.getParentPrefix() ?? ''}` : '';
    const file = await this.app.fileManager.createNewMarkdownFileFromLinktext(prefix + fixedFileName, this.sourceFile.path);

    let overriddenBasename: null | string = null;

    if (this.shouldForceSplitIntoFolder || this.pluginSettingsComponent.settings.shouldSplitIntoFolder) {
      overriddenBasename = await this.moveIntoOwnFolder(file);
    }

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
      case FrontmatterTitleMode.None:
        break;
      case FrontmatterTitleMode.UseAlways:
        shouldAddTitleToFrontmatter = true;
        break;
      case FrontmatterTitleMode.UseForInvalidTitleOnly:
        shouldAddTitleToFrontmatter = isInvalidTitle;
        break;
      default:
        throw new Error(`Invalid frontmatter title mode: ${this.pluginSettingsComponent.settings.frontmatterTitleMode as string}`);
    }

    if (shouldAddTitleToFrontmatter) {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Frontmatter) => {
        frontmatter.title = fileName;
      });
    }

    return file;
  }

  private fixFileName(fileName: string, shouldTreatTitleAsPath = this.shouldTreatTitleAsPath): string {
    const { settings } = this.pluginSettingsComponent;
    return fixFileName({
      fileName,
      replacement: settings.replacement,
      shouldReplaceInvalidCharacters: settings.shouldReplaceInvalidTitleCharacters,
      shouldTreatTitleAsPath
    });
  }

  /**
   * Finds an available folder path for the "split into folder" feature, appending ` 1`, ` 2`, … until a
   * name that no existing file or folder occupies is found (mirroring Obsidian's own de-duplication).
   *
   * @param desiredPath - The preferred folder path (named after the new note).
   * @returns A folder path that does not collide with an existing file or folder.
   */
  private getAvailableFolderPath(desiredPath: string): string {
    if (!this.app.vault.getAbstractFileByPath(desiredPath)) {
      return desiredPath;
    }

    let index = 1;
    for (;;) {
      const candidatePath = `${desiredPath} ${index.toString()}`;
      if (!this.app.vault.getAbstractFileByPath(candidatePath)) {
        return candidatePath;
      }
      index++;
    }
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
    const folderPath = this.getAvailableFolderPath(desiredFolderPath);
    await createFolderSafe(this.app, folderPath);
    const noteBasename = this.resolveNoteBasenameInOwnFolder(file);
    // The folder was just created and is therefore empty, so the note can never collide inside it.
    await this.app.fileManager.renameFile(file, normalizePath(`${folderPath}/${noteBasename}.md`));
    return noteBasename === originalBasename ? null : noteBasename;
  }

  /**
   * Resolves the base name a split/extract note gets inside its own folder from the
   * `splitIntoFolderNoteNameTemplate` setting (issue #153), so every folder split can produce e.g.
   * `<dir>/<name>/Overview.md`. Tokens are resolved against the note as it exists *before* the move, so
   * `{{newTitle}}` is the folder's name. An empty setting, a template resolving to nothing, or a name
   * that still spans folders after sanitization all fall back to the folder's name (today's behavior).
   *
   * @param file - The just-created note, before it is moved into its folder.
   * @returns The base name to give the note inside its folder, without the `.md` extension.
   */
  private resolveNoteBasenameInOwnFolder(file: TFile): string {
    const template = this.pluginSettingsComponent.settings.splitIntoFolderNoteNameTemplate;
    if (!template) {
      return file.basename;
    }

    const resolved = resolveTemplateTokens({
      content: '',
      sourceFile: this.sourceFile,
      targetFile: file,
      template
    });

    const noteName = trimEnd({ str: resolved.trim(), suffix: '.md' }).trim();
    if (!noteName) {
      return file.basename;
    }

    const fixedNoteName = this.fixFileName(noteName, false);
    // Only reachable when `shouldReplaceInvalidTitleCharacters` is off, leaving a separator in place.
    // Renaming into the folder that separator implies would fail, since it does not exist.
    if (fixedNoteName.includes('/') || fixedNoteName.includes('\\')) {
      return file.basename;
    }

    return fixedNoteName;
  }
}
