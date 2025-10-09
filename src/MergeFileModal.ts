import {
  Keymap,
  Platform
} from 'obsidian';

import type { AdvancedNoteComposer } from './AdvancedNoteComposer.ts';
import type { Plugin } from './Plugin.ts';
import type { Item } from './SuggestModalBase.ts';

import { DynamicModal } from './DynamicModal.ts';
import { FrontmatterMergeStrategy } from './PluginSettings.ts';
import { SuggestModalBase } from './SuggestModalBase.ts';
import { SuggestModalCommandBuilder } from './SuggestModalCommandBuilder.ts';

export class MergeFileSuggestModal extends SuggestModalBase {
  private doNotAskAgain = false;

  public constructor(private readonly plugin: Plugin, composer: AdvancedNoteComposer) {
    super(composer);

    this.composer.action = 'merge';

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
      key: 'Esc',
      purpose: 'to dismiss'
    });

    builder.addCheckbox({
      key: '1',
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
      key: '2',
      modifiers: ['Alt'],
      onChange: (value: boolean) => {
        this.composer.shouldAllowOnlyCurrentFolder = value;
        this.updateSuggestions();
      },
      onInit: (checkboxEl) => {
        checkboxEl.checked = this.composer.shouldAllowOnlyCurrentFolder;
      },
      purpose: 'Allow only current folder'
    });

    builder.addCheckbox({
      key: '3',
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
      key: '4',
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
      key: '5',
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

  protected override async onChooseSuggestionAsync(item: Item | null, evt: KeyboardEvent | MouseEvent): Promise<void> {
    await this.composer.selectItem(item, Keymap.isModifier(evt, 'Mod'), this.inputEl.value);

    if (this.composer.targetFile !== this.composer.sourceFile) {
      this.doNotAskAgain = false;

      if (this.plugin.settings.shouldAskBeforeMerging) {
        const modal = new DynamicModal(this.app)
          .setTitle('Merge file')
          .setContent(createFragment((f) => {
            f.createEl('p', {
              text:
                `Are you sure you want to merge "${this.composer.sourceFile.basename}" into "${this.composer.targetFile.basename}"? "${this.composer.sourceFile.basename}" will be deleted.`
            });
          }));

        if (Platform.isMobile) {
          modal.addButton('mod-warning', 'Delete and don\'t ask again', async () => {
            await this.performMerge(evt);
          });
        } else {
          modal.addCheckbox('Don\'t ask again', (evt2) => {
            if (!(evt2.target instanceof HTMLInputElement)) {
              return;
            }
            this.doNotAskAgain = evt2.target.checked;
          });
        }

        modal.addButton('mod-warning', 'Merge', async () => {
          await this.performMerge(evt);
        })
          .addCancelButton()
          .open();
      } else {
        await this.performMerge(evt);
      }
    }
  }

  private async performMerge(evt: KeyboardEvent | MouseEvent): Promise<void> {
    this.composer.mode = evt.shiftKey ? 'prepend' : 'append';
    await this.composer.mergeFile(this.doNotAskAgain);
  }
}
