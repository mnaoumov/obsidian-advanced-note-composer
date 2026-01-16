import { join } from 'obsidian-dev-utils/Path';

import type {
  ItemSelectorBaseOptions,
  SelectItemResult
} from './ItemSelectorBase.ts';

import { ItemSelectorBase } from './ItemSelectorBase.ts';

export class MergeItemSelector extends ItemSelectorBase {
  public constructor(options: ItemSelectorBaseOptions) {
    super(options);
  }

  public override async selectItem(): Promise<SelectItemResult> {
    if (this.isMod || this.item?.type === 'unresolved') {
      const fileName = this.item?.type === 'unresolved' ? this.item.linktext ?? '' : this.inputValue;
      const parentFolder = this.app.fileManager.getNewFileParent(this.sourceFile.path, fileName);

      const existingFile = this.app.metadataCache.getFirstLinkpathDest(join(parentFolder.path, fileName), '');
      if (existingFile && this.plugin.settings.isPathIgnored(existingFile.path)) {
        return {
          isNewTargetFile: false,
          targetFile: existingFile
        };
      }

      return {
        isNewTargetFile: true,
        targetFile: await this.app.fileManager.createNewMarkdownFile(parentFolder, fileName, '')
      };
    }

    if (this.item?.type === 'bookmark' && this.item.item?.type === 'file') {
      const bookmarkFile = this.app.vault.getFileByPath(this.item.item.path ?? '');
      if (bookmarkFile) {
        return {
          isNewTargetFile: false,
          targetFile: bookmarkFile
        };
      }

      throw new Error('Bookmark file not found');
    }

    if (this.item?.file) {
      return {
        isNewTargetFile: false,
        targetFile: this.item.file
      };
    }

    throw new Error('No valid file selected');
  }
}
