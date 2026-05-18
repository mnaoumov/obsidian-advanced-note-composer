import type { MaybeReturn } from 'obsidian-dev-utils/type';

import { PluginSettingsComponentBase } from 'obsidian-dev-utils/obsidian/components/plugin-settings-component';

import { INVALID_CHARACTERS_REG_EXP } from './filename-validation.ts';
import {
  FrontmatterTitleMode,
  PluginSettings
} from './plugin-settings.ts';

class LegacySettings {
  public shouldAddInvalidTitleToFrontmatterTitleKey = true;
}

export class PluginSettingsComponent extends PluginSettingsComponentBase<PluginSettings> {
  protected override createDefaultSettings(): PluginSettings {
    return new PluginSettings();
  }

  protected override registerLegacySettingsConverters(): void {
    super.registerLegacySettingsConverters();
    this.registerLegacySettingsConverter(PluginSettings, (legacySettings) => {
      if (!legacySettings.mergeTemplate?.includes('{{content}}')) {
        legacySettings.mergeTemplate ??= '';
        legacySettings.mergeTemplate += '\n\n{{content}}';
      }
    });

    this.registerLegacySettingsConverter(LegacySettings, (legacySettings) => {
      if (legacySettings.shouldAddInvalidTitleToFrontmatterTitleKey !== undefined) {
        legacySettings.frontmatterTitleMode = legacySettings.shouldAddInvalidTitleToFrontmatterTitleKey
          ? FrontmatterTitleMode.UseForInvalidTitleOnly
          : FrontmatterTitleMode.None;
      }
    });
  }

  protected override registerValidators(): void {
    super.registerValidators();
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
