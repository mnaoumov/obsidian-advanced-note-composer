import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { PluginSettingsComponent } from './plugin-settings-component.ts';

interface LegacySettingsConverterEntry {
  converter(settings: Record<string, unknown>): void;
  settingsClass: new () => unknown;
}

interface PluginSettingsClassParam<T> {
  pluginSettingsClass: new () => T;
}

interface PluginSettingsComponentPrototype {
  registerLegacySettingsConverters(this: PluginSettingsComponent): void;
  registerValidators(this: PluginSettingsComponent): void;
}

interface TestablePluginSettingsComponent extends PluginSettingsComponent {
  getLegacyConverters(): LegacySettingsConverterEntry[];
  getValidator(key: string): ((value: unknown) => string | undefined) | undefined;
}

vi.mock('obsidian-dev-utils/obsidian/components/plugin-settings-component', () => {
  class PluginSettingsComponentBase<T> {
    public settings: T;
    protected registeredLegacySettingsConverters: LegacySettingsConverterEntry[] = [];

    protected registeredValidators = new Map<string, (value: unknown) => string | undefined>();

    public constructor(params: PluginSettingsClassParam<T>) {
      this.settings = new params.pluginSettingsClass();
    }

    public getLegacyConverters(): LegacySettingsConverterEntry[] {
      return this.registeredLegacySettingsConverters;
    }

    public getValidator(key: string): ((value: unknown) => string | undefined) | undefined {
      return this.registeredValidators.get(key);
    }

    protected registerLegacySettingsConverter(settingsClass: new () => unknown, converter: (settings: Record<string, unknown>) => void): void {
      this.registeredLegacySettingsConverters.push({ converter, settingsClass });
    }

    protected registerLegacySettingsConverters(): void {
      // Base no-op
    }

    protected registerValidator(key: string, validator: (value: unknown) => string | undefined): void {
      this.registeredValidators.set(key, validator);
    }

    protected registerValidators(): void {
      // Base no-op
    }
  }

  return { PluginSettingsComponentBase };
});

function createComponent(): TestablePluginSettingsComponent {
  const component = new PluginSettingsComponent({
    dataHandler: {} as never,
    pluginEventSource: {} as never
  });

  // Trigger the protected methods that register validators and converters
  const proto = Object.getPrototypeOf(component) as PluginSettingsComponentPrototype;
  proto.registerValidators.call(component);
  proto.registerLegacySettingsConverters.call(component);

  return component as TestablePluginSettingsComponent;
}

describe('PluginSettingsComponent', () => {
  describe('validators', () => {
    describe('replacement validator', () => {
      it('should reject replacement containing invalid characters', () => {
        const component = createComponent();
        const validator = component.getValidator('replacement');
        expect(validator?.('*')).toBe('Invalid replacement string');
      });

      it('should reject forward slash as replacement', () => {
        const component = createComponent();
        const validator = component.getValidator('replacement');
        expect(validator?.('/')).toBe('Invalid replacement string');
      });

      it('should accept valid replacement string', () => {
        const component = createComponent();
        const validator = component.getValidator('replacement');
        expect(validator?.('_')).toBeUndefined();
      });

      it('should accept empty replacement string', () => {
        const component = createComponent();
        const validator = component.getValidator('replacement');
        expect(validator?.('')).toBeUndefined();
      });
    });

    describe('mergeTemplate validator', () => {
      it('should reject template without content token', () => {
        const component = createComponent();
        const validator = component.getValidator('mergeTemplate');
        expect(validator?.('no token here')).toBe('Merge template should contain {{content}} token');
      });

      it('should accept template with content token', () => {
        const component = createComponent();
        const validator = component.getValidator('mergeTemplate');
        expect(validator?.('\n\n{{content}}')).toBeUndefined();
      });
    });

    describe('splitTemplate validator', () => {
      it('should reject non-empty template without content token', () => {
        const component = createComponent();
        const validator = component.getValidator('splitTemplate');
        expect(validator?.('no token here')).toBe('Split template should contain {{content}} token');
      });

      it('should accept template with content token', () => {
        const component = createComponent();
        const validator = component.getValidator('splitTemplate');
        expect(validator?.('{{content}}')).toBeUndefined();
      });

      it('should accept empty template', () => {
        const component = createComponent();
        const validator = component.getValidator('splitTemplate');
        expect(validator?.('')).toBeUndefined();
      });
    });
  });

  describe('legacy settings converters', () => {
    it('should add content token to merge template if missing', () => {
      const component = createComponent();
      const converters = component.getLegacyConverters();
      const firstConverter = converters[0];
      expect(firstConverter).toBeDefined();

      const legacySettings = { mergeTemplate: 'old template' };
      firstConverter?.converter(legacySettings);
      expect(legacySettings.mergeTemplate).toBe('old template\n\n{{content}}');
    });

    it('should not modify merge template if content token exists', () => {
      const component = createComponent();
      const converters = component.getLegacyConverters();
      const firstConverter = converters[0];
      expect(firstConverter).toBeDefined();

      const legacySettings = { mergeTemplate: '{{content}} existing' };
      firstConverter?.converter(legacySettings);
      expect(legacySettings.mergeTemplate).toBe('{{content}} existing');
    });

    it('should add content token to null merge template', () => {
      const component = createComponent();
      const converters = component.getLegacyConverters();
      const firstConverter = converters[0];
      expect(firstConverter).toBeDefined();

      const legacySettings: Record<string, unknown> = {};
      firstConverter?.converter(legacySettings);
      expect(legacySettings['mergeTemplate']).toBe('\n\n{{content}}');
    });

    it('should convert shouldAddInvalidTitleToFrontmatterTitleKey true to UseForInvalidTitleOnly', () => {
      const component = createComponent();
      const converters = component.getLegacyConverters();
      const secondConverter = converters[1];
      expect(secondConverter).toBeDefined();

      const legacySettings: Record<string, unknown> = { shouldAddInvalidTitleToFrontmatterTitleKey: true };
      secondConverter?.converter(legacySettings);
      expect(legacySettings['frontmatterTitleMode']).toBe('UseForInvalidTitleOnly');
    });

    it('should convert shouldAddInvalidTitleToFrontmatterTitleKey false to None', () => {
      const component = createComponent();
      const converters = component.getLegacyConverters();
      const secondConverter = converters[1];
      expect(secondConverter).toBeDefined();

      const legacySettings: Record<string, unknown> = { shouldAddInvalidTitleToFrontmatterTitleKey: false };
      secondConverter?.converter(legacySettings);
      expect(legacySettings['frontmatterTitleMode']).toBe('None');
    });

    it('should not modify settings when shouldAddInvalidTitleToFrontmatterTitleKey is undefined', () => {
      const component = createComponent();
      const converters = component.getLegacyConverters();
      const secondConverter = converters[1];
      expect(secondConverter).toBeDefined();

      const legacySettings: Record<string, unknown> = {};
      secondConverter?.converter(legacySettings);
      expect(legacySettings['frontmatterTitleMode']).toBeUndefined();
    });
  });
});
