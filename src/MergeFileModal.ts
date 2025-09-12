import {
  Keymap,
  Platform
} from 'obsidian';

import type { AdvancedNoteComposer } from './AdvancedNoteComposer.ts';
import type { Item } from './SuggestModalBase.ts';

import { DynamicModal } from './DynamicModal.ts';
import { SuggestModalBase } from './SuggestModalBase.ts';

export class MergeFileSuggestModal extends SuggestModalBase {
  private doNotAskAgain = false;

  public constructor(composer: AdvancedNoteComposer) {
    super(composer);

    this.composer.action = 'merge';

    this.emptyStateText = window.i18next.t('plugins.note-composer.label-no-files');
    this.shouldShowNonImageAttachments = false;
    this.shouldShowImages = false;
    this.shouldShowNonAttachments = false;
    this.setPlaceholder(window.i18next.t('plugins.note-composer.prompt-select-file-to-merge'));
    this.setInstructions([
      { command: '↑↓', purpose: window.i18next.t('plugins.note-composer.instruction-navigate') },
      { command: '↵', purpose: window.i18next.t('plugins.note-composer.instruction-merge') },
      {
        command: Platform.isMacOS ? 'cmd ↵' : 'ctrl ↵',
        purpose: window.i18next.t('plugins.note-composer.instruction-create-new')
      },
      { command: 'shift ↵', purpose: window.i18next.t('plugins.note-composer.instruction-merge-at-top') },
      { command: 'esc', purpose: window.i18next.t('plugins.note-composer.instruction-dismiss') },
      this.registerCommandWithCheckbox({
        initCheckbox: (checkboxEl) => {
          checkboxEl.checked = this.composer.shouldFixFootnotes;
          checkboxEl.addEventListener('change', () => {
            this.composer.shouldFixFootnotes = checkboxEl.checked;
          });
        },
        key: '1',
        modifiers: ['Alt'],
        purpose: 'Fix footnotes'
      }),
      this.registerCommandWithCheckbox({
        initCheckbox: (checkboxEl) => {
          checkboxEl.checked = this.composer.shouldAllowOnlyCurrentFolder;
          checkboxEl.addEventListener('change', () => {
            this.composer.shouldAllowOnlyCurrentFolder = checkboxEl.checked;
            this.updateSuggestions();
          });
        },
        key: '2',
        modifiers: ['Alt'],
        purpose: 'Allow only current folder'
      }),
      this.registerCommandWithCheckbox({
        initCheckbox: (checkboxEl) => {
          checkboxEl.checked = this.composer.shouldMergeHeadings;
          checkboxEl.addEventListener('change', () => {
            this.composer.shouldMergeHeadings = checkboxEl.checked;
            this.updateSuggestions();
          });
        },
        key: '3',
        modifiers: ['Alt'],
        purpose: 'Merge headings'
      })
    ]);

    this.scope.register(['Shift'], 'Enter', (evt) => {
      this.selectActiveSuggestion(evt);
      return false;
    });
    this.scope.register(['Mod'], 'Enter', (evt) => {
      this.selectActiveSuggestion(evt);
      return false;
    });
  }

  protected override async onChooseSuggestionAsync(item: Item | null, evt: KeyboardEvent | MouseEvent): Promise<void> {
    await this.composer.selectItem(item, Keymap.isModifier(evt, 'Mod'), this.inputEl.value);

    if (this.composer.targetFile !== this.composer.sourceFile) {
      this.doNotAskAgain = false;

      if (this.composer.corePluginInstance.options.askBeforeMerging) {
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
