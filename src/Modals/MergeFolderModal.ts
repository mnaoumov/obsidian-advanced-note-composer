import type { TFolder } from 'obsidian';

import {
  App,
  FuzzySuggestModal
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/Async';

export class MergeFolderModal extends FuzzySuggestModal<TFolder> {
  public constructor(app: App, private readonly sourceFolder: TFolder, private readonly callback: (targetFolder: TFolder) => Promise<void>) {
    super(app);
    this.setPlaceholder('Select folder to merge into...');
  }

  public override getItems(): TFolder[] {
    return this.app.vault.getAllFolders(true).filter((folder) => folder !== this.sourceFolder);
  }

  public override getItemText(item: TFolder): string {
    return item.path;
  }

  public override onChooseItem(item: TFolder): void {
    this.close();
    invokeAsyncSafely(async () => {
      await this.callback(item);
    });
  }
}
