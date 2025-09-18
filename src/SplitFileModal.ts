import {
  Keymap,
  Platform
} from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/Async';

import type { AdvancedNoteComposer } from './AdvancedNoteComposer.ts';
import type { Item } from './SuggestModalBase.ts';

import { SuggestModalBase } from './SuggestModalBase.ts';

export class SplitFileSuggestModal extends SuggestModalBase {
  private treatTitleAsPathCheckboxEl!: HTMLInputElement;
  private treatTitleAsPathCheckboxElValue!: boolean;

  public constructor(composer: AdvancedNoteComposer) {
    super(composer);

    this.composer.action = 'split';

    this.allowCreateNewFile = true;
    this.shouldShowUnresolved = this.composer.shouldAllowSplitIntoUnresolvedPath;
    this.shouldShowNonImageAttachments = false;
    this.shouldShowImages = false;
    this.shouldShowNonAttachments = false;

    this.setPlaceholder('Select file to split into...');

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
        this.registerCommandWithCheckbox({
          initCheckbox: (checkboxEl) => {
            checkboxEl.checked = canIncludeFrontmatter && this.composer.shouldIncludeFrontmatter;
            checkboxEl.disabled = !canIncludeFrontmatter;
            checkboxEl.addEventListener('change', () => {
              this.composer.shouldIncludeFrontmatter = checkboxEl.checked;
            });
          },
          key: '1',
          modifiers: ['Alt'],
          purpose: 'Include frontmatter'
        }),
        this.registerCommandWithCheckbox({
          initCheckbox: (checkboxEl) => {
            this.treatTitleAsPathCheckboxEl = checkboxEl;
            this.treatTitleAsPathCheckboxElValue = this.composer.shouldTreatTitleAsPath;
            checkboxEl.checked = this.composer.shouldTreatTitleAsPath;
            checkboxEl.addEventListener('change', () => {
              this.composer.shouldTreatTitleAsPath = checkboxEl.checked;
              this.treatTitleAsPathCheckboxElValue = checkboxEl.checked;
            });
          },
          key: '2',
          modifiers: ['Alt'],
          purpose: 'Treat title as path'
        }),
        this.registerCommandWithCheckbox({
          initCheckbox: (checkboxEl) => {
            checkboxEl.checked = this.composer.shouldFixFootnotes;
            checkboxEl.addEventListener('change', () => {
              this.composer.shouldFixFootnotes = checkboxEl.checked;
            });
          },
          key: '3',
          modifiers: ['Alt'],
          purpose: 'Fix footnotes'
        }),
        this.registerCommandWithCheckbox({
          initCheckbox: (checkboxEl) => {
            checkboxEl.checked = this.composer.shouldAllowOnlyCurrentFolder;
            checkboxEl.addEventListener('change', () => {
              this.composer.shouldAllowOnlyCurrentFolder = checkboxEl.checked;
              this.updateSuggestions();
              if (this.composer.shouldAllowOnlyCurrentFolder) {
                this.treatTitleAsPathCheckboxEl.checked = false;
                this.treatTitleAsPathCheckboxEl.disabled = true;
                this.composer.shouldTreatTitleAsPath = false;
              } else {
                this.treatTitleAsPathCheckboxEl.checked = this.treatTitleAsPathCheckboxElValue;
                this.treatTitleAsPathCheckboxEl.disabled = false;
                this.composer.shouldTreatTitleAsPath = this.treatTitleAsPathCheckboxElValue;
              }
            });
          },
          key: '4',
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
          key: '5',
          modifiers: ['Alt'],
          purpose: 'Merge headings'
        }),
        this.registerCommandWithCheckbox({
          initCheckbox: (checkboxEl) => {
            checkboxEl.checked = this.composer.shouldAllowSplitIntoUnresolvedPath;
            checkboxEl.addEventListener('change', () => {
              this.composer.shouldAllowSplitIntoUnresolvedPath = checkboxEl.checked;
              this.shouldShowUnresolved = checkboxEl.checked;
              this.updateSuggestions();
            });
          },
          key: '6',
          modifiers: ['Alt'],
          purpose: 'Allow split into unresolved path'
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
