import { PluginSettingsTabBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginSettingsTabBase';
import { SettingEx } from 'obsidian-dev-utils/obsidian/SettingEx';

import type { PluginTypes } from './PluginTypes.ts';

export class PluginSettingsTab extends PluginSettingsTabBase<PluginTypes> {
  public override display(): void {
    super.display();
    this.containerEl.empty();

    new SettingEx(this.containerEl)
      .setName('Replace invalid characters')
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
      .setName('Add invalid title to note aliases')
      .setDesc('Whether to add invalid title to the note alias.')
      .addToggle((toggle) => {
        this.bind(toggle, 'shouldAddInvalidTitleToNoteAlias');
      });

    new SettingEx(this.containerEl)
      .setName('Add invalid title to frontmatter title key')
      .setDesc('Whether to add invalid title to the frontmatter title key.')
      .addToggle((toggle) => {
        this.bind(toggle, 'shouldAddInvalidTitleToFrontmatterTitleKey');
      });

    new SettingEx(this.containerEl)
      .setName('Open note after merge')
      .setDesc('Whether to open the note after merge.')
      .addToggle((toggle) => {
        this.bind(toggle, 'shouldOpenNoteAfterMerge');
      });
  }
}
