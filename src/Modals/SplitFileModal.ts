import { Editor, Keymap, TFile } from 'obsidian';
import { invokeAsyncSafely, type PromiseResolve } from 'obsidian-dev-utils/Async';

import type { Selection } from '../Composers/ComposerBase.ts';

import type { Item } from './SuggestModalBase.ts';

import {
  FrontmatterMergeStrategy
} from '../PluginSettings.ts';
import { SuggestModalBase } from './SuggestModalBase.ts';
import { SuggestModalCommandBuilder } from './SuggestModalCommandBuilder.ts';
import type { Plugin } from '../Plugin.ts';
import type { SplitComposer } from '../Composers/SplitComposer.ts';
import { getCacheSafe } from 'obsidian-dev-utils/obsidian/MetadataCache';

class SplitFileModal extends SuggestModalBase {
  private treatTitleAsPathCheckboxEl?: HTMLInputElement;
  private treatTitleAsPathCheckboxElValue?: boolean;
  private isSelected = false;
  private shouldIncludeFrontmatter: boolean;
  private shouldTreatTitleAsPath: boolean;
  private shouldFixFootnotes: boolean;
  private shouldMergeHeadings: boolean;
  private shouldAllowSplitIntoUnresolvedPath: boolean;
  private frontmatterMergeStrategy: FrontmatterMergeStrategy;

  public override selectSuggestion(value: Item | null, evt: KeyboardEvent | MouseEvent): void {
    this.isSelected = true;
    super.selectSuggestion(value, evt);
  }

  public constructor(plugin: Plugin, private readonly heading: string, sourceFile: TFile, private editor: Editor, private readonly promiseResolve: PromiseResolve<PrepareForSplitFileResult | null>) {
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

  public override onOpen(): void {
    super.onOpen();
    this.inputEl.value = this.heading;
    this.updateSuggestions();
  }

  public override onClose(): void {
    super.onClose();
    if (!this.isSelected) {
      this.promiseResolve(null);
    }
  }


  protected override async onChooseSuggestionAsync(item: Item | null, evt: KeyboardEvent | MouseEvent): Promise<void> {
    this.promiseResolve({
      item,
      isMod: Keymap.isModifier(evt, 'Mod'),
      inputValue: this.inputEl.value,
      inputMode: evt.shiftKey ? 'prepend' : 'append',
      shouldIncludeFrontmatter: this.shouldIncludeFrontmatter,
      shouldTreatTitleAsPath: this.shouldTreatTitleAsPath,
      shouldFixFootnotes: this.shouldFixFootnotes,
      shouldAllowOnlyCurrentFolder: this.shouldAllowOnlyCurrentFolder,
      shouldMergeHeadings: this.shouldMergeHeadings,
      shouldAllowSplitIntoUnresolvedPath: this.shouldAllowSplitIntoUnresolvedPath,
      frontmatterMergeStrategy: this.frontmatterMergeStrategy
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

  private async getSelections(): Promise<Selection[]> {
    if (this.editor) {
      const selections = this.editor.listSelections().map((editorSelection) => {
        const selection: Selection = {
          endOffset: this.editor?.posToOffset(editorSelection.anchor) ?? 0,
          startOffset: this.editor?.posToOffset(editorSelection.head) ?? 0
        };

        if (selection.startOffset > selection.endOffset) {
          [selection.startOffset, selection.endOffset] = [selection.endOffset, selection.startOffset];
        }

        return selection;
      });

      return selections.sort((a, b) => a.startOffset - b.startOffset);
    }

    const content = await this.app.vault.read(this.sourceFile);

    return [{
      endOffset: content.length,
      startOffset: 0
    }];
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
}

interface PrepareForSplitFileResult {
  item: Item | null;
  isMod: boolean;
  inputValue: string;
  inputMode: 'prepend' | 'append';
  shouldIncludeFrontmatter: boolean;
  shouldTreatTitleAsPath: boolean;
  shouldFixFootnotes: boolean;
  shouldAllowOnlyCurrentFolder: boolean;
  shouldMergeHeadings: boolean;
  shouldAllowSplitIntoUnresolvedPath: boolean;
  frontmatterMergeStrategy: FrontmatterMergeStrategy;
}

export async function prepareForSplitFile(plugin: Plugin, composer: SplitComposer, sourceFile: TFile, editor: Editor, heading?: string): Promise<PrepareForSplitFileResult | null> {
  const result = await new Promise<PrepareForSplitFileResult | null>((resolve) => {
    const modal = new SplitFileModal(plugin, heading ?? '', sourceFile, editor, resolve);
    modal.open();
  });

  if (!result) {
    return null;
  }

  composer.insertMode = result.inputMode;
  composer.shouldIncludeFrontmatter = result.shouldIncludeFrontmatter;
  composer.shouldTreatTitleAsPath = result.shouldTreatTitleAsPath;
  composer.shouldFixFootnotes = result.shouldFixFootnotes;
  composer.shouldAllowOnlyCurrentFolder = result.shouldAllowOnlyCurrentFolder;
  composer.shouldMergeHeadings = result.shouldMergeHeadings;
  composer.shouldAllowSplitIntoUnresolvedPath = result.shouldAllowSplitIntoUnresolvedPath;
  composer.frontmatterMergeStrategy = result.frontmatterMergeStrategy;
  composer.shouldAllowSplitIntoUnresolvedPath = result.shouldAllowSplitIntoUnresolvedPath;

  await composer.selectItem(result.item, result.isMod, result.inputValue);
  return result;
}
