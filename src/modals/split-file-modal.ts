import type { PromiseResolve } from 'obsidian-dev-utils/async';

import {
  App,
  Editor,
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
import { getCacheSafe } from 'obsidian-dev-utils/obsidian/metadata-cache';
import { trashSafe } from 'obsidian-dev-utils/obsidian/vault';

import type { Plugin } from '../plugin.ts';
import type { Item } from './suggest-modal-base.ts';

import { getInsertModeFromEvent } from '../composers/composer-base.ts';
import { getSelections } from '../composers/split-composer.ts';
import { extractHeading } from '../headings.ts';
import { InsertMode } from '../insert-mode.ts';
import { SplitItemSelector } from '../item-selectors/split-item-selector.ts';
import { FrontmatterMergeStrategy } from '../plugin-settings.ts';
import { SuggestModalBase } from './suggest-modal-base.ts';
import { SuggestModalCommandBuilder } from './suggest-modal-command-builder.ts';

interface ConfirmDialogModalResult {
  insertMode: InsertMode;
  isConfirmed: boolean;
  shouldAskBeforeSplitting: boolean;
}

interface PrepareForSplitFileResult {
  frontmatterMergeStrategy: FrontmatterMergeStrategy;
  insertMode: InsertMode;
  isNewTargetFile: boolean;
  shouldAllowOnlyCurrentFolder: boolean;
  shouldAllowSplitIntoUnresolvedPath: boolean;
  shouldFixFootnotes: boolean;
  shouldIncludeFrontmatter: boolean;
  shouldMergeHeadings: boolean;
  targetFile: TFile;
}

interface SplitFileModalResult {
  frontmatterMergeStrategy: FrontmatterMergeStrategy;
  inputValue: string;
  insertMode: InsertMode;
  isMod: boolean;
  item: Item | null;
  shouldAllowOnlyCurrentFolder: boolean;
  shouldAllowSplitIntoUnresolvedPath: boolean;
  shouldFixFootnotes: boolean;
  shouldIncludeFrontmatter: boolean;
  shouldMergeHeadings: boolean;
  shouldTreatTitleAsPath: boolean;
}

class ConfirmDialogModal extends Modal {
  private isSelected = false;
  private shouldAskBeforeSplitting = true;

  public constructor(
    app: App,
    private readonly sourceFile: TFile,
    private readonly targetFile: TFile,
    private readonly editor: Editor,
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
        shouldAskBeforeSplitting: false
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
      shouldAskBeforeSplitting: this.shouldAskBeforeSplitting
    });
    this.close();
  }

  private async onOpenAsync(): Promise<void> {
    this.setTitle('Split file');

    this.containerEl.addClass('mod-confirmation');
    const buttonContainerEl = this.modalEl.createDiv('modal-button-container');

    this.setContent(
      await createFragmentAsync(async (f) => {
        f.appendText('Are you sure you want to split ');
        appendCodeBlock(f, 'Source');
        f.appendText(' into ');
        appendCodeBlock(f, 'Target');
        f.appendText('?');
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
        f.createEl('br');
        f.createEl('br');
        f.createEl('h2', { text: 'Source content to split' });
        const selectedText = getSelections(this.editor).map((selection) => this.editor.cm.state.sliceDoc(selection.startOffset, selection.endOffset))
          .join('\n');
        const lines = selectedText.split('\n');
        for (const line of lines) {
          appendCodeBlock(f, line);
          f.createEl('br');
        }
      })
    );

    if (Platform.isMobile) {
      buttonContainerEl.createEl('button', {
        cls: 'mod-warning',
        text: 'Split and don\'t ask again'
      }, (button) => {
        button.addEventListener('click', (evt) => {
          this.shouldAskBeforeSplitting = false;
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
              this.shouldAskBeforeSplitting = !evt.target.checked;
            });
          });
        label.appendText('Don\'t ask again');
      });
    }

    buttonContainerEl.createEl('button', {
      cls: 'mod-warning',
      text: 'Split'
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

class SplitFileModal extends SuggestModalBase {
  private frontmatterMergeStrategy: FrontmatterMergeStrategy;
  private isSelected = false;
  private shouldAllowSplitIntoUnresolvedPath: boolean;
  private shouldFixFootnotes: boolean;
  private shouldIncludeFrontmatter: boolean;
  private shouldMergeHeadings: boolean;
  private shouldTreatTitleAsPath: boolean;
  private treatTitleAsPathCheckboxEl?: HTMLInputElement;
  private treatTitleAsPathCheckboxElValue?: boolean;

  public constructor(
    plugin: Plugin,
    private readonly heading: string,
    sourceFile: TFile,
    private readonly editor: Editor,
    private readonly promiseResolve: PromiseResolve<null | SplitFileModalResult>
  ) {
    super(plugin, sourceFile);

    this.shouldIncludeFrontmatter = plugin.pluginSettingsComponent.settings.shouldIncludeFrontmatterWhenSplittingByDefault;
    this.shouldTreatTitleAsPath = plugin.pluginSettingsComponent.settings.shouldTreatTitleAsPathByDefault;
    this.shouldFixFootnotes = plugin.pluginSettingsComponent.settings.shouldFixFootnotesByDefault;
    this.shouldMergeHeadings = plugin.pluginSettingsComponent.settings.shouldMergeHeadingsByDefault;
    this.shouldAllowSplitIntoUnresolvedPath = plugin.pluginSettingsComponent.settings.shouldAllowSplitIntoUnresolvedPathByDefault;
    this.frontmatterMergeStrategy = plugin.pluginSettingsComponent.settings.defaultFrontmatterMergeStrategy;

    this.allowCreateNewFile = true;
    this.shouldShowUnresolved = plugin.pluginSettingsComponent.settings.shouldAllowSplitIntoUnresolvedPathByDefault;
    this.shouldShowNonImageAttachments = false;
    this.shouldShowImages = false;
    this.shouldShowNonAttachments = false;

    this.setPlaceholder('Select file to split into...');

    invokeAsyncSafely(() => this.buildInstructions());
  }

  public override onClose(): void {
    super.onClose();
    if (!this.isSelected) {
      this.promiseResolve(null);
    }
  }

  public override onOpen(): void {
    super.onOpen();
    this.inputEl.value = this.heading;
    this.updateSuggestions();
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
      shouldIncludeFrontmatter: this.shouldIncludeFrontmatter,
      shouldMergeHeadings: this.shouldMergeHeadings,
      shouldTreatTitleAsPath: this.shouldTreatTitleAsPath
    });
  }

  private async buildInstructions(): Promise<void> {
    const canIncludeFrontmatter = await this.canIncludeFrontmatter();
    const builder = new SuggestModalCommandBuilder();

    builder.addKeyboardCommand({ key: 'UpDown', purpose: 'to navigate' });
    builder.addKeyboardCommand({ key: 'Enter', purpose: 'to move to bottom' });
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
      purpose: 'to move to top'
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
        this.shouldIncludeFrontmatter = value;
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = canIncludeFrontmatter && this.shouldIncludeFrontmatter;
      },
      purpose: 'Include frontmatter'
    });

    builder.addCheckbox({
      key: '2',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.shouldTreatTitleAsPath = value;
        this.treatTitleAsPathCheckboxElValue = value;
      },
      onInit: (checkboxEl) => {
        this.treatTitleAsPathCheckboxEl = checkboxEl;
        this.treatTitleAsPathCheckboxElValue = this.shouldTreatTitleAsPath;
        checkboxEl.checked = this.shouldTreatTitleAsPath;
      },
      purpose: 'Treat title as path'
    });

    builder.addCheckbox({
      key: '3',
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
      key: '4',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.shouldAllowOnlyCurrentFolder = value;
        this.updateSuggestions();
        if (this.treatTitleAsPathCheckboxEl !== undefined && this.treatTitleAsPathCheckboxElValue !== undefined) {
          if (this.shouldAllowOnlyCurrentFolder) {
            this.treatTitleAsPathCheckboxEl.checked = false;
            this.treatTitleAsPathCheckboxEl.disabled = true;
            this.shouldTreatTitleAsPath = false;
          } else {
            this.treatTitleAsPathCheckboxEl.checked = this.treatTitleAsPathCheckboxElValue;
            this.treatTitleAsPathCheckboxEl.disabled = false;
            this.shouldTreatTitleAsPath = this.treatTitleAsPathCheckboxElValue;
          }
        }
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.shouldAllowOnlyCurrentFolder;
      },
      purpose: 'Allow only current folder'
    });

    builder.addCheckbox({
      key: '5',
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
      key: '6',
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
      key: '7',
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

  private async canIncludeFrontmatter(): Promise<boolean> {
    const sourceCache = await getCacheSafe(this.app, this.sourceFile);
    if (!sourceCache?.frontmatterPosition) {
      return false;
    }
    const selections = getSelections(this.editor);
    if (!selections[0]) {
      return false;
    }
    if (selections[0].startOffset < sourceCache.frontmatterPosition.end.offset) {
      return false;
    }
    return true;
  }
}

export async function prepareForSplitFile(
  plugin: Plugin,
  sourceFile: TFile,
  editor: Editor,
  heading?: string,
  shouldSkipModal?: boolean
): Promise<null | PrepareForSplitFileResult> {
  if (heading === '') {
    heading = undefined;
  }
  heading ??= extractHeading(editor);

  const splitFileModalResult: null | SplitFileModalResult = shouldSkipModal
    ? {
      frontmatterMergeStrategy: plugin.pluginSettingsComponent.settings.defaultFrontmatterMergeStrategy,
      inputValue: heading,
      insertMode: InsertMode.Append,
      isMod: false,
      item: null,
      shouldAllowOnlyCurrentFolder: plugin.pluginSettingsComponent.settings.shouldAllowOnlyCurrentFolderByDefault,
      shouldAllowSplitIntoUnresolvedPath: plugin.pluginSettingsComponent.settings.shouldAllowSplitIntoUnresolvedPathByDefault,
      shouldFixFootnotes: plugin.pluginSettingsComponent.settings.shouldFixFootnotesByDefault,
      shouldIncludeFrontmatter: plugin.pluginSettingsComponent.settings.shouldIncludeFrontmatterWhenSplittingByDefault,
      shouldMergeHeadings: plugin.pluginSettingsComponent.settings.shouldMergeHeadingsByDefault,
      shouldTreatTitleAsPath: plugin.pluginSettingsComponent.settings.shouldTreatTitleAsPathByDefault
    }
    : await new Promise<null | SplitFileModalResult>((resolve) => {
      const modal = new SplitFileModal(plugin, heading, sourceFile, editor, resolve);
      modal.open();
    });

  if (!splitFileModalResult) {
    return null;
  }

  const selectItemResult = await new SplitItemSelector({
    inputValue: splitFileModalResult.inputValue,
    isMod: splitFileModalResult.isMod,
    item: splitFileModalResult.item,
    plugin,
    shouldAllowOnlyCurrentFolder: splitFileModalResult.shouldAllowOnlyCurrentFolder,
    shouldTreatTitleAsPath: !heading && splitFileModalResult.shouldTreatTitleAsPath,
    sourceFile
  }).selectItem();

  const prepareForSplitFileResult: PrepareForSplitFileResult = {
    frontmatterMergeStrategy: splitFileModalResult.frontmatterMergeStrategy,
    insertMode: splitFileModalResult.insertMode,
    isNewTargetFile: selectItemResult.isNewTargetFile,
    shouldAllowOnlyCurrentFolder: splitFileModalResult.shouldAllowOnlyCurrentFolder,
    shouldAllowSplitIntoUnresolvedPath: splitFileModalResult.shouldAllowSplitIntoUnresolvedPath,
    shouldFixFootnotes: splitFileModalResult.shouldFixFootnotes,
    shouldIncludeFrontmatter: splitFileModalResult.shouldIncludeFrontmatter,
    shouldMergeHeadings: splitFileModalResult.shouldMergeHeadings,
    targetFile: selectItemResult.targetFile
  };

  if (!plugin.pluginSettingsComponent.settings.shouldAskBeforeSplitting) {
    return prepareForSplitFileResult;
  }

  const confirmDialogResult = await new Promise<ConfirmDialogModalResult>((resolve) => {
    new ConfirmDialogModal(plugin.app, sourceFile, prepareForSplitFileResult.targetFile, editor, resolve).open();
  });

  if (!confirmDialogResult.isConfirmed) {
    if (prepareForSplitFileResult.isNewTargetFile) {
      await trashSafe(plugin.app, prepareForSplitFileResult.targetFile);
    }
    return null;
  }

  await plugin.pluginSettingsComponent.editAndSave((settings) => {
    settings.shouldAskBeforeSplitting = confirmDialogResult.shouldAskBeforeSplitting;
  });

  return prepareForSplitFileResult;
}
