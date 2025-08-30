import {
  Keymap,
  Platform
} from 'obsidian';

import type { AdvancedNoteComposer } from './AdvancedNoteComposer.ts';
import type { Item } from './SuggestModalBase.ts';

import { SuggestModalBase } from './SuggestModalBase.ts';

export class SplitFileSuggestModal extends SuggestModalBase {
  private readonly defaultValue: string;

  public constructor(private readonly composer: AdvancedNoteComposer) {
    super(composer.app);

    this.composer.action = 'split';

    this.defaultValue = '';
    this.allowCreateNewFile = true;
    this.shouldShowUnresolved = true;
    this.shouldShowNonImageAttachments = false;
    this.shouldShowImages = false;
    this.shouldShowNonAttachments = false;

    this.composer.initHeading();
    this.defaultValue = this.composer.heading;

    this.setPlaceholder(window.i18next.t('plugins.note-composer.prompt-select-file-to-merge'));
    this.setInstructions([
      { command: '↑↓', purpose: window.i18next.t('plugins.note-composer.instruction-navigate') },
      { command: '↵', purpose: window.i18next.t('plugins.note-composer.instruction-append') },
      {
        command: Platform.isMacOS ? 'cmd ↵' : 'ctrl ↵',
        purpose: window.i18next.t('plugins.note-composer.instruction-create-new')
      },
      { command: 'shift ↵', purpose: window.i18next.t('plugins.note-composer.instruction-prepend') },
      { command: 'esc', purpose: window.i18next.t('plugins.note-composer.instruction-dismiss') }
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

  public override onOpen(): void {
    super.onOpen();
    this.inputEl.value = this.defaultValue;
    this.updateSuggestions();

    this.instructionsEl.createEl('label', {}, (label) => {
      label.createEl('input', { type: 'checkbox' }, (checkbox) => {
        checkbox.addEventListener('change', () => {
          this.composer.shouldIncludeFrontmatter = checkbox.checked;
        });
      });
      label.appendText('Include frontmatter');
    });
  }

  protected override async onChooseSuggestionAsync(item: Item | null, evt: KeyboardEvent | MouseEvent): Promise<void> {
    await this.composer.selectItem(item, Keymap.isModifier(evt, 'Mod'), this.inputEl.value);
    this.composer.mode = evt.shiftKey ? 'prepend' : 'append';
    await this.composer.splitFile();
  }
}
