import type { DataHandler } from 'obsidian-dev-utils/obsidian/data-handler';
import type { PluginEventSource } from 'obsidian-dev-utils/obsidian/plugin/plugin-event-source';
import type { MaybeReturn } from 'obsidian-dev-utils/type';

import { PluginSettingsComponentBase } from 'obsidian-dev-utils/obsidian/components/plugin-settings-component';
import { pathsValidator } from 'obsidian-dev-utils/obsidian/path-settings';

import { INVALID_CHARACTERS_REG_EXP } from './filename-validation.ts';
import {
  FrontmatterTitleMode,
  PluginSettings
} from './plugin-settings.ts';
import { TEMPLATE_TOKEN_REG_EXP } from './template-tokens.ts';

interface PluginSettingsComponentConstructorParams {
  readonly dataHandler: DataHandler;
  readonly pluginEventSource: PluginEventSource;
}

/* v8 ignore start -- LegacySettings is only instantiated during legacy settings migration. */
class LegacySettings {
  public markdownAttachmentSubExtensions: string[] = [];
  public shouldAddInvalidTitleToFrontmatterTitleKey = true;
}
/* v8 ignore stop */

export class PluginSettingsComponent extends PluginSettingsComponentBase<PluginSettings> {
  public constructor(params: PluginSettingsComponentConstructorParams) {
    super({
      ...params,
      pluginSettingsClass: PluginSettings
    });
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

      // `markdownAttachmentSubExtensions` configured invented SUB-extensions matched against the base
      // Name of a markdown file, so `excalidraw` meant exactly `*.excalidraw.md`. Its successor
      // `attachmentExtensions` configures REAL extensions matched against the whole name, which is what
      // `obsidian-dev-utils` `isTreatedAsAttachment` takes. Appending `.md` is therefore the faithful
      // Conversion — and the migration is mandatory rather than cosmetic, because a bare `excalidraw`
      // Survives the shared predicate's normalization only to match nothing at all.
      if (legacySettings.markdownAttachmentSubExtensions !== undefined) {
        legacySettings.attachmentExtensions = legacySettings.markdownAttachmentSubExtensions
          .map((subExtension) => subExtension.trim().replace(/^\.+/, ''))
          .filter((subExtension) => subExtension !== '')
          .map((subExtension) => `.${subExtension}.md`);
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

    this.registerValidator('smartCutAndPasteTemplate', (value): MaybeReturn<string> => {
      if (value && !value.includes('{{content}}')) {
        return 'Smart cut & paste template should contain {{content}} token';
      }
    });

    this.registerValidator('smartCutAndPasteToTopTemplate', (value): MaybeReturn<string> => {
      if (value && !value.includes('{{content}}')) {
        return 'Smart cut & paste (to top of file) template should contain {{content}} token';
      }
    });

    this.registerValidator('smartCutAndPasteToBottomTemplate', (value): MaybeReturn<string> => {
      if (value && !value.includes('{{content}}')) {
        return 'Smart cut & paste (to bottom of file) template should contain {{content}} token';
      }
    });

    this.registerValidator('splitIntoFolderNoteNameTemplate', validateNoteNameTemplate);
    this.registerValidator('mergeFolderIntoFileNoteNameTemplate', validateNoteNameTemplate);

    // An un-parseable `/regular expression/` entry no longer throws from the setter (obsidian-dev-utils
    // 88.4.0, issue #155) — the whole list quietly falls back to its default pattern instead. Without a
    // Validator that fallback is invisible, so a single broken entry would silently stop the other
    // Entries from matching. The validator is the ODU export, not a local copy.
    this.registerValidator('includePaths', pathsValidator);
    this.registerValidator('excludePaths', pathsValidator);
  }
}

/**
 * Validates a template that names a NOTE (rather than formatting its content): it must not carry
 * `{{content}}`, and its literal text must be usable as a single file-name segment. Shared by
 * `splitIntoFolderNoteNameTemplate` (issue #153) and `mergeFolderIntoFileNoteNameTemplate` (issue #160),
 * which have exactly the same constraints.
 *
 * @param value - The template as typed.
 * @returns The error message, or nothing when the template is valid.
 */
function validateNoteNameTemplate(value: string): MaybeReturn<string> {
  if (!value) {
    return;
  }

  if (value.includes('{{content}}')) {
    return 'Note name should not contain {{content}} token';
  }

  // Only the literal text is checked: what a token expands to is sanitized when the note is created.
  const literal = value.replaceAll(TEMPLATE_TOKEN_REG_EXP, '');
  if (literal.includes('/') || new RegExp(INVALID_CHARACTERS_REG_EXP.source).test(literal)) {
    return 'Invalid note name';
  }
}
