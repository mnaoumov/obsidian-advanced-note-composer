import type { Modifier } from 'obsidian';

import {
  Keymap,
  Platform
} from 'obsidian';

import type { AdvancedNoteComposer } from './AdvancedNoteComposer.ts';
import type { Item } from './SuggestModalBase.ts';

import { SuggestModalBase } from './SuggestModalBase.ts';

export class SplitFileSuggestModal extends SuggestModalBase {
  public constructor(private readonly composer: AdvancedNoteComposer) {
    super(composer.app);

    this.composer.action = 'split';

    this.allowCreateNewFile = true;
    this.shouldShowUnresolved = true;
    this.shouldShowNonImageAttachments = false;
    this.shouldShowImages = false;
    this.shouldShowNonAttachments = false;

    this.setPlaceholder(window.i18next.t('plugins.note-composer.prompt-select-file-to-merge'));
    const INCLUDE_EXCLUDE_FRONTMATTER_INSTRUCTION = 'Include/exclude frontmatter';
    const ENABLE_DISABLE_TREAT_TITLE_AS_PATH_INSTRUCTION = 'Enable/disable treat title as path';
    this.setInstructions([
      { command: '↑↓', purpose: window.i18next.t('plugins.note-composer.instruction-navigate') },
      { command: '↵', purpose: window.i18next.t('plugins.note-composer.instruction-append') },
      {
        command: Platform.isMacOS ? 'cmd ↵' : 'ctrl ↵',
        purpose: window.i18next.t('plugins.note-composer.instruction-create-new')
      },
      { command: 'shift ↵', purpose: window.i18next.t('plugins.note-composer.instruction-prepend') },
      { command: 'esc', purpose: window.i18next.t('plugins.note-composer.instruction-dismiss') },
      { command: 'alt f', purpose: INCLUDE_EXCLUDE_FRONTMATTER_INSTRUCTION },
      { command: 'alt t', purpose: ENABLE_DISABLE_TREAT_TITLE_AS_PATH_INSTRUCTION }
    ]);

    this.addCheckBox(['Alt'], 'f', INCLUDE_EXCLUDE_FRONTMATTER_INSTRUCTION, this.composer.shouldIncludeFrontmatter, (value) => {
      this.composer.shouldIncludeFrontmatter = value;
    });

    this.addCheckBox(['Alt'], 't', ENABLE_DISABLE_TREAT_TITLE_AS_PATH_INSTRUCTION, this.composer.shouldTreatTitleAsPath, (value) => {
      this.composer.shouldTreatTitleAsPath = value;
    });

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
    this.inputEl.value = this.composer.heading;
    this.updateSuggestions();
  }

  protected override async onChooseSuggestionAsync(item: Item | null, evt: KeyboardEvent | MouseEvent): Promise<void> {
    await this.composer.selectItem(item, Keymap.isModifier(evt, 'Mod'), this.inputEl.value);
    this.composer.mode = evt.shiftKey ? 'prepend' : 'append';
    await this.composer.splitFile();
  }

  private addCheckBox(modifiers: Modifier[] | null, key: string, instruction: string, initialValue: boolean, onChange: (value: boolean) => void): void {
    const instructionEl = this.instructionsEl.findAll('span').find((span) => span.textContent === instruction);

    if (!instructionEl) {
      throw new Error(`Instruction ${instruction} not found`);
    }

    const checkboxEl: HTMLInputElement = instructionEl.createEl('input', { type: 'checkbox' });
    checkboxEl.checked = initialValue;
    checkboxEl.addEventListener('change', () => {
      onChange(checkboxEl.checked);
    });

    this.scope.register(modifiers, key, () => {
      checkboxEl.checked = !checkboxEl.checked;
      onChange(checkboxEl.checked);
    });
  }
}
