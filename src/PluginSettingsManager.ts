import type { MaybeReturn } from 'obsidian-dev-utils/Type';

import { PluginSettingsManagerBase } from 'obsidian-dev-utils/obsidian/Plugin/PluginSettingsManagerBase';

import type { PluginTypes } from './PluginTypes.ts';

import { INVALID_CHARACTERS_REG_EXP } from './FilenameValidation.ts';
import { PluginSettings } from './PluginSettings.ts';

export class PluginSettingsManager extends PluginSettingsManagerBase<PluginTypes> {
  protected override createDefaultSettings(): PluginSettings {
    return new PluginSettings();
  }

  protected override registerLegacySettingsConverters(): void {
    this.registerLegacySettingsConverter(PluginSettings, (legacySettings) => {
      if (!legacySettings.mergeTemplate?.includes('{{content}}')) {
        legacySettings.mergeTemplate ??= '';
        legacySettings.mergeTemplate += '\n\n{{content}}';
      }
    });
  }

  protected override registerValidators(): void {
    this.registerValidator('replacement', (value): MaybeReturn<string> => {
      if (INVALID_CHARACTERS_REG_EXP.test(value) || value === '/') {
        return 'Invalid replacement string';
      }
    });

    this.registerValidator('mergeTemplate', (value): MaybeReturn<string> => {
      if (!value.includes('{{content}}')) {
        return 'Merge template should contain {{content}} token';
      }
    });

    this.registerValidator('splitTemplate', (value): MaybeReturn<string> => {
      if (value && !value.includes('{{content}}')) {
        return 'Split template should contain {{content}} token';
      }
    });
  }
}
