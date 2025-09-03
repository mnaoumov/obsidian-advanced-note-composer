import {
  Keymap,
  Platform
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/Async';

import type { AdvancedNoteComposer } from './AdvancedNoteComposer.ts';
import type { Item } from './SuggestModalBase.ts';

import { SuggestModalBase } from './SuggestModalBase.ts';

export class SplitFileSuggestModal extends SuggestModalBase {
  public constructor(composer: AdvancedNoteComposer) {
    super(composer);

    this.composer.action = 'split';

    this.allowCreateNewFile = true;
    this.shouldShowUnresolved = true;
    this.shouldShowNonImageAttachments = false;
    this.shouldShowImages = false;
    this.shouldShowNonAttachments = false;

    this.setPlaceholder(window.i18next.t('plugins.note-composer.prompt-select-file-to-merge'));

    this.scope.register(['Shift'], 'Enter', (evt) => {
      this.selectActiveSuggestion(evt);
      return false;
    });
    this.scope.register(['Mod'], 'Enter', (evt) => {
      this.selectActiveSuggestion(evt);
      return false;
    });

    invokeAsyncSafely(async () => {
      const canIncludeFrontmatter = await this.composer.canIncludeFrontmatter();
      this.setInstructions([
        { command: '↑↓', purpose: window.i18next.t('plugins.note-composer.instruction-navigate') },
        { command: '↵', purpose: window.i18next.t('plugins.note-composer.instruction-append') },
        {
          command: Platform.isMacOS ? 'cmd ↵' : 'ctrl ↵',
          purpose: window.i18next.t('plugins.note-composer.instruction-create-new')
        },
        { command: 'shift ↵', purpose: window.i18next.t('plugins.note-composer.instruction-prepend') },
        { command: 'esc', purpose: window.i18next.t('plugins.note-composer.instruction-dismiss') },
        this.registerCommandWithCheckbox(['Alt'], '1', 'Include frontmatter', canIncludeFrontmatter && this.composer.shouldIncludeFrontmatter, (value) => {
          this.composer.shouldIncludeFrontmatter = value;
        }, canIncludeFrontmatter),
        this.registerCommandWithCheckbox(['Alt'], '2', 'Treat title as path', this.composer.shouldTreatTitleAsPath, (value) => {
          this.composer.shouldTreatTitleAsPath = value;
        }),
        this.registerCommandWithCheckbox(['Alt'], '3', 'Fix footnotes', this.composer.shouldFixFootnotes, (value) => {
          this.composer.shouldFixFootnotes = value;
        })
      ]);
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
}
