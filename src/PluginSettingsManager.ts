import { PluginSettingsManagerBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginSettingsManagerBase';

import { PluginSettings } from './PluginSettings.ts';
import { INVALID_CHARACTERS_REG_EXP } from './FilenameValidation.ts';
import type { MaybeReturn } from 'obsidian-dev-utils/Type';

export class PluginSettingsManager extends PluginSettingsManagerBase<PluginSettings> {
  protected override createDefaultSettings(): PluginSettings {
    return new PluginSettings();
  }

  protected override addValidators(): void {
    this.addValidator('replacement', (value): MaybeReturn<string> => {
      if (INVALID_CHARACTERS_REG_EXP.test(value) || value === '/') {
        return 'Invalid replacement string';
      }
    });
  }
}
