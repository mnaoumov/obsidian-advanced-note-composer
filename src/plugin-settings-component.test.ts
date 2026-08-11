import type { AsyncEventRef } from 'obsidian-dev-utils/async-events';
import type { DataHandler } from 'obsidian-dev-utils/obsidian/data-handler';
import type { PluginEventSource } from 'obsidian-dev-utils/obsidian/plugin/plugin-event-source';
import type { GenericObject } from 'obsidian-dev-utils/type-guards';

import { noopAsync } from 'obsidian-dev-utils/function';
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

/**
 * Loads a component whose `data.json` is the given record through the REAL load path
 * (`loadWithPromises` → `onloadAsync` → `loadFromFile`) rather than the converters alone — which is what
 * proves a migrated key is actually a recognized plugin setting and survives into `component.settings`.
 *
 * @param record - The persisted record to load.
 * @returns The loaded component.
 */
async function loadComponentFromRecord(record: GenericObject): Promise<TestablePluginSettingsComponent> {
  const component = new TestablePluginSettingsComponent({
    dataHandler: strictProxy<DataHandler>({
      loadData: () => Promise.resolve(record),
      saveData: noopAsync
    }),
    pluginEventSource: strictProxy<PluginEventSource>({
      on: () => strictProxy<AsyncEventRef>({})
    })
  });
  await component.loadWithPromises();
  return component;
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
    // The command-visibility filter (issue #198) takes the same entry forms and so shares the validator.
    describe.each(['commandExcludePaths', 'commandIncludePaths', 'excludePaths', 'includePaths'] as const)('%s validator', (propertyName) => {
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

    // Issue #198. The old toggle made command blocking borrow the content filter's lists; the new
    // Command-visibility filter has its own, so an upgraded vault has to be seeded from the old ones.
    it('should seed both command path lists from the old lists when blocking was on', async () => {
      const component = createComponent();
      const legacySettings: GenericObject = {
        excludePaths: ['secret'],
        includePaths: ['allowed'],
        shouldBlockCommandsOnExcludedPaths: true
      };
      await component.runLegacyConverters(legacySettings);
      expect(legacySettings['commandExcludePaths']).toEqual(['secret']);
      // The include half matters: the old blocking fired on `isPathIgnored`, which already accounted for
      // `includePaths`, so copying only the exclude half would un-block everything outside the include list.
      expect(legacySettings['commandIncludePaths']).toEqual(['allowed']);
      expect(legacySettings['shouldBlockCommandsOnExcludedPaths']).toBeUndefined();
    });

    it('should seed empty command path lists when blocking was on with no paths configured', async () => {
      const component = createComponent();
      const legacySettings: GenericObject = { shouldBlockCommandsOnExcludedPaths: true };
      await component.runLegacyConverters(legacySettings);
      expect(legacySettings['commandExcludePaths']).toEqual([]);
      expect(legacySettings['commandIncludePaths']).toEqual([]);
    });

    it('should leave the command path lists alone when blocking was off', async () => {
      const component = createComponent();
      const legacySettings: GenericObject = {
        excludePaths: ['secret'],
        shouldBlockCommandsOnExcludedPaths: false
      };
      await component.runLegacyConverters(legacySettings);
      expect(legacySettings['commandExcludePaths']).toBeUndefined();
      expect(legacySettings['commandIncludePaths']).toBeUndefined();
      expect(legacySettings['shouldBlockCommandsOnExcludedPaths']).toBeUndefined();
      // The content filter is untouched — the split does not change what is excluded from merges/splits.
      expect(legacySettings['excludePaths']).toEqual(['secret']);
    });

    it('should not set the command path lists when the toggle was never persisted', async () => {
      const component = createComponent();
      const legacySettings: GenericObject = {};
      await component.runLegacyConverters(legacySettings);
      expect(legacySettings['commandExcludePaths']).toBeUndefined();
      expect(legacySettings['commandIncludePaths']).toBeUndefined();
    });

    // Driving the REAL load pipeline, not just the converters: this is what proves the migrated keys are
    // Recognized plugin settings that survive into `component.settings` — the accessor pairs added for
    // Issue #198 would be silently dropped if the base did not enumerate them.
    it('should carry a pre-#198 data.json through a real load with its blocking behavior intact', async () => {
      const component = await loadComponentFromRecord({
        excludePaths: ['secret'],
        shouldBlockCommandsOnExcludedPaths: true
      });

      expect(component.settings.commandExcludePaths).toEqual(['secret']);
      // The behavior the upgraded user had before: commands hidden on the excluded path, and only there.
      expect(component.settings.shouldBlockCommandOnPath('secret/note.md')).toBe(true);
      expect(component.settings.shouldBlockCommandOnPath('public/note.md')).toBe(false);
      // The content filter is untouched by the migration.
      expect(component.settings.excludePaths).toEqual(['secret']);
    });

    it('should leave a pre-#198 data.json with blocking off offering commands everywhere', async () => {
      const component = await loadComponentFromRecord({
        excludePaths: ['secret'],
        shouldBlockCommandsOnExcludedPaths: false
      });

      expect(component.settings.commandExcludePaths).toEqual([]);
      expect(component.settings.commandIncludePaths).toEqual([]);
      expect(component.settings.shouldBlockCommandOnPath('secret/note.md')).toBe(false);
      expect(component.settings.isPathIgnored('secret/note.md')).toBe(true);
    });
  });

  describe('reorder validators (issue #216)', () => {
    describe('reorderedFolderNameTemplate validator', () => {
      it('should accept the default template', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'reorderedFolderNameTemplate', '{{index}}. {{safeFolderName}}')).toBeUndefined();
      });

      it('should accept a template that pads the index and puts it last', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'reorderedFolderNameTemplate', '{{safeFolderName}} ({{index:000}})')).toBeUndefined();
      });

      it('should reject an empty template', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'reorderedFolderNameTemplate', '  ')).toBe('Folder name template should not be empty');
      });

      it('should reject a template with no index, which could not renumber anything', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'reorderedFolderNameTemplate', '{{safeFolderName}}'))
          .toBe('Folder name template should contain {{index}}, which is the number a reorder rewrites');
      });

      it('should reject a template that never names the folder, which would drop the name', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'reorderedFolderNameTemplate', '{{index}}. {{parentFolder}}'))
          .toBe('Folder name template should contain {{safeFolderName}}, or renumbering would drop the name');
      });

      it('should reject the token this template itself produces', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'reorderedFolderNameTemplate', '{{index}}. {{folderName}}'))
          .toBe('{{folderName}} cannot be used here, because this template IS the name');
      });

      it('should reject the typed name, which a reorder never has', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'reorderedFolderNameTemplate', '{{index}}. {{rawFolderName}}'))
          .toBe('{{rawFolderName}} cannot be used here, because this template IS the name');
      });

      it('should reject an unknown token', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'reorderedFolderNameTemplate', '{{index}}. {{safeFolderName}} {{nope}}'))
          .toBe('Unknown token {{nope}}');
      });

      it('should reject a name that could not be a single folder name', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'reorderedFolderNameTemplate', '{{index}}/{{safeFolderName}}')).toBe('Invalid folder name');
      });
    });

    describe('reorderedFileNameTemplate validator', () => {
      it('should accept the default template', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'reorderedFileNameTemplate', '{{index}}. {{safeName}}')).toBeUndefined();
      });

      it('should reject a template with no index', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'reorderedFileNameTemplate', '{{safeName}}'))
          .toBe('File name template should contain {{index}}, which is the number a reorder rewrites');
      });

      it('should reject a template that never names the file', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'reorderedFileNameTemplate', '{{index}}. {{parentFolder}}'))
          .toBe('File name template should contain {{safeName}}, or renumbering would drop the name');
      });

      it('should reject the token this template itself produces', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'reorderedFileNameTemplate', '{{index}}. {{name}}'))
          .toBe('{{name}} cannot be used here, because this template IS the name');
      });

      it('should reject an unknown token', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'reorderedFileNameTemplate', '{{index}}. {{safeName}} {{nope}}')).toBe('Unknown token {{nope}}');
      });
    });

    describe('folderNoteTitleTemplate validator', () => {
      it('should accept the default template', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'folderNoteTitleTemplate', '{{folderName}}')).toBeUndefined();
      });

      it('should accept an empty template, which is how the property is left alone', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'folderNoteTitleTemplate', '')).toBeUndefined();
      });

      it('should accept a title that is not a valid file name, a title being no such thing', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'folderNoteTitleTemplate', '{{parentFolder}}: {{folderName}}')).toBeUndefined();
      });

      it('should reject the typed name, which a reorder never has', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'folderNoteTitleTemplate', '{{rawFolderName}}'))
          .toBe('{{rawFolderName}} cannot be used here, because a reorder has no typed name');
      });

      it('should reject an unknown token', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'folderNoteTitleTemplate', '{{nope}}')).toBe('Unknown token {{nope}}');
      });
    });

    describe('reorderedFileTitleTemplate validator', () => {
      it('should accept an empty template, which is the default and leaves the property alone', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'reorderedFileTitleTemplate', '')).toBeUndefined();
      });

      it('should accept the new basename with its index', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'reorderedFileTitleTemplate', '{{name}}')).toBeUndefined();
      });

      it('should reject an unknown token', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'reorderedFileTitleTemplate', '{{nope}}')).toBe('Unknown token {{nope}}');
      });
    });

    describe('folderNoteNameTemplate validator', () => {
      it('should accept a note named after its folder', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'folderNoteNameTemplate', '{{folderName}}')).toBeUndefined();
      });

      it('should reject a name spanning folders', async () => {
        const component = createComponent();
        expect(await validateProperty(component, 'folderNoteNameTemplate', 'notes/{{folderName}}')).toBe('Invalid note name');
      });
    });
  });
});
