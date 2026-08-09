import type { DataHandler } from 'obsidian-dev-utils/obsidian/data-handler';
import type { PluginEventSource } from 'obsidian-dev-utils/obsidian/plugin/plugin-event-source';
import type { MaybeReturn } from 'obsidian-dev-utils/type';

import { PluginSettingsComponentBase } from 'obsidian-dev-utils/obsidian/components/plugin-settings-component';
import { pathsValidator } from 'obsidian-dev-utils/obsidian/path-settings';

import type {
  CreateFolderTemplateTokens,
  NameTransformTokens
} from './template-tokens.ts';

import { INVALID_CHARACTERS_REG_EXP } from './filename-validation.ts';
import { parseFolderContentTemplate } from './folder-content-template.ts';
import {
  FrontmatterTitleMode,
  PluginSettings
} from './plugin-settings.ts';
import {
  getTemplateTokenKeys,
  resolveCreateFolderTemplateTokens,
  resolveNameTransformTokens,
  TEMPLATE_TOKEN_REG_EXP
} from './template-tokens.ts';

/**
 * Token keys that only mean something once the folder EXISTS, so they cannot appear in the template that
 * names it — that template is what produces them.
 */
const FOLDER_ONLY_TOKEN_KEYS = new Set(['folderName'.toLowerCase(), 'folderPath'.toLowerCase()]);

/**
 * Stand-in values for validating a create-folder template without creating anything. Only their shape
 * matters: the point is to make the resolver run so an unknown token key throws where the user can see it,
 * rather than at the moment they invoke the command.
 */
const SAMPLE_CREATE_FOLDER_TOKENS: CreateFolderTemplateTokens = {
  folderName: '1. Sample',
  folderPath: 'Parent/1. Sample',
  index: 1,
  parentFolder: 'Parent',
  parentFolderPath: 'Parent',
  rawFolderName: 'sample',
  safeFolderName: 'Sample'
};

/**
 * Stand-in value for validating a `nameTransformTemplate` without a name to transform. As with
 * {@link SAMPLE_CREATE_FOLDER_TOKENS}, only its shape matters — the point is to make the resolver run.
 */
