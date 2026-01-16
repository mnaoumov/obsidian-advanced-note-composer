import type { PromiseResolve } from 'obsidian-dev-utils/Async';

import {
  App,
  Keymap,
  Modal,
  Platform,
  TFile
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/Async';
import {
  appendCodeBlock,
  createFragmentAsync
} from 'obsidian-dev-utils/HTMLElement';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/Markdown';

import {
  InsertMode
} from '../Composers/ComposerBase.ts';
import type { Plugin } from '../Plugin.ts';
import type { Item } from './SuggestModalBase.ts';

import {
  FrontmatterMergeStrategy
} from '../PluginSettings.ts';
import { SuggestModalBase } from './SuggestModalBase.ts';
import { SuggestModalCommandBuilder } from './SuggestModalCommandBuilder.ts';
import type { MergeComposer } from '../Composers/MergeComposer.ts';
import { MergeItemSelector } from '../ItemSelectors/MergeItemSelector.ts';

interface ConfirmDialogModalResult {
  insertMode: InsertMode;
  isConfirmed: boolean;
  shouldAskBeforeMerging: boolean;
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

    this.scope.register([], 'Enter', async (evt) => {
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
      insertMode: evt.shiftKey ? InsertMode.Prepend : InsertMode.Append,
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
  private isSelected = false;
  private shouldFixFootnotes: boolean;
  private shouldMergeHeadings: boolean;
  private shouldAllowSplitIntoUnresolvedPath: boolean;
  private frontmatterMergeStrategy: FrontmatterMergeStrategy;

  public override onClose(): void {
    super.onClose();
    if (!this.isSelected) {
      this.promiseResolve(null);
    }
  }

  public constructor(plugin: Plugin, sourceFile: TFile, private readonly promiseResolve: PromiseResolve<PrepareForMergeFileResult | null>) {
    super(plugin, sourceFile);

    this.shouldFixFootnotes = plugin.settings.shouldFixFootnotesByDefault;
    this.shouldMergeHeadings = plugin.settings.shouldMergeHeadingsByDefault;
    this.shouldAllowSplitIntoUnresolvedPath = plugin.settings.shouldAllowSplitIntoUnresolvedPathByDefault;
    this.frontmatterMergeStrategy = plugin.settings.defaultFrontmatterMergeStrategy;

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
      purpose: 'to dismiss',
      onKey: () => {
        this.close();
        return false;
      }
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

  protected override async onChooseSuggestionAsync(item: Item | null, evt: KeyboardEvent | MouseEvent): Promise<void> {
    this.promiseResolve({
      item,
      isMod: Keymap.isModifier(evt, 'Mod'),
      inputValue: this.inputEl.value,
      insertMode: evt.shiftKey ? InsertMode.Prepend : InsertMode.Append,
      shouldFixFootnotes: this.shouldFixFootnotes,
      shouldAllowOnlyCurrentFolder: this.shouldAllowOnlyCurrentFolder,
      shouldMergeHeadings: this.shouldMergeHeadings,
      shouldAllowSplitIntoUnresolvedPath: this.shouldAllowSplitIntoUnresolvedPath,
      frontmatterMergeStrategy: this.frontmatterMergeStrategy
    });
  }

  public override selectSuggestion(value: Item | null, evt: KeyboardEvent | MouseEvent): void {
    this.isSelected = true;
    super.selectSuggestion(value, evt);
  }
}

interface PrepareForMergeFileResult {
  item: Item | null;
  isMod: boolean;
  inputValue: string;
  insertMode: InsertMode;
  shouldFixFootnotes: boolean;
  shouldAllowOnlyCurrentFolder: boolean;
  shouldMergeHeadings: boolean;
  shouldAllowSplitIntoUnresolvedPath: boolean;
  frontmatterMergeStrategy: FrontmatterMergeStrategy;
}

export async function prepareForMergeFile(plugin: Plugin, composer: MergeComposer, sourceFile: TFile): Promise<PrepareForMergeFileResult | null> {
  const result = await new Promise<PrepareForMergeFileResult | null>((resolve) => {
    const modal = new MergeFileModal(plugin, sourceFile, resolve);
    modal.open();
  });

  if (!result) {
    return null;
  }

  composer.insertMode = result.insertMode;
  composer.shouldFixFootnotes = result.shouldFixFootnotes;
  composer.shouldAllowOnlyCurrentFolder = result.shouldAllowOnlyCurrentFolder;
  composer.shouldMergeHeadings = result.shouldMergeHeadings;
  composer.shouldAllowSplitIntoUnresolvedPath = result.shouldAllowSplitIntoUnresolvedPath;
  composer.frontmatterMergeStrategy = result.frontmatterMergeStrategy;

  const selectItemResult = await new MergeItemSelector({
    plugin,
    sourceFile,
    item: result.item,
    isMod: result.isMod,
    inputValue: result.inputValue
  }).selectItem();
  composer.targetFile = selectItemResult.targetFile;
  composer.isNewTargetFile = selectItemResult.isNewTargetFile;

  if (!plugin.settings.shouldAskBeforeMerging) {
    return result;
  }

  const confirmDialogResult = await new Promise<ConfirmDialogModalResult>((resolve) => {
    new ConfirmDialogModal(plugin.app, sourceFile, composer.targetFile, resolve).open();
  });

  if (!confirmDialogResult.isConfirmed) {
    return null;
  }

  await plugin.settingsManager.editAndSave((settings) => {
    settings.shouldAskBeforeMerging = confirmDialogResult.shouldAskBeforeMerging;
  });

  composer.insertMode = confirmDialogResult.insertMode;
  return result;
}
