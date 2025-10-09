import {
  Keymap,
  Platform
} from 'obsidian';

import type { AdvancedNoteComposer } from './AdvancedNoteComposer.ts';
import type { Plugin } from './Plugin.ts';
import type { Item } from './SuggestModalBase.ts';

import { DynamicModal } from './DynamicModal.ts';
import { SuggestModalBase } from './SuggestModalBase.ts';
import { SuggestModalCommandBuilder } from './SuggestModalCommandBuilder.ts';

export class MergeFileSuggestModal extends SuggestModalBase {
  private doNotAskAgain = false;

  public constructor(private readonly plugin: Plugin, composer: AdvancedNoteComposer) {
    super(composer);

    this.composer.action = 'merge';

    this.emptyStateText = window.i18next.t('plugins.note-composer.label-no-files');
    this.shouldShowNonImageAttachments = false;
    this.shouldShowImages = false;
    this.shouldShowNonAttachments = false;
    this.setPlaceholder(window.i18next.t('plugins.note-composer.prompt-select-file-to-merge'));

    const builder = new SuggestModalCommandBuilder();

    builder.addKeyboardCommand({
      key: 'UpDown',
      purpose: window.i18next.t('plugins.note-composer.instruction-navigate')
    });

    builder.addKeyboardCommand({
      key: 'Enter',
      purpose: window.i18next.t('plugins.note-composer.instruction-append')
    });

    builder.addKeyboardCommand({
      key: 'Enter',
      modifiers: ['Mod'],
      onKey: (evt) => {
        this.selectActiveSuggestion(evt);
        return false;
      },
      purpose: window.i18next.t('plugins.note-composer.instruction-create-new')
    });

    builder.addKeyboardCommand({
      key: 'Enter',
      modifiers: ['Shift'],
      onKey: (evt) => {
        this.selectActiveSuggestion(evt);
        return false;
      },
      purpose: window.i18next.t('instruction-merge-at-top')
    });

    builder.addKeyboardCommand({
      key: 'Esc',
      purpose: window.i18next.t('plugins.note-composer.instruction-dismiss')
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

    builder.build(this);
  }

  protected override async onChooseSuggestionAsync(item: Item | null, evt: KeyboardEvent | MouseEvent): Promise<void> {
    await this.composer.selectItem(item, Keymap.isModifier(evt, 'Mod'), this.inputEl.value);

    if (this.composer.targetFile !== this.composer.sourceFile) {
      this.doNotAskAgain = false;

      if (this.plugin.settings.shouldAskBeforeMerging) {
        const modal = new DynamicModal(this.app)
          .setTitle(window.i18next.t('plugins.note-composer.label-merge-file'))
          .setContent(createFragment((f) => {
            f.createEl('p', {
              text: window.i18next.t('plugins.note-composer.label-confirm-file-merge', {
                destination: this.composer.targetFile.basename,
                file: this.composer.sourceFile.basename
              })
            });
          }));

        if (Platform.isMobile) {
          modal.addButton('mod-warning', window.i18next.t('plugins.note-composer.button-delete-do-not-ask-again'), async () => {
            await this.performMerge(evt);
          });
        } else {
          modal.addCheckbox(window.i18next.t('plugins.note-composer.dialogue-label-do-not-ask-again'), (evt2) => {
            if (!(evt2.target instanceof HTMLInputElement)) {
              return;
            }
            this.doNotAskAgain = evt2.target.checked;
          });
        }

        modal.addButton('mod-warning', window.i18next.t('plugins.note-composer.button-merge'), async () => {
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