const SAMPLE_NAME_TRANSFORM_TOKENS: NameTransformTokens = { rawString: 'Sample' };

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
      if (legacySettings.mergeTemplate?.includes('{{content}}')) {
        return;
      }

      legacySettings.mergeTemplate ??= '';
      legacySettings.mergeTemplate += '\n\n{{content}}';
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

    // Only the token keys are checked. There is deliberately NO invalid-character check on the literal
    // Text, unlike every other name-shaped template here: emitting a `:` or a ` - ` is the entire point of
    // A transform, and whatever it leaves invalid is answered downstream by
    // `shouldReplaceInvalidTitleCharacters`. Templater syntax cannot be validated statically at all — a
    // Broken template surfaces when it runs, in the prompt that refuses the name.
    this.registerValidator('nameTransformTemplate', (value): MaybeReturn<string> => {
      const unknownKey = findUnknownTokenKey(value, (probe) => {
        resolveNameTransformTokens({ template: probe, tokens: SAMPLE_NAME_TRANSFORM_TOKENS });
      });
      if (unknownKey) {
        return `Unknown token {{${unknownKey}}}`;
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

    this.registerValidator('newFolderNameTemplate', validateCreateFolderNameTemplate);
    this.registerValidator('newFolderContentTemplate', validateCreateFolderContentTemplate);

    // An un-parseable `/regular expression/` entry no longer throws from the setter (obsidian-dev-utils
    // 88.4.0, issue #155) — the whole list quietly falls back to its default pattern instead. Without a
    // Validator that fallback is invisible, so a single broken entry would silently stop the other
    // Entries from matching. The validator is the ODU export, not a local copy.
    this.registerValidator('includePaths', pathsValidator);
    this.registerValidator('excludePaths', pathsValidator);
  }
}

/**
 * Reports the first token key the create-folder resolver does not know.
 *
 * @param template - The template to check.
 * @returns The unknown key, or `undefined` when every token resolves.
 */
function findUnknownCreateFolderTokenKey(template: string): string | undefined {
  return findUnknownTokenKey(template, (probe) => {
    resolveCreateFolderTemplateTokens({ template: probe, tokens: SAMPLE_CREATE_FOLDER_TOKENS });
  });
}

/**
 * Reports the first token key a resolver does not know.
 *
 * Each key is probed on its own rather than the whole template being resolved once, so the message can name
 * the offending token. Probing THROUGH the resolver — instead of comparing against a hard-coded key list —
 * is what keeps this from drifting the day a token is added, and taking the resolver as a parameter is what
 * lets each template vocabulary reuse it (issue #196 added the second one).
 *
 * @param template - The template to check.
 * @param resolveToken - Resolves a single `{{key}}` probe, throwing when the key is unknown.
 * @returns The unknown key, or `undefined` when every token resolves.
 */
function findUnknownTokenKey(template: string, resolveToken: (probe: string) => void): string | undefined {
  for (const key of getTemplateTokenKeys(template)) {
    try {
      resolveToken(`{{${key}}}`);
    } catch {
      return key;
    }
  }

  return undefined;
}

/**
 * Whether the template's own LITERAL text (tokens removed) can be part of a single file-name segment. What a
 * token expands to is sanitized when the note is created, so only the literal is the user's problem here.
 *
 * @param template - The template to check.
 * @returns `true` when the literal text is usable.
 */
function hasValidFileNameLiteral(template: string): boolean {
  const literal = template.replaceAll(TEMPLATE_TOKEN_REG_EXP, '');
  return !literal.includes('/') && !new RegExp(INVALID_CHARACTERS_REG_EXP.source).test(literal);
}

/**
 * Validates the `newFolderContentTemplate` setting (issue #191) the same way the command reads it: parse
 * the `{{file}}` markers first, then check each declared note's name and content templates. Parsing first is
 * what keeps `{{file}}` from being reported as an unknown token — it is a marker, not a value.
 *
 * @param value - The template as typed.
 * @returns The error message, or nothing when the template is valid.
 */
function validateCreateFolderContentTemplate(value: string): MaybeReturn<string> {
  for (const section of parseFolderContentTemplate(value)) {
    const unknownNameKey = findUnknownCreateFolderTokenKey(section.nameTemplate);
    if (unknownNameKey) {
      return `Unknown token {{${unknownNameKey}}} in a note name`;
    }

    if (!hasValidFileNameLiteral(section.nameTemplate)) {
      return `Invalid note name: ${section.nameTemplate}`;
    }

    const unknownContentKey = findUnknownCreateFolderTokenKey(section.contentTemplate);
    if (unknownContentKey) {
      return `Unknown token {{${unknownContentKey}}}`;
    }
  }
}

/**
 * Validates the `newFolderNameTemplate` setting (issue #191).
 *
 * Beyond the usual file-name rules it rejects `{{folderName}}` / `{{folderPath}}`, which resolve perfectly
 * well and would still be wrong: this template IS the folder name, so those tokens have nothing to resolve
 * against yet and would silently render as nothing.
 *
 * @param value - The template as typed.
 * @returns The error message, or nothing when the template is valid.
 */
function validateCreateFolderNameTemplate(value: string): MaybeReturn<string> {
  if (!value.trim()) {
    return 'Folder name template should not be empty';
  }

  const folderOnlyKey = getTemplateTokenKeys(value).find((key) => FOLDER_ONLY_TOKEN_KEYS.has(key.toLowerCase()));
  if (folderOnlyKey) {
    return `{{${folderOnlyKey}}} cannot be used here, because this template IS the folder name`;
  }

  const unknownKey = findUnknownCreateFolderTokenKey(value);
  if (unknownKey) {
    return `Unknown token {{${unknownKey}}}`;
  }

  if (!hasValidFileNameLiteral(value)) {
    return 'Invalid folder name';
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
  if (!hasValidFileNameLiteral(value)) {
    return 'Invalid note name';
  }
}
