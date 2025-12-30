import type {
  FuzzyMatch,
  TFolder
} from 'obsidian';

import {
  FuzzySuggestModal,
  Platform
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/Async';
import { appendCodeBlock } from 'obsidian-dev-utils/HTMLElement';
import { InternalPluginName } from 'obsidian-typings/implementations';

import type { Plugin } from '../Plugin.ts';

import { DynamicModal } from './DynamicModal.ts';

export class MergeFolderModal extends FuzzySuggestModal<TFolder> {
  private doNotAskAgain = false;

  public constructor(
    private readonly plugin: Plugin,
    private readonly sourceFolder: TFolder,
    private readonly callback: (targetFolder: TFolder) => Promise<void>
  ) {
    super(plugin.app);
    this.setPlaceholder('Select folder to merge into...');
  }

  public override getItems(): TFolder[] {
    return this.app.vault.getAllFolders(true).filter(this.isAllowedDestinationFolder.bind(this));
  }

  public override getItemText(item: TFolder): string {
    return item.path;
  }

  public override getSuggestions(query: string): FuzzyMatch<TFolder>[] {
    const suggestions = super.getSuggestions(query);
    if (query) {
      return suggestions;
    }

    const recentFilePaths = this.app.workspace.getRecentFiles({
      showCanvas: true,
      showImages: true,
      showMarkdown: true,
      showNonAttachments: true,
      showNonImageAttachments: true
    });

    const recentFolders: TFolder[] = [];
    const recentFoldersSet = new Set<TFolder>();

    for (const filePath of recentFilePaths) {
      const file = this.app.vault.getFileByPath(filePath);
      if (!file?.parent) {
        continue;
      }
      if (!this.isAllowedDestinationFolder(file.parent)) {
        continue;
      }
      if (recentFoldersSet.has(file.parent)) {
        continue;
      }
      recentFoldersSet.add(file.parent);
      recentFolders.push(file.parent);
    }

    const recentSuggestions = recentFolders.map((folder) => ({
      item: folder,
      match: {
        matches: [],
        score: 0
      }
    }));

    const otherSuggestions = suggestions.filter((suggestion) => !recentFoldersSet.has(suggestion.item));

    return [...recentSuggestions, ...otherSuggestions];
  }

  public override onChooseItem(item: TFolder): void {
    this.close();

    if (!this.plugin.settings.shouldAskBeforeMerging) {
      invokeAsyncSafely(async () => {
        await this.performMerge(item);
      });
      return;
    }

    const modal = new DynamicModal(this.app)
      .setTitle('Merge file')
      .setContent(
        createFragment((f) => {
          f.appendText('Are you sure you want to merge ');
          appendCodeBlock(f, 'Source');
          f.appendText(' into ');
          appendCodeBlock(f, 'Target');
          f.appendText('? ');
          appendCodeBlock(f, 'Source');
          f.appendText(' will be deleted.');
          f.createEl('br');
          f.createEl('br');
          appendCodeBlock(f, 'Source');
          f.appendText(': ');
          f.createEl('a', { text: this.sourceFolder.path }, (a) => {
            a.addEventListener('click', () => {
              this.openFolder(this.sourceFolder);
            });
          });
          f.createEl('br');
          f.createEl('br');
          appendCodeBlock(f, 'Target');
          f.appendText(': ');
          f.createEl('a', { text: item.path }, (a) => {
            a.addEventListener('click', () => {
              this.openFolder(item);
            });
          });
        })
      );

    modal.scope.register([], 'Enter', async () => {
      modal.close();
      await this.callback(item);
    });

    modal.scope.register([], 'Cancel', () => {
      modal.close();
    });

    if (Platform.isMobile) {
      modal.addButton('mod-warning', 'Merge and don\'t ask again', async () => {
        this.doNotAskAgain = true;
        await this.performMerge(item);
      });
    } else {
      modal.addCheckbox('Don\'t ask again', async (evt2) => {
        if (!(evt2.target instanceof HTMLInputElement)) {
          return;
        }
        this.doNotAskAgain = evt2.target.checked;
      });
    }

    modal.addButton('mod-warning', 'Merge', async () => {
      await this.performMerge(item);
    })
      .addCancelButton()
      .open();
  }

  private isAllowedDestinationFolder(folder: TFolder): boolean {
    return folder !== this.sourceFolder && !this.plugin.settings.isPathIgnored(folder.path);
  }

  private openFolder(folder: TFolder): void {
    this.app.internalPlugins.getEnabledPluginById(InternalPluginName.FileExplorer)?.revealInFolder(folder);
  }

  private async performMerge(targetFolder: TFolder): Promise<void> {
    if (this.doNotAskAgain) {
      await this.plugin.settingsManager.editAndSave((settings) => {
        settings.shouldAskBeforeMerging = false;
      });
    }
    await this.callback(targetFolder);
  }
}
