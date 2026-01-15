import type {
  App,
  FuzzyMatch,
  TFolder
} from 'obsidian';
import type { PromiseResolve } from 'obsidian-dev-utils/Async';

import {
  FuzzySuggestModal,
  Modal,
  Platform
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/Async';
import {
  appendCodeBlock,
  createFragmentAsync
} from 'obsidian-dev-utils/HTMLElement';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/Markdown';
import { isChildOrSelf } from 'obsidian-dev-utils/obsidian/Vault';

import type { Plugin } from '../Plugin.ts';

import { SuggestModalCommandBuilder } from './SuggestModalCommandBuilder.ts';

interface ConfirmDialogModalResult {
  isConfirmed: boolean;
  shouldAskBeforeMerging: boolean;
}

class ConfirmDialogModal extends Modal {
  private isSelected = false;
  private shouldAskBeforeMerging = true;

  public constructor(
    app: App,
    private readonly sourceFolder: TFolder,
    private readonly targetFolder: TFolder,
    private readonly promiseResolve: PromiseResolve<ConfirmDialogModalResult>
  ) {
    super(app);

    this.scope.register([], 'Enter', async () => {
      this.confirm();
    });

    this.scope.register([], 'Escape', () => {
      this.close();
    });
  }

  public override onClose(): void {
    super.onClose();
    if (!this.isSelected) {
      this.promiseResolve({
        isConfirmed: false,
        shouldAskBeforeMerging: false
      });
    }
  }

  public override onOpen(): void {
    super.onOpen();
    invokeAsyncSafely(this.onOpenAsync.bind(this));
  }

  private confirm(): void {
    this.isSelected = true;
    this.promiseResolve({
      isConfirmed: true,
      shouldAskBeforeMerging: this.shouldAskBeforeMerging
    });
    this.close();
  }

  private async onOpenAsync(): Promise<void> {
    this.setTitle('Merge folder');

    this.containerEl.addClass('mod-confirmation');
    const buttonContainerEl = this.modalEl.createDiv('modal-button-container');

    this.setContent(
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
        f.appendChild(await renderInternalLink(this.app, this.targetFolder));
      })
    );

    if (Platform.isMobile) {
      buttonContainerEl.createEl('button', {
        cls: 'mod-warning',
        text: 'Merge and don\'t ask again'
      }, (button) => {
        button.addEventListener('click', () => {
          this.shouldAskBeforeMerging = false;
          this.confirm();
        });
      });
    } else {
      buttonContainerEl.createEl('label', { cls: 'mod-checkbox' }, (label) => {
        label
          .createEl('input', {
            attr: { tabindex: -1 },
            type: 'checkbox'
          }, (checkbox) => {
            checkbox.addEventListener('change', (evt) => {
              if (!(evt.target instanceof HTMLInputElement)) {
                return;
              }
              this.shouldAskBeforeMerging = !evt.target.checked;
            });
          });
        label.appendText('Don\'t ask again');
      });
    }

    buttonContainerEl.createEl('button', {
      cls: 'mod-warning',
      text: 'Merge'
    }, (button) => {
      button.addEventListener('click', () => {
        this.confirm();
      });
    });

    buttonContainerEl.createEl('button', {
      cls: 'mod-cancel',
      text: 'Cancel'
    }, (button) => {
      button.addEventListener('click', () => {
        this.close();
      });
    });
  }
}

class MergeFolderModal extends FuzzySuggestModal<TFolder> {
  private isSelected = false;
  private shouldIncludeChildFolders = false;
  private shouldIncludeParentFolders = false;

  public constructor(
    private readonly plugin: Plugin,
    private readonly sourceFolder: TFolder,
    private readonly promiseResolve: PromiseResolve<null | TFolder>
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
      purpose: 'Include child folders in selector'
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
      purpose: 'Include parent folders in selector'
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
    this.promiseResolve(item);
  }

  public override onClose(): void {
    super.onClose();
    if (!this.isSelected) {
      this.promiseResolve(null);
    }
  }

  public override selectSuggestion(value: FuzzyMatch<TFolder>, evt: KeyboardEvent | MouseEvent): void {
    this.isSelected = true;
    super.selectSuggestion(value, evt);
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
}

export async function selectTargetFolderForMergeFolder(plugin: Plugin, sourceFolder: TFolder): Promise<null | TFolder> {
  const targetFolder = await new Promise<null | TFolder>((resolve) => {
    new MergeFolderModal(plugin, sourceFolder, resolve).open();
  });

  if (!targetFolder) {
    return null;
  }

  if (!plugin.settings.shouldAskBeforeMerging) {
    return targetFolder;
  }

  const confirmDialogResult = await new Promise<ConfirmDialogModalResult>((resolve) => {
    new ConfirmDialogModal(plugin.app, sourceFolder, targetFolder, resolve).open();
  });

  if (!confirmDialogResult.isConfirmed) {
    return null;
  }

  await plugin.settingsManager.editAndSave((settings) => {
    settings.shouldAskBeforeMerging = confirmDialogResult.shouldAskBeforeMerging;
  });

  return targetFolder;
}
