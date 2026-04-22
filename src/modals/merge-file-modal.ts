import type { PromiseResolve } from 'obsidian-dev-utils/async';

import {
  App,
  Keymap,
  Modal,
  Platform,
  TFile
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import {
  appendCodeBlock,
  createFragmentAsync
} from 'obsidian-dev-utils/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';

import type { Plugin } from '../plugin.ts';
import type { Item } from './suggest-modal-base.ts';

import { getInsertModeFromEvent } from '../composers/composer-base.ts';
import { InsertMode } from '../insert-mode.ts';
import { MergeItemSelector } from '../item-selectors/merge-item-selector.ts';
import { FrontmatterMergeStrategy } from '../plugin-settings.ts';
import { SuggestModalBase } from './suggest-modal-base.ts';
import { SuggestModalCommandBuilder } from './suggest-modal-command-builder.ts';

interface ConfirmDialogModalResult {
  insertMode: InsertMode;
  isConfirmed: boolean;
  shouldAskBeforeMerging: boolean;
}

interface MergeFileModalResult {
  frontmatterMergeStrategy: FrontmatterMergeStrategy;
  inputValue: string;
  insertMode: InsertMode;
  isMod: boolean;
  item: Item | null;
  shouldAllowOnlyCurrentFolder: boolean;
  shouldAllowSplitIntoUnresolvedPath: boolean;
  shouldFixFootnotes: boolean;
  shouldMergeHeadings: boolean;
}

interface PrepareForMergeFileResult {
  frontmatterMergeStrategy: FrontmatterMergeStrategy;
  insertMode: InsertMode;
  isNewTargetFile: boolean;
  shouldAllowOnlyCurrentFolder: boolean;
  shouldAllowSplitIntoUnresolvedPath: boolean;
  shouldFixFootnotes: boolean;
  shouldMergeHeadings: boolean;
  targetFile: TFile;
}

class ConfirmDialogModal extends Modal {
  private isSelected = false;
  private shouldAskBeforeMerging = true;

  public constructor(
    app: App,
    private readonly sourceFile: TFile,
    private readonly targetFile: TFile,
    private readonly promiseResolve: PromiseResolve<ConfirmDialogModalResult>
  ) {
    super(app);

    this.scope.register([], 'Enter', (evt) => {
      this.confirm(evt);
    });

    this.scope.register([], 'Escape', () => {
      this.close();
    });
  }

  public override onClose(): void {
    super.onClose();
    if (!this.isSelected) {
      this.promiseResolve({
        insertMode: InsertMode.Append,
        isConfirmed: false,
        shouldAskBeforeMerging: false
      });
    }
  }

  public override onOpen(): void {
    super.onOpen();
    invokeAsyncSafely(this.onOpenAsync.bind(this));
  }

  private confirm(evt: KeyboardEvent | MouseEvent): void {
    this.isSelected = true;
    this.promiseResolve({
      insertMode: getInsertModeFromEvent(evt),
      isConfirmed: true,
      shouldAskBeforeMerging: this.shouldAskBeforeMerging
    });
    this.close();
  }

  private async onOpenAsync(): Promise<void> {
    this.setTitle('Merge file');

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
        f.appendChild(await renderInternalLink(this.app, this.sourceFile));
        f.createEl('br');
        f.createEl('br');
        appendCodeBlock(f, 'Target');
        f.appendText(': ');
        f.appendChild(await renderInternalLink(this.app, this.targetFile));
      })
    );

    if (Platform.isMobile) {
      buttonContainerEl.createEl('button', {
        cls: 'mod-warning',
        text: 'Merge and don\'t ask again'
      }, (button) => {
        button.addEventListener('click', (evt) => {
          this.shouldAskBeforeMerging = false;
          this.confirm(evt);
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
      button.addEventListener('click', (evt) => {
        this.confirm(evt);
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

class MergeFileModal extends SuggestModalBase {
  private frontmatterMergeStrategy: FrontmatterMergeStrategy;
  private isSelected = false;
  private shouldAllowSplitIntoUnresolvedPath: boolean;
  private shouldFixFootnotes: boolean;
  private shouldMergeHeadings: boolean;

  public constructor(plugin: Plugin, sourceFile: TFile, private readonly promiseResolve: PromiseResolve<MergeFileModalResult | null>) {
    super(plugin, sourceFile);

    this.shouldFixFootnotes = plugin.pluginSettingsComponent.settings.shouldFixFootnotesByDefault;
    this.shouldMergeHeadings = plugin.pluginSettingsComponent.settings.shouldMergeHeadingsByDefault;
    this.shouldAllowSplitIntoUnresolvedPath = plugin.pluginSettingsComponent.settings.shouldAllowSplitIntoUnresolvedPathByDefault;
    this.frontmatterMergeStrategy = plugin.pluginSettingsComponent.settings.defaultFrontmatterMergeStrategy;

    this.emptyStateText = 'No files found.';
    this.shouldShowNonImageAttachments = false;
    this.shouldShowImages = false;
    this.shouldShowNonAttachments = false;
    this.setPlaceholder('Select file to merge into...');

    const builder = new SuggestModalCommandBuilder();

    builder.addKeyboardCommand({
      key: 'UpDown',
      purpose: 'to navigate'
    });

    builder.addKeyboardCommand({
      key: 'Enter',
      purpose: 'to move to bottom'
    });

    builder.addKeyboardCommand({
      key: 'Enter',
      modifiers: ['Mod'],
      onKey: (evt) => {
        this.selectActiveSuggestion(evt);
        return false;
      },
      purpose: 'to create new'
    });

    builder.addKeyboardCommand({
      key: 'Enter',
      modifiers: ['Shift'],
      onKey: (evt) => {
        this.selectActiveSuggestion(evt);
        return false;
      },
      purpose: 'to merge at top'
    });

    builder.addKeyboardCommand({
      key: 'Escape',
      onKey: () => {
        this.close();
        return false;
      },
      purpose: 'to dismiss'
    });

    builder.addCheckbox({
      key: '1',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.shouldFixFootnotes = value;
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.shouldFixFootnotes;
      },
      purpose: 'Fix footnotes'
    });

    builder.addCheckbox({
      key: '2',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.shouldAllowOnlyCurrentFolder = value;
        this.updateSuggestions();
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.shouldAllowOnlyCurrentFolder;
      },
      purpose: 'Allow only current folder'
    });

    builder.addCheckbox({
      key: '3',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.shouldMergeHeadings = value;
        this.updateSuggestions();
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.shouldMergeHeadings;
      },
      purpose: 'Merge headings'
    });

    builder.addCheckbox({
      key: '4',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.shouldAllowSplitIntoUnresolvedPath = value;
        this.shouldShowUnresolved = value;
        this.updateSuggestions();
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.shouldAllowSplitIntoUnresolvedPath;
      },
      purpose: 'Allow split into unresolved path'
    });

    builder.addDropDown({
      key: '5',
      modifiers: ['Alt'],
      onChange: (value: string) => {
        this.frontmatterMergeStrategy = value as FrontmatterMergeStrategy;
      },
      onInit: (dropdownComponent) => {
        dropdownComponent.addOptions({
          /* eslint-disable perfectionist/sort-objects -- Need to keep order. */
          [FrontmatterMergeStrategy.MergeAndPreferNewValues]: 'Merge and prefer new values',
          [FrontmatterMergeStrategy.MergeAndPreferOriginalValues]: 'Merge and prefer original values',
          [FrontmatterMergeStrategy.KeepOriginalFrontmatter]: 'Keep original frontmatter',
          [FrontmatterMergeStrategy.ReplaceWithNewFrontmatter]: 'Replace with new frontmatter',
          [FrontmatterMergeStrategy.PreserveBothOriginalAndNewFrontmatter]: 'Preserve both original and new frontmatter'
          /* eslint-enable perfectionist/sort-objects -- Need to keep order. */
        });
        dropdownComponent.setValue(this.frontmatterMergeStrategy);
      },
      purpose: 'Frontmatter merge strategy'
    });

    builder.build(this);
  }

  public override onClose(): void {
    super.onClose();
    if (!this.isSelected) {
      this.promiseResolve(null);
    }
  }

  public override selectSuggestion(value: Item | null, evt: KeyboardEvent | MouseEvent): void {
    this.isSelected = true;
    super.selectSuggestion(value, evt);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- Abstract base class requires Promise<void> return type.
  protected override async onChooseSuggestionAsync(item: Item | null, evt: KeyboardEvent | MouseEvent): Promise<void> {
    this.promiseResolve({
      frontmatterMergeStrategy: this.frontmatterMergeStrategy,
      inputValue: this.inputEl.value,
      insertMode: getInsertModeFromEvent(evt),
      isMod: Keymap.isModifier(evt, 'Mod'),
      item,
      shouldAllowOnlyCurrentFolder: this.shouldAllowOnlyCurrentFolder,
      shouldAllowSplitIntoUnresolvedPath: this.shouldAllowSplitIntoUnresolvedPath,
      shouldFixFootnotes: this.shouldFixFootnotes,
      shouldMergeHeadings: this.shouldMergeHeadings
    });
  }
}

export async function prepareForMergeFile(plugin: Plugin, sourceFile: TFile): Promise<null | PrepareForMergeFileResult> {
  const result = await new Promise<MergeFileModalResult | null>((resolve) => {
    const modal = new MergeFileModal(plugin, sourceFile, resolve);
    modal.open();
  });

  if (!result) {
    return null;
  }

  const selectItemResult = await new MergeItemSelector({
    inputValue: result.inputValue,
    isMod: result.isMod,
    item: result.item,
    plugin,
    sourceFile
  }).selectItem();

  const prepareForMergeFileResult: PrepareForMergeFileResult = {
    frontmatterMergeStrategy: result.frontmatterMergeStrategy,
    insertMode: result.insertMode,
    isNewTargetFile: selectItemResult.isNewTargetFile,
    shouldAllowOnlyCurrentFolder: result.shouldAllowOnlyCurrentFolder,
    shouldAllowSplitIntoUnresolvedPath: result.shouldAllowSplitIntoUnresolvedPath,
    shouldFixFootnotes: result.shouldFixFootnotes,
    shouldMergeHeadings: result.shouldMergeHeadings,
    targetFile: selectItemResult.targetFile
  };

  if (!plugin.pluginSettingsComponent.settings.shouldAskBeforeMerging) {
    return prepareForMergeFileResult;
  }

  const confirmDialogResult = await new Promise<ConfirmDialogModalResult>((resolve) => {
    new ConfirmDialogModal(plugin.app, sourceFile, prepareForMergeFileResult.targetFile, resolve).open();
  });

  if (!confirmDialogResult.isConfirmed) {
    return null;
  }

  await plugin.pluginSettingsComponent.editAndSave((settings) => {
    settings.shouldAskBeforeMerging = confirmDialogResult.shouldAskBeforeMerging;
  });

  prepareForMergeFileResult.insertMode = confirmDialogResult.insertMode;
  return prepareForMergeFileResult;
}
