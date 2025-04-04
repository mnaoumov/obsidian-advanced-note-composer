import { PluginSettingsTabBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginSettingsTabBase';
import { SettingEx } from 'obsidian-dev-utils/obsidian/SettingEx';

import type { AdvancedNoteComposerPlugin } from './AdvancedNoteComposerPlugin.ts';

import { INVALID_CHARACTERS_REG_EXP } from './FilenameValidation.ts';

export class AdvancedNoteComposerPluginSettingsTab extends PluginSettingsTabBase<AdvancedNoteComposerPlugin> {
  public override display(): void {
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
        f.appendText('Leave empty to remove invalid characters.');
      }))
      .addText((text) => {
        this.bind(text, 'replacement', {
          // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
          valueValidator: (value): string | void => {
            if (INVALID_CHARACTERS_REG_EXP.test(value) || value === '/') {
              return 'Invalid replacement string';
            }
          }
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
  }
}
