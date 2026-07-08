import type {
  App,
  FuzzyMatch,
  TFolder
} from 'obsidian';
import type { PromiseResolve } from 'obsidian-dev-utils/async';

import {
  FuzzySuggestModal,
  Modal,
  Platform
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { SuggestModalCommandBuilder } from 'obsidian-dev-utils/obsidian/modals/suggest-modal-command-builder';
import { isChildOrSelf } from 'obsidian-dev-utils/obsidian/vault';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { openMinimizableModal } from '../open-minimizable-modal.ts';

interface ConfirmDialogModalConstructorParams {
  readonly app: App;
  readonly promiseResolve: PromiseResolve<ConfirmDialogModalResult>;
  readonly sourceFolder: TFolder;
  readonly targetFolder: TFolder;
}

interface ConfirmDialogModalResult {
  readonly isConfirmed: boolean;
  readonly shouldAskBeforeMerging: boolean;
}

interface MergeFolderModalConstructorParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly promiseResolve: PromiseResolve<null | TFolder>;
  readonly sourceFolder: TFolder;
}

/* v8 ignore stop */

interface SelectTargetFolderForMergeFolderParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly sourceFolder: TFolder;
}

/* v8 ignore start -- ConfirmDialogModal is an internal UI class tested through exported functions. */
class ConfirmDialogModal extends Modal {
  private isSelected = false;
  private readonly promiseResolve: PromiseResolve<ConfirmDialogModalResult>;
  private shouldAskBeforeMerging = true;
  private readonly sourceFolder: TFolder;
  private readonly targetFolder: TFolder;

  public constructor(params: ConfirmDialogModalConstructorParams) {
    super(params.app);

    this.sourceFolder = params.sourceFolder;
    this.targetFolder = params.targetFolder;
    this.promiseResolve = params.promiseResolve;

    this.scope.register([], 'Enter', () => {
      this.confirm();
    });
    this.scope.register([], 'Escape', () => {
      this.close();
    });
  }

  public override onClose(): void {
    super.onClose();
    if (!this.isSelected) {
      this.promiseResolve({ isConfirmed: false, shouldAskBeforeMerging: false });
    }
  }

  public override onOpen(): void {
    super.onOpen();
    invokeAsyncSafely(this.onOpenAsync.bind(this));
  }

  private confirm(): void {
    this.isSelected = true;
    this.promiseResolve({ isConfirmed: true, shouldAskBeforeMerging: this.shouldAskBeforeMerging });
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
        f.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: this.sourceFolder }));
        f.createEl('br');
        f.createEl('br');
        appendCodeBlock(f, 'Target');
        f.appendText(': ');
        f.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: this.targetFolder }));
      })
    );

    if (Platform.isMobile) {
      buttonContainerEl.createEl('button', { cls: 'mod-warning', text: 'Merge and don\'t ask again' }, (button) => {
        button.addEventListener('click', () => {
          this.shouldAskBeforeMerging = false;
          this.confirm();
        });
      });
    } else {
      buttonContainerEl.createEl('label', { cls: 'mod-checkbox' }, (label) => {
        label.createEl('input', { attr: { tabindex: -1 }, type: 'checkbox' }, (checkbox) => {
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

    buttonContainerEl.createEl('button', { cls: 'mod-warning', text: 'Merge' }, (button) => {
      button.addEventListener('click', () => {
        this.confirm();
      });
    });
    buttonContainerEl.createEl('button', { cls: 'mod-cancel', text: 'Cancel' }, (button) => {
      button.addEventListener('click', () => {
        this.close();
      });
    });
  }
}

/* v8 ignore stop */

/* v8 ignore start -- MergeFolderModal is an internal UI class tested through exported functions. */
class MergeFolderModal extends FuzzySuggestModal<TFolder> {
  private isSelected = false;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly promiseResolve: PromiseResolve<null | TFolder>;

  private shouldIncludeChildFolders = false;
  private shouldIncludeParentFolders = false;
  private readonly sourceFolder: TFolder;

  public constructor(params: MergeFolderModalConstructorParams) {
    super(params.app);

    this.sourceFolder = params.sourceFolder;
    this.promiseResolve = params.promiseResolve;
    this.pluginSettingsComponent = params.pluginSettingsComponent;

    this.setPlaceholder('Select folder to merge into...');
    this.shouldIncludeChildFolders = params.pluginSettingsComponent.settings.shouldIncludeChildFoldersWhenMergingByDefault;
    this.shouldIncludeParentFolders = params.pluginSettingsComponent.settings.shouldIncludeParentFoldersWhenMergingByDefault;

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
    builder.build(this, { shouldShowInstructions: this.pluginSettingsComponent.settings.shouldShowModalInstructions });
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
    const recentSuggestions = recentFolders.map((folder) => ({ item: folder, match: { matches: [], score: 0 } }));
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
    if (this.pluginSettingsComponent.settings.isPathIgnored(folder.path)) {
      return false;
    }
    if (!this.shouldIncludeChildFolders && isChildOrSelf({ app: this.app, childPathOrFile: folder, parentPathOrFile: this.sourceFolder })) {
      return false;
    }
    if (!this.shouldIncludeParentFolders && isChildOrSelf({ app: this.app, childPathOrFile: this.sourceFolder, parentPathOrFile: folder })) {
      return false;
    }
    return true;
  }
}

export async function selectTargetFolderForMergeFolder(params: SelectTargetFolderForMergeFolderParams): Promise<null | TFolder> {
  const targetFolder = await new Promise<null | TFolder>((promiseResolve) => {
    openMinimizableModal(
      new MergeFolderModal({
        ...params,
        promiseResolve
      })
    );
  });
  /* v8 ignore start -- requires MergeFolderModal to resolve with a selected folder which is untestable in unit tests. */
  if (!targetFolder) {
    return null;
  }
  if (!params.pluginSettingsComponent.settings.shouldAskBeforeMerging) {
    return targetFolder;
  }
  const confirmDialogResult = await new Promise<ConfirmDialogModalResult>((promiseResolve) => {
    openMinimizableModal(
      new ConfirmDialogModal({
        ...params,
        promiseResolve,
        targetFolder
      })
    );
  });
  if (!confirmDialogResult.isConfirmed) {
    return null;
  }
  await params.pluginSettingsComponent.editAndSave((settings) => {
    settings.shouldAskBeforeMerging = confirmDialogResult.shouldAskBeforeMerging;
  });
  return targetFolder;
  /* v8 ignore stop */
}
