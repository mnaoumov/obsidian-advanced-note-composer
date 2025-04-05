import type { MaybeReturn } from 'obsidian-dev-utils/Type';

import { PluginSettingsManagerBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginSettingsManagerBase';

import { INVALID_CHARACTERS_REG_EXP } from './FilenameValidation.ts';
import { PluginSettings } from './PluginSettings.ts';

export class PluginSettingsManager extends PluginSettingsManagerBase<PluginSettings> {
  protected override addValidators(): void {
    this.addValidator('replacement', (value): MaybeReturn<string> => {
      if (INVALID_CHARACTERS_REG_EXP.test(value) || value === '/') {
        return 'Invalid replacement string';
      }
    });
  }

  protected override createDefaultSettings(): PluginSettings {
    return new PluginSettings();
  }
}
