import type {
  FuzzyMatch,
  TFolder
} from 'obsidian';

import {
  FuzzySuggestModal,
  Platform
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/Async';
import {
  appendCodeBlock,
  createFragmentAsync
} from 'obsidian-dev-utils/HTMLElement';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/Markdown';

import type { Plugin } from '../Plugin.ts';

import { DynamicModal } from './DynamicModal.ts';
import { SuggestModalCommandBuilder } from './SuggestModalCommandBuilder.ts';
import { isChildOrSelf } from 'obsidian-dev-utils/obsidian/Vault';

export class MergeFolderModal extends FuzzySuggestModal<TFolder> {
  private doNotAskAgain = false;
  private shouldIncludeChildFolders = false;
  private shouldIncludeParentFolders = false;

  public constructor(
    private readonly plugin: Plugin,
    private readonly sourceFolder: TFolder,
    private readonly callback: (targetFolder: TFolder) => Promise<void>
  ) {
    super(plugin.app);
    this.setPlaceholder('Select folder to merge into...');
    this.shouldIncludeChildFolders = plugin.settings.shouldIncludeChildFoldersWhenMergingByDefault;
    this.shouldIncludeParentFolders = plugin.settings.shouldIncludeParentFoldersWhenMergingByDefault;

    const builder = new SuggestModalCommandBuilder();
    builder.addCheckbox({
      key: '1',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.shouldIncludeChildFolders = value;
        this.updateSuggestions();
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.shouldIncludeChildFolders;
      },
      purpose: 'Include child folders'
    });
    builder.addCheckbox({
      key: '2',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.shouldIncludeParentFolders = value;
        this.updateSuggestions();
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.shouldIncludeParentFolders;
      },
      purpose: 'Include parent folders'
    });

    builder.build(this);
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

    invokeAsyncSafely(async () => {
      const modal = new DynamicModal(this.app)
        .setTitle('Merge file')
        .setContent(
          await createFragmentAsync(async (f) => {
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
            f.appendChild(await renderInternalLink(this.app, this.sourceFolder));
            f.createEl('br');
            f.createEl('br');
            appendCodeBlock(f, 'Target');
            f.appendText(': ');
            f.appendChild(await renderInternalLink(this.app, item));
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
    });
  }

  private isAllowedDestinationFolder(folder: TFolder): boolean {
    if (folder === this.sourceFolder) {
      return false;
    }
    if (this.plugin.settings.isPathIgnored(folder.path)) {
      return false;
    }
    if (!this.shouldIncludeChildFolders && isChildOrSelf(this.app, folder, this.sourceFolder)) {
      return false;
    }
    if (!this.shouldIncludeParentFolders && isChildOrSelf(this.app, this.sourceFolder, folder)) {
      return false;
    }
    return true;
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
