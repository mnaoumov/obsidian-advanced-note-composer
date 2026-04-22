import type { TFile } from 'obsidian';

import { addAlias } from 'obsidian-dev-utils/obsidian/file-manager';
import { trimEnd } from 'obsidian-dev-utils/string';

import type { Frontmatter } from '../composers/composer-base.ts';
import type {
  ItemSelectorBaseOptions,
  SelectItemResult
} from './item-selector-base.ts';

import {
  INVALID_CHARACTERS_REG_EXP,
  TRAILING_DOTS_OR_SPACES_REG_EXP
} from '../filename-validation.ts';
import { FrontmatterTitleMode } from '../plugin-settings.ts';
import { ItemSelectorBase } from './item-selector-base.ts';

interface SplitItemSelectorOptions extends ItemSelectorBaseOptions {
  shouldAllowOnlyCurrentFolder: boolean;
  shouldTreatTitleAsPath: boolean;
}

export class SplitItemSelector extends ItemSelectorBase {
  private readonly shouldAllowOnlyCurrentFolder: boolean;
  private readonly shouldTreatTitleAsPath: boolean;

  public constructor(options: SplitItemSelectorOptions) {
    super(options);
    this.shouldAllowOnlyCurrentFolder = options.shouldAllowOnlyCurrentFolder;
    this.shouldTreatTitleAsPath = options.shouldTreatTitleAsPath;
  }

  public override async selectItem(): Promise<SelectItemResult> {
    if (this.isMod || !this.item) {
      const existingFile = this.app.metadataCache.getFirstLinkpathDest(this.inputValue, '');
      if (existingFile && this.plugin.pluginSettings.isPathIgnored(existingFile.path)) {
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

  protected async createNewMarkdownFileFromLinktext(fileName: string): Promise<TFile> {
    fileName = trimEnd(fileName, '.md');
    const fixedFileName = `${this.fixFileName(fileName)}.md`;
    const prefix = this.shouldAllowOnlyCurrentFolder ? `/${this.sourceFile.parent?.getParentPrefix() ?? ''}` : '';
    const file = await this.app.fileManager.createNewMarkdownFileFromLinktext(prefix + fixedFileName, this.sourceFile.path);

    const isInvalidTitle = file.basename !== fileName;

    if (isInvalidTitle && this.plugin.pluginSettings.shouldAddInvalidTitleToNoteAlias) {
      await addAlias(this.app, file, fileName);
    }

    let shouldAddTitleToFrontmatter = false;

    switch (this.plugin.pluginSettings.frontmatterTitleMode) {
      case FrontmatterTitleMode.None:
        break;
      case FrontmatterTitleMode.UseAlways:
        shouldAddTitleToFrontmatter = true;
        break;
      case FrontmatterTitleMode.UseForInvalidTitleOnly:
        shouldAddTitleToFrontmatter = isInvalidTitle;
        break;
      default:
        throw new Error(`Invalid frontmatter title mode: ${this.plugin.pluginSettings.frontmatterTitleMode as string}`);
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

    if (!this.plugin.pluginSettings.shouldReplaceInvalidTitleCharacters) {
      return fileName;
    }

    const parts = fileName.split('/');
    const fixedParts = parts.filter((part) => !!part).map((part) => {
      let fixedPart = part;
      fixedPart = fixedPart.replaceAll(INVALID_CHARACTERS_REG_EXP, (substring) => this.plugin.pluginSettings.replacement.repeat(substring.length));
      fixedPart = fixedPart.replaceAll(TRAILING_DOTS_OR_SPACES_REG_EXP, (substring) => this.plugin.pluginSettings.replacement.repeat(substring.length));
      if (fixedPart.startsWith('.') || fixedPart.startsWith(' ')) {
        fixedPart = this.plugin.pluginSettings.replacement + fixedPart.slice(1);
      }
      return fixedPart;
    });
    return fixedParts.join('/');
  }
}
