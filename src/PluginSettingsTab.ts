import { appendCodeBlock } from 'obsidian-dev-utils/HTMLElement';
import { PluginSettingsTabBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginSettingsTabBase';
import { SettingEx } from 'obsidian-dev-utils/obsidian/SettingEx';

import type { PluginTypes } from './PluginTypes.ts';

export class PluginSettingsTab extends PluginSettingsTabBase<PluginTypes> {
  public override display(): void {
    super.display();
    this.containerEl.empty();

    new SettingEx(this.containerEl)
      .setName('Should replace invalid characters')
      .setDesc(createFragment((f) => {
        f.appendText('Whether to replace invalid characters in the title.');
        f.createEl('br');
        f.appendText('If disabled, the error will be shown for invalid titles.');
      }))
      .addToggle((toggle) => {
        this.bind(toggle, 'shouldReplaceInvalidTitleCharacters', {
          onChanged: () => {
            this.display();
          }
        });
      });

    new SettingEx(this.containerEl)
      .setName('Replacement string')
      .setDesc(createFragment((f) => {
        f.appendText('String to replace invalid characters with.');
        f.createEl('br');
        f.appendText('Leave blank to remove invalid characters.');
      }))
      .addText((text) => {
        this.bind(text, 'replacement', {
          shouldResetSettingWhenComponentIsEmpty: false
        });
        text.setDisabled(!this.plugin.settings.shouldReplaceInvalidTitleCharacters);
      });

    new SettingEx(this.containerEl)
      .setName('Should add invalid title to note aliases')
      .setDesc('Whether to add invalid title to the note alias.')
      .addToggle((toggle) => {
        this.bind(toggle, 'shouldAddInvalidTitleToNoteAlias');
      });

    new SettingEx(this.containerEl)
      .setName('Should add invalid title to frontmatter title key')
      .setDesc('Whether to add invalid title to the frontmatter title key.')
      .addToggle((toggle) => {
        this.bind(toggle, 'shouldAddInvalidTitleToFrontmatterTitleKey');
      });

    new SettingEx(this.containerEl)
      .setName('Should open note after merge')
      .setDesc('Whether to open the note after merge.')
      .addToggle((toggle) => {
        this.bind(toggle, 'shouldOpenNoteAfterMerge');
      });

    new SettingEx(this.containerEl)
      .setName('Should include frontmatter when splitting by default')
      .setDesc('Whether to include frontmatter when splitting by default.')
      .addToggle((toggle) => {
        this.bind(toggle, 'shouldIncludeFrontmatterWhenSplittingByDefault');
      });

    new SettingEx(this.containerEl)
      .setName('Should treat title as path by default')
      .setDesc('Whether to treat title as path by default.')
      .addToggle((toggle) => {
        this.bind(toggle, 'shouldTreatTitleAsPathByDefault');
      });

    new SettingEx(this.containerEl)
      .setName('Should fix footnotes by default')
      .setDesc('Whether to fix footnotes by default.')
      .addToggle((toggle) => {
        this.bind(toggle, 'shouldFixFootnotesByDefault');
      });

    new SettingEx(this.containerEl)
      .setName('Should allow only current folder by default')
      .setDesc('Whether to allow only current folder by default.')
      .addToggle((toggle) => {
        this.bind(toggle, 'shouldAllowOnlyCurrentFolderByDefault');
      });

    new SettingEx(this.containerEl)
      .setName('Should hide core plugin menu items')
      .setDesc(createFragment((f) => {
        f.appendText('Whether to hide core ');
        appendCodeBlock(f, 'Note Composer');
        f.appendText(' plugin menu items.');
        f.createEl('br');
        f.appendText('If disabled, the core plugin menu items will be shown together with the corresponding ');
        appendCodeBlock(f, 'Advanced Note Composer');
        f.appendText(' plugin menu items.');
      }))
      .addToggle((toggle) => {
        this.bind(toggle, 'shouldHideCorePluginMenuItems');
      });

    new SettingEx(this.containerEl)
      .setName('Should merge headings by default')
      .setDesc('Whether to merge headings by default.')
      .addToggle((toggle) => {
        this.bind(toggle, 'shouldMergeHeadingsByDefault');
      });
  }
}
