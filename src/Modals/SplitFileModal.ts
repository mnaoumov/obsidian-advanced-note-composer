import type { PromiseResolve } from 'obsidian-dev-utils/Async';

import {
  Editor,
  Keymap,
  TFile
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/Async';
import { getCacheSafe } from 'obsidian-dev-utils/obsidian/MetadataCache';

import type { Selection } from '../Composers/ComposerBase.ts';
import type { InsertMode } from '../InsertMode.ts';
import type { Plugin } from '../Plugin.ts';
import type { Item } from './SuggestModalBase.ts';

import { getInsertModeFromEvent } from '../Composers/ComposerBase.ts';
import { extractHeading } from '../Headings.ts';
import { SplitItemSelector } from '../ItemSelectors/SplitItemSelector.ts';
import { FrontmatterMergeStrategy } from '../PluginSettings.ts';
import { SuggestModalBase } from './SuggestModalBase.ts';
import { SuggestModalCommandBuilder } from './SuggestModalCommandBuilder.ts';

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

    this.shouldIncludeFrontmatter = plugin.settings.shouldIncludeFrontmatterWhenSplittingByDefault;
    this.shouldTreatTitleAsPath = plugin.settings.shouldTreatTitleAsPathByDefault;
    this.shouldFixFootnotes = plugin.settings.shouldFixFootnotesByDefault;
    this.shouldMergeHeadings = plugin.settings.shouldMergeHeadingsByDefault;
    this.shouldAllowSplitIntoUnresolvedPath = plugin.settings.shouldAllowSplitIntoUnresolvedPathByDefault;
    this.frontmatterMergeStrategy = plugin.settings.defaultFrontmatterMergeStrategy;

    this.allowCreateNewFile = true;
    this.shouldShowUnresolved = plugin.settings.shouldAllowSplitIntoUnresolvedPathByDefault;
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

    const selections = await this.getSelections();

    if (!selections[0]) {
      return false;
    }

    if (selections[0].startOffset < sourceCache.frontmatterPosition.end.offset) {
      return false;
    }

    return true;
  }

  private async getSelections(): Promise<Selection[]> {
    const selections = this.editor.listSelections().map((editorSelection) => {
      const selection: Selection = {
        endOffset: this.editor.posToOffset(editorSelection.anchor),
        startOffset: this.editor.posToOffset(editorSelection.head)
      };

      if (selection.startOffset > selection.endOffset) {
        [selection.startOffset, selection.endOffset] = [selection.endOffset, selection.startOffset];
      }

      return selection;
    });

    return selections.sort((a, b) => a.startOffset - b.startOffset);
  }
}

export async function prepareForSplitFile(plugin: Plugin, sourceFile: TFile, editor: Editor, heading?: string): Promise<null | PrepareForSplitFileResult> {
  if (heading === '') {
    heading = undefined;
  }
  heading ??= extractHeading(editor);
  const result = await new Promise<null | SplitFileModalResult>((resolve) => {
    const modal = new SplitFileModal(plugin, heading, sourceFile, editor, resolve);
    modal.open();
  });

  if (!result) {
    return null;
  }

  const selectItemResult = await new SplitItemSelector({
    inputValue: result.inputValue,
    isMod: result.isMod,
    item: result.item,
    plugin,
    shouldAllowOnlyCurrentFolder: result.shouldAllowOnlyCurrentFolder,
    shouldTreatTitleAsPath: !heading && result.shouldTreatTitleAsPath,
    sourceFile
  }).selectItem();

  const prepareForSplitFileResult: PrepareForSplitFileResult = {
    frontmatterMergeStrategy: result.frontmatterMergeStrategy,
    insertMode: result.insertMode,
    isNewTargetFile: selectItemResult.isNewTargetFile,
    shouldAllowOnlyCurrentFolder: result.shouldAllowOnlyCurrentFolder,
    shouldAllowSplitIntoUnresolvedPath: result.shouldAllowSplitIntoUnresolvedPath,
    shouldFixFootnotes: result.shouldFixFootnotes,
    shouldIncludeFrontmatter: result.shouldIncludeFrontmatter,
    shouldMergeHeadings: result.shouldMergeHeadings,
    targetFile: selectItemResult.targetFile
  };

  return prepareForSplitFileResult;
}
