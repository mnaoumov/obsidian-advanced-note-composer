import { App, Keymap } from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/Async';

import type { AdvancedNoteComposer } from '../AdvancedNoteComposer.ts';
import type { Item } from './SuggestModalBase.ts';

import {
  Action,
  FrontmatterMergeStrategy
} from '../PluginSettings.ts';
import { SuggestModalBase } from './SuggestModalBase.ts';
import { SuggestModalCommandBuilder } from './SuggestModalCommandBuilder.ts';

export class SplitFileSuggestModal extends SuggestModalBase {
  private treatTitleAsPathCheckboxEl?: HTMLInputElement;
  private treatTitleAsPathCheckboxElValue?: boolean;

  public constructor(app: App, composer: AdvancedNoteComposer) {
    super(app, composer);

    this.composer.action = Action.Split;

    this.allowCreateNewFile = true;
    this.shouldShowUnresolved = this.composer.shouldAllowSplitIntoUnresolvedPath;
    this.shouldShowNonImageAttachments = false;
    this.shouldShowImages = false;
    this.shouldShowNonAttachments = false;

    this.setPlaceholder('Select file to split into...');

    invokeAsyncSafely(() => this.buildInstructions());
  }

  public override onOpen(): void {
    super.onOpen();
    this.inputEl.value = this.composer.heading;
    this.updateSuggestions();
  }

  protected override async onChooseSuggestionAsync(item: Item | null, evt: KeyboardEvent | MouseEvent): Promise<void> {
    await this.composer.selectItem(item, Keymap.isModifier(evt, 'Mod'), this.inputEl.value);
    this.composer.mode = evt.shiftKey ? 'prepend' : 'append';
    await this.composer.splitFile();
  }

  private async buildInstructions(): Promise<void> {
    const canIncludeFrontmatter = await this.composer.canIncludeFrontmatter();
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
      key: 'Esc',
      purpose: 'to dismiss'
    });

    builder.addCheckbox({
      key: '1',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.composer.shouldIncludeFrontmatter = value;
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = canIncludeFrontmatter && this.composer.shouldIncludeFrontmatter;
      },
      purpose: 'Include frontmatter'
    });

    builder.addCheckbox({
      key: '2',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.composer.shouldTreatTitleAsPath = value;
        this.treatTitleAsPathCheckboxElValue = value;
      },
      onInit: (checkboxEl) => {
        this.treatTitleAsPathCheckboxEl = checkboxEl;
        this.treatTitleAsPathCheckboxElValue = this.composer.shouldTreatTitleAsPath;
        checkboxEl.checked = this.composer.shouldTreatTitleAsPath;
      },
      purpose: 'Treat title as path'
    });

    builder.addCheckbox({
      key: '3',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.composer.shouldFixFootnotes = value;
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.composer.shouldFixFootnotes;
      },
      purpose: 'Fix footnotes'
    });

    builder.addCheckbox({
      key: '4',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.composer.shouldAllowOnlyCurrentFolder = value;
        this.updateSuggestions();
        if (this.treatTitleAsPathCheckboxEl !== undefined && this.treatTitleAsPathCheckboxElValue !== undefined) {
          if (this.composer.shouldAllowOnlyCurrentFolder) {
            this.treatTitleAsPathCheckboxEl.checked = false;
            this.treatTitleAsPathCheckboxEl.disabled = true;
            this.composer.shouldTreatTitleAsPath = false;
          } else {
            this.treatTitleAsPathCheckboxEl.checked = this.treatTitleAsPathCheckboxElValue;
            this.treatTitleAsPathCheckboxEl.disabled = false;
            this.composer.shouldTreatTitleAsPath = this.treatTitleAsPathCheckboxElValue;
          }
        }
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.composer.shouldAllowOnlyCurrentFolder;
      },
      purpose: 'Allow only current folder'
    });

    builder.addCheckbox({
      key: '5',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.composer.shouldMergeHeadings = value;
        this.updateSuggestions();
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.composer.shouldMergeHeadings;
      },
      purpose: 'Merge headings'
    });

    builder.addCheckbox({
      key: '6',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.composer.shouldAllowSplitIntoUnresolvedPath = value;
        this.shouldShowUnresolved = value;
        this.updateSuggestions();
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.composer.shouldAllowSplitIntoUnresolvedPath;
      },
      purpose: 'Allow split into unresolved path'
    });

    builder.addDropDown({
      key: '7',
      modifiers: ['Alt'],
      onChange: (value: string) => {
        this.composer.frontmatterMergeStrategy = value as FrontmatterMergeStrategy;
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
        dropdownComponent.setValue(this.composer.frontmatterMergeStrategy);
      },
      purpose: 'Frontmatter merge strategy'
    });

    builder.build(this);
  }
}
