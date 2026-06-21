import type { DataHandler } from 'obsidian-dev-utils/obsidian/data-handler';
import type { PluginEventSource } from 'obsidian-dev-utils/obsidian/plugin/plugin-event-source';
import type { GenericObject } from 'obsidian-dev-utils/type-guards';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it
} from 'vitest';

import { PluginSettingsComponent } from './plugin-settings-component.ts';
import { PluginSettings } from './plugin-settings.ts';

class TestablePluginSettingsComponent extends PluginSettingsComponent {
  public async runLegacyConverters(record: GenericObject): Promise<void> {
    await this.onLoadRecord(record);
  }
}

function createComponent(): TestablePluginSettingsComponent {
  return new TestablePluginSettingsComponent({
    dataHandler: strictProxy<DataHandler>({}),
    pluginEventSource: strictProxy<PluginEventSource>({})
  });
}

async function validateProperty<PropertyName extends keyof PluginSettings>(
  component: TestablePluginSettingsComponent,
  propertyName: PropertyName,
  value: PluginSettings[PropertyName]
): Promise<string | undefined> {
  const settings = new PluginSettings();
  settings[propertyName] = value;
  const result = await component.validate(settings);
  return result[propertyName];
}

describe('PluginSettingsComponent', () => {
  describe('validators', () => {
    describe('replacement validator', () => {
      it('should reject replacement containing invalid characters', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'replacement', '*')).toBe('Invalid replacement string');
      });

      it('should reject forward slash as replacement', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'replacement', '/')).toBe('Invalid replacement string');
      });

      it('should accept valid replacement string', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'replacement', '_')).toBeUndefined();
      });

      it('should accept empty replacement string', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'replacement', '')).toBeUndefined();
      });
    });

    describe('mergeTemplate validator', () => {
      it('should reject template without content token', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'mergeTemplate', 'no token here')).toBe('Merge template should contain {{content}} token');
      });

      it('should accept template with content token', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'mergeTemplate', '\n\n{{content}}')).toBeUndefined();
      });
    });

    describe('splitTemplate validator', () => {
      it('should reject non-empty template without content token', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'splitTemplate', 'no token here')).toBe('Split template should contain {{content}} token');
      });

      it('should accept template with content token', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'splitTemplate', '{{content}}')).toBeUndefined();
      });

      it('should accept empty template', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'splitTemplate', '')).toBeUndefined();
      });
    });
  });

  describe('legacy settings converters', () => {
    it('should add content token to merge template if missing', async () => {
      const component = createComponent();
      const legacySettings: GenericObject = { mergeTemplate: 'old template' };
      await component.runLegacyConverters(legacySettings);
      expect(legacySettings['mergeTemplate']).toBe('old template\n\n{{content}}');
    });

    it('should not modify merge template if content token exists', async () => {
      const component = createComponent();
      const legacySettings: GenericObject = { mergeTemplate: '{{content}} existing' };
      await component.runLegacyConverters(legacySettings);
      expect(legacySettings['mergeTemplate']).toBe('{{content}} existing');
    });

    it('should add content token to null merge template', async () => {
      const component = createComponent();
      const legacySettings: GenericObject = {};
      await component.runLegacyConverters(legacySettings);
      expect(legacySettings['mergeTemplate']).toBe('\n\n{{content}}');
    });

    it('should convert shouldAddInvalidTitleToFrontmatterTitleKey true to UseForInvalidTitleOnly', async () => {
      const component = createComponent();
      const legacySettings: GenericObject = { shouldAddInvalidTitleToFrontmatterTitleKey: true };
      await component.runLegacyConverters(legacySettings);
      expect(legacySettings['frontmatterTitleMode']).toBe('UseForInvalidTitleOnly');
    });

    it('should convert shouldAddInvalidTitleToFrontmatterTitleKey false to None', async () => {
      const component = createComponent();
      const legacySettings: GenericObject = { shouldAddInvalidTitleToFrontmatterTitleKey: false };
      await component.runLegacyConverters(legacySettings);
      expect(legacySettings['frontmatterTitleMode']).toBe('None');
    });

    it('should not modify settings when shouldAddInvalidTitleToFrontmatterTitleKey is undefined', async () => {
      const component = createComponent();
      const legacySettings: GenericObject = {};
      await component.runLegacyConverters(legacySettings);
      expect(legacySettings['frontmatterTitleMode']).toBeUndefined();
    });
  });
});
