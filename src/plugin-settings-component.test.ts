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

    describe('nameTransformTemplate validator', () => {
      it('should accept an empty template', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'nameTransformTemplate', '')).toBeUndefined();
      });

      it('should accept the rawString token', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'nameTransformTemplate', 'Project {{rawString}}')).toBeUndefined();
      });

      it('should reject an unknown token', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'nameTransformTemplate', '{{folderName}}')).toBe('Unknown token {{folderName}}');
      });

      it('should accept literal text that is not a valid file name, since the result is sanitized afterwards', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'nameTransformTemplate', '{{rawString}}: extra')).toBeUndefined();
      });

      it('should accept templater syntax, which cannot be checked until it runs', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'nameTransformTemplate', '<% TOKENS.rawString.replaceAll(": ", " - ") %>')).toBeUndefined();
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

    describe('smartCutAndPasteTemplate validator', () => {
      it('should reject non-empty template without content token', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'smartCutAndPasteTemplate', 'no token here')).toBe('Smart cut & paste template should contain {{content}} token');
      });

      it('should accept template with content token', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'smartCutAndPasteTemplate', '{{content}}')).toBeUndefined();
      });

      it('should accept empty template', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'smartCutAndPasteTemplate', '')).toBeUndefined();
      });
    });

    describe('smartCutAndPasteToTopTemplate validator', () => {
      it('should reject non-empty template without content token', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'smartCutAndPasteToTopTemplate', 'no token here'))
          .toBe('Smart cut & paste (to top of file) template should contain {{content}} token');
      });

      it('should accept template with content token', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'smartCutAndPasteToTopTemplate', '{{content}}')).toBeUndefined();
      });

      it('should accept empty template, which means "use the shared template"', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'smartCutAndPasteToTopTemplate', '')).toBeUndefined();
      });
    });

    describe('smartCutAndPasteToBottomTemplate validator', () => {
      it('should reject non-empty template without content token', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'smartCutAndPasteToBottomTemplate', 'no token here'))
          .toBe('Smart cut & paste (to bottom of file) template should contain {{content}} token');
      });

      it('should accept template with content token', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'smartCutAndPasteToBottomTemplate', '{{content}}')).toBeUndefined();
      });

      it('should accept empty template, which means "use the shared template"', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'smartCutAndPasteToBottomTemplate', '')).toBeUndefined();
      });
    });

    describe('splitIntoFolderNoteNameTemplate validator', () => {
      it('should accept empty note name', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'splitIntoFolderNoteNameTemplate', '')).toBeUndefined();
      });

      it('should accept a constant note name', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'splitIntoFolderNoteNameTemplate', 'Overview')).toBeUndefined();
      });

      it('should accept a note name built from tokens', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'splitIntoFolderNoteNameTemplate', '{{newTitle}} index')).toBeUndefined();
      });

      it('should accept a token whose format contains characters invalid outside a token', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'splitIntoFolderNoteNameTemplate', '{{date:YYYY/MM}}')).toBeUndefined();
      });

      it('should reject the content token', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'splitIntoFolderNoteNameTemplate', 'Note {{content}}')).toBe('Note name should not contain {{content}} token');
      });

      it('should reject a note name spanning folders', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'splitIntoFolderNoteNameTemplate', 'Notes/Overview')).toBe('Invalid note name');
      });

      it('should reject a note name with characters invalid in a file name', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'splitIntoFolderNoteNameTemplate', 'Over:view')).toBe('Invalid note name');
      });
    });

    describe('mergeFolderIntoFileNoteNameTemplate validator', () => {
      it('should accept empty note name', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'mergeFolderIntoFileNoteNameTemplate', '')).toBeUndefined();
      });

      it('should accept a note name built from folder tokens', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'mergeFolderIntoFileNoteNameTemplate', '{{folderName}} summary')).toBeUndefined();
      });

      it('should reject the content token', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'mergeFolderIntoFileNoteNameTemplate', 'Note {{content}}')).toBe('Note name should not contain {{content}} token');
      });

      it('should reject a note name spanning folders', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'mergeFolderIntoFileNoteNameTemplate', 'Notes/Summary')).toBe('Invalid note name');
      });

      it('should reject a note name with characters invalid in a file name', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'mergeFolderIntoFileNoteNameTemplate', 'Sum:mary')).toBe('Invalid note name');
      });
    });

    describe('newFolderNameTemplate validator', () => {
      it('should accept the default template', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'newFolderNameTemplate', '{{index}}. {{safeFolderName}}')).toBeUndefined();
      });

      it('should accept a template with no index token, which simply does not number', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'newFolderNameTemplate', '{{safeFolderName}}')).toBeUndefined();
      });

      it('should accept a date token', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'newFolderNameTemplate', '{{date:YYYY}} {{safeFolderName}}')).toBeUndefined();
      });

      it('should reject an empty template', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'newFolderNameTemplate', '')).toBe('Folder name template should not be empty');
      });

      it('should reject a whitespace-only template', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'newFolderNameTemplate', ' '.repeat(3))).toBe('Folder name template should not be empty');
      });

      it('should reject the folder name token, which this template IS', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'newFolderNameTemplate', '{{folderName}}'))
          .toBe('{{folderName}} cannot be used here, because this template IS the folder name');
      });

      it('should reject the folder path token for the same reason', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'newFolderNameTemplate', '{{folderPath}}'))
          .toBe('{{folderPath}} cannot be used here, because this template IS the folder name');
      });

      it('should reject an unknown token', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'newFolderNameTemplate', '{{nope}}')).toBe('Unknown token {{nope}}');
      });

      it('should reject a template spanning folders', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'newFolderNameTemplate', 'a/{{safeFolderName}}')).toBe('Invalid folder name');
      });

      it('should reject literal characters invalid in a file name', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'newFolderNameTemplate', '{{safeFolderName}}:x')).toBe('Invalid folder name');
      });
    });

    describe('newFolderContentTemplate validator', () => {
      it('should accept an empty template', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'newFolderContentTemplate', '')).toBeUndefined();
      });

      it('should accept the reporter\'s two-note layout', async () => {
        const component = createComponent();
        const template = '{{file}} !.md\n---\ntitle: "{{folderName}}"\n---\n{{file}} {{safeFolderName}}.md\n# {{folderName}}';
        expect(await validateProperty(component, 'newFolderContentTemplate', template)).toBeUndefined();
      });

      it('should not report the file marker itself as an unknown token', async () => {
        // It is parsed out as a marker before any token is resolved.
        const component = createComponent();
        expect(await validateProperty(component, 'newFolderContentTemplate', '{{file}} a.md\nbody')).toBeUndefined();
      });

      it('should reject an unknown token in a note name', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'newFolderContentTemplate', '{{file}} {{nope}}.md\nbody'))
          .toBe('Unknown token {{nope}} in a note name');
      });

      it('should reject an unknown token in a note body', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'newFolderContentTemplate', '{{file}} a.md\n{{nope}}')).toBe('Unknown token {{nope}}');
      });

      it('should reject a note name spanning folders', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'newFolderContentTemplate', '{{file}} sub/a.md\nbody'))
          .toBe('Invalid note name: sub/a.md');
      });
    });

    // Issue #155. The message is obsidian-dev-utils' own i18n string, asserted verbatim so an upstream
    // Wording change fails here instead of silently degrading the setting's feedback.
    describe.each(['excludePaths', 'includePaths'] as const)('%s validator', (propertyName) => {
      it('should accept an empty list', async () => {
        const component = createComponent();
        expect(await validateProperty(component, propertyName, [])).toBeUndefined();
      });

      it('should accept a plain path', async () => {
        const component = createComponent();
        expect(await validateProperty(component, propertyName, ['Inbox'])).toBeUndefined();
      });

      it('should accept a valid regular expression literal', async () => {
        const component = createComponent();
        expect(await validateProperty(component, propertyName, [String.raw`/^Inbox\/[^\/]*$/`])).toBeUndefined();
      });

      it('should reject an un-parseable regular expression literal', async () => {
        const component = createComponent();
        expect(await validateProperty(component, propertyName, [String.raw`/^Inbox\/`])).toBe(String.raw`Invalid regular expression: /^Inbox\/`);
      });

      it('should report the first invalid entry of a mixed list', async () => {
        const component = createComponent();
        expect(await validateProperty(component, propertyName, ['Inbox', '/^Archive[/', '/^Drafts(/'])).toBe('Invalid regular expression: /^Archive[/');
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

    it('should convert markdownAttachmentSubExtensions to attachmentExtensions', async () => {
      const component = createComponent();
      const legacySettings: GenericObject = { markdownAttachmentSubExtensions: ['excalidraw'] };
      await component.runLegacyConverters(legacySettings);
      expect(legacySettings['attachmentExtensions']).toEqual(['.excalidraw.md']);
      expect(legacySettings['markdownAttachmentSubExtensions']).toBeUndefined();
    });

    it('should normalize a leading dot and surrounding spaces when converting a sub-extension', async () => {
      const component = createComponent();
      const legacySettings: GenericObject = { markdownAttachmentSubExtensions: ['  .excalidraw ', 'drawio'] };
      await component.runLegacyConverters(legacySettings);
      expect(legacySettings['attachmentExtensions']).toEqual(['.excalidraw.md', '.drawio.md']);
    });

    it('should drop a blank sub-extension when converting', async () => {
      const component = createComponent();
      const legacySettings: GenericObject = { markdownAttachmentSubExtensions: ['', ' '.repeat(3), '...'] };
      await component.runLegacyConverters(legacySettings);
      expect(legacySettings['attachmentExtensions']).toEqual([]);
    });

    it('should not set attachmentExtensions when markdownAttachmentSubExtensions is undefined', async () => {
      const component = createComponent();
      const legacySettings: GenericObject = {};
      await component.runLegacyConverters(legacySettings);
      expect(legacySettings['attachmentExtensions']).toBeUndefined();
    });
  });
});
