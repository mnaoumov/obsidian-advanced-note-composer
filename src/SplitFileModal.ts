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
    const INCLUDE_EXCLUDE_FRONTMATTER_INSTRUCTION = 'Include/exclude frontmatter';
    this.setInstructions([
      { command: '↑↓', purpose: window.i18next.t('plugins.note-composer.instruction-navigate') },
      { command: '↵', purpose: window.i18next.t('plugins.note-composer.instruction-append') },
      {
        command: Platform.isMacOS ? 'cmd ↵' : 'ctrl ↵',
        purpose: window.i18next.t('plugins.note-composer.instruction-create-new')
      },
      { command: 'shift ↵', purpose: window.i18next.t('plugins.note-composer.instruction-prepend') },
      { command: 'esc', purpose: window.i18next.t('plugins.note-composer.instruction-dismiss') },
      { command: 'alt f', purpose: INCLUDE_EXCLUDE_FRONTMATTER_INSTRUCTION }
    ]);

    const includeExcludeFrontmatterInstructionEl = this.instructionsEl.findAll('span').find((span) =>
      span.textContent === INCLUDE_EXCLUDE_FRONTMATTER_INSTRUCTION
    );
    let includeFrontmatterCheckboxEl: HTMLInputElement;
    if (includeExcludeFrontmatterInstructionEl) {
      includeFrontmatterCheckboxEl = includeExcludeFrontmatterInstructionEl.createEl('input', { type: 'checkbox' });
      includeFrontmatterCheckboxEl.checked = this.composer.shouldIncludeFrontmatter;
      includeFrontmatterCheckboxEl.addEventListener('change', () => {
        this.composer.shouldIncludeFrontmatter = includeFrontmatterCheckboxEl.checked;
      });
    }

    this.scope.register(['Shift'], 'Enter', (evt) => {
      this.selectActiveSuggestion(evt);
      return false;
    });
    this.scope.register(['Mod'], 'Enter', (evt) => {
      this.selectActiveSuggestion(evt);
      return false;
    });
    this.scope.register(['Alt'], 'f', () => {
      includeFrontmatterCheckboxEl.checked = !includeFrontmatterCheckboxEl.checked;
      includeFrontmatterCheckboxEl.trigger('change');
    });
  }

  public override onOpen(): void {
    super.onOpen();
    this.inputEl.value = this.defaultValue;
    this.updateSuggestions();
  }

  protected override async onChooseSuggestionAsync(item: Item | null, evt: KeyboardEvent | MouseEvent): Promise<void> {
    await this.composer.selectItem(item, Keymap.isModifier(evt, 'Mod'), this.inputEl.value);
    this.composer.mode = evt.shiftKey ? 'prepend' : 'append';
    await this.composer.splitFile();
  }
}
