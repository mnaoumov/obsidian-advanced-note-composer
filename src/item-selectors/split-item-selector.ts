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

import {
  INVALID_CHARACTERS_REG_EXP,
  TRAILING_DOTS_OR_SPACES_REG_EXP
} from '../filename-validation.ts';
import { FrontmatterTitleMode } from '../plugin-settings.ts';
import { ItemSelectorBase } from './item-selector-base.ts';

interface SplitItemSelectorConstructorParams extends ItemSelectorBaseConstructorParams {
  readonly shouldAllowOnlyCurrentFolder: boolean;
  readonly shouldTreatTitleAsPath: boolean;
}

export class SplitItemSelector extends ItemSelectorBase {
  private readonly shouldAllowOnlyCurrentFolder: boolean;
  private readonly shouldTreatTitleAsPath: boolean;

  public constructor(params: SplitItemSelectorConstructorParams) {
    super(params);
    this.shouldAllowOnlyCurrentFolder = params.shouldAllowOnlyCurrentFolder;
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

    if (this.pluginSettingsComponent.settings.shouldSplitIntoFolder) {
      await this.moveIntoOwnFolder(file);
    }

    const isInvalidTitle = file.basename !== fileName;

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

  private fixFileName(fileName: string): string {
    if (!fileName) {
      return 'Untitled';
    }

    if (!this.shouldTreatTitleAsPath) {
      fileName = fileName.replaceAll('/', '\\');
    }

    if (!this.pluginSettingsComponent.settings.shouldReplaceInvalidTitleCharacters) {
      return fileName;
    }

    const parts = fileName.split('/');
    const fixedParts = parts.filter((part) => !!part).map((part) => {
      let fixedPart = part;
      fixedPart = fixedPart.replaceAll(
        INVALID_CHARACTERS_REG_EXP,
        (substring) => this.pluginSettingsComponent.settings.replacement.repeat(substring.length)
      );
      fixedPart = fixedPart.replaceAll(
        TRAILING_DOTS_OR_SPACES_REG_EXP,
        (substring) => this.pluginSettingsComponent.settings.replacement.repeat(substring.length)
      );
      if (fixedPart.startsWith('.') || fixedPart.startsWith(' ')) {
        fixedPart = this.pluginSettingsComponent.settings.replacement + fixedPart.slice(1);
      }
      return fixedPart;
    });
    return fixedParts.join('/');
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
   * de-duplicated against existing siblings; the note keeps its own base name inside the new folder. The
   * note is brand-new and empty, so the move carries no links or backlinks to fix.
   *
   * @param file - The just-created note to move into its own folder (mutated in place by the rename).
   */
  private async moveIntoOwnFolder(file: TFile): Promise<void> {
    const parentPath = file.parent?.path ?? '';
    const desiredFolderPath = normalizePath(parentPath ? `${parentPath}/${file.basename}` : file.basename);
    const folderPath = this.getAvailableFolderPath(desiredFolderPath);
    await createFolderSafe(this.app, folderPath);
    await this.app.fileManager.renameFile(file, normalizePath(`${folderPath}/${file.name}`));
  }
}
