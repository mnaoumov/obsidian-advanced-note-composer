import type { DataHandler } from 'obsidian-dev-utils/obsidian/data-handler';
import type { PluginEventSource } from 'obsidian-dev-utils/obsidian/plugin/plugin-event-source';
import type { MaybeReturn } from 'obsidian-dev-utils/type';

import { PluginSettingsComponentBase } from 'obsidian-dev-utils/obsidian/components/plugin-settings-component';
import { pathsValidator } from 'obsidian-dev-utils/obsidian/path-settings';

import type {
  CreateFolderTemplateTokens,
  NameTransformTokens,
  ReorderedFileTemplateTokens
} from './template-tokens.ts';

import { INVALID_CHARACTERS_REG_EXP } from './filename-validation.ts';
import { parseFolderContentTemplate } from './folder-content-template.ts';
import { menuPlaceableCommandsOfCategory } from './menu-placeable-commands.ts';
import {
  CommandCategory,
  CommandMenuPlacement,
  FrontmatterTitleMode,
  PluginSettings
} from './plugin-settings.ts';
import {
  BASE_TOKEN_KEYS,
  ReorderItemKind
} from './reorder-items.ts';
import { TEMPLATE_TOKEN_REG_EXP } from './template-token-reg-exp.ts';
import {
  getTemplateTokenKeys,
  resolveCreateFolderTemplateTokens,
  resolveNameTransformTokens,
  resolveReorderedFileTemplateTokens
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

/**
 * Stand-in values for validating a reordered-FILE template. As above, only the shape matters.
 */
const SAMPLE_REORDERED_FILE_TOKENS: ReorderedFileTemplateTokens = {
  extension: '.md',
  index: 1,
  name: '1. Sample',
  parentFolder: 'Parent',
  parentFolderPath: 'Parent',
  path: 'Parent/1. Sample.md',
  safeName: 'Sample'
};

/**
 * Token keys a reordered FILE's name template cannot use: they are what that template PRODUCES.
 */
const REORDER_FILE_RESULT_TOKEN_KEYS = new Set(['name', 'path']);

/**
 * The name someone TYPED into the create-folder prompt. A reorder never has one, so this is meaningless in
 * every reorder template, the title included.
 */
const RAW_FOLDER_NAME_TOKEN_KEY = 'rawFolderName'.toLowerCase();

/**
 * Token keys a reorder's folder NAME template cannot use: the two it produces itself, plus the typed name.
 */
const REORDER_FOLDER_FORBIDDEN_TOKEN_KEYS = new Set([...FOLDER_ONLY_TOKEN_KEYS, RAW_FOLDER_NAME_TOKEN_KEY]);

/**
 * What a reorder TITLE template cannot use — only the typed name.
 *
 * It deliberately does NOT inherit the rest of the name template's ban: `{{folderName}}` is precisely what
 * a title wants (it is the default), because by the time the title is written the folder HAS its new name.
 */
const REORDER_TYPED_NAME_TOKEN_KEYS = new Set([RAW_FOLDER_NAME_TOKEN_KEY]);

interface PluginSettingsComponentConstructorParams {
  readonly dataHandler: DataHandler;
  readonly pluginEventSource: PluginEventSource;
}

interface ValidateReorderNameTemplateParams {
  /**
   * The token carrying the item's own name — the one the template must contain.
   */
  readonly baseTokenKey: string;

  /**
   * Reports the first token key this kind's resolver does not know.
   *
   * @param template - The template to check.
   * @returns The unknown key, or `undefined` when every token resolves.
   */
  findUnknownTokenKey(this: void, template: string): string | undefined;

  /**
   * Token keys this kind's name template may not use.
   */
  readonly forbiddenTokenKeys: ReadonlySet<string>;

  /**
   * How the message names what is being validated, e.g. `Folder name`.
   */
  readonly subject: string;
  readonly value: string;
}

/* v8 ignore start -- LegacySettings is only instantiated during legacy settings migration. */
class LegacySettings {
  // eslint-disable-next-line unicorn/no-non-function-verb-prefix -- A retired settings key, named by the category it covered.
  public createCommandMenuPlacement?: CommandMenuPlacement;
  public markdownAttachmentSubExtensions: string[] = [];
  public renameCommandMenuPlacement?: CommandMenuPlacement;
  public reorderCommandMenuPlacement?: CommandMenuPlacement;
  public shouldAddInvalidTitleToFrontmatterTitleKey = true;
  public shouldBlockCommandsOnExcludedPaths = false;
  public smartCutAndPasteCommandMenuPlacement?: CommandMenuPlacement;
  public splitCommandMenuPlacement?: CommandMenuPlacement;
  public swapCommandMenuPlacement?: CommandMenuPlacement;
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

      // `shouldBlockCommandsOnExcludedPaths` made command blocking borrow the CONTENT filter's lists;
      // Issue #198 gave command visibility a filter of its own, so the toggle is gone. Seeding both halves
      // Of the new filter from the old lists is what keeps an upgraded vault behaving identically: the old
      // Blocking fired on `isPathIgnored`, which already accounted for `includePaths`, so copying only the
      // Exclude half would silently un-block everything outside a configured include list. With the toggle
      // Off there is nothing to carry over — two empty lists ARE that behavior — so the key is simply
      // Dropped (obsidian-dev-utils deletes it from the record, since it is no longer a plugin setting).
      if (legacySettings.shouldBlockCommandsOnExcludedPaths) {
        legacySettings.commandIncludePaths = legacySettings.includePaths ?? [];
        legacySettings.commandExcludePaths = legacySettings.excludePaths ?? [];
      }

      /*
       * Menu placement was chosen one CATEGORY at a time (issue #252) and is now chosen one COMMAND at a
       * time (issue #254), so each retired key is expanded across every command of its category — which is
       * exactly what that key used to mean, and leaves an upgraded vault with the menus it had.
       *
       * A category left at the default writes nothing: an absent key already IS the default, so expanding
       * it would put thirty entries nobody chose into `data.json` and make the next default change
       * unreachable for anyone who had ever opened the settings tab.
       */
      const legacyCategoryMenuPlacements: readonly (readonly [CommandCategory, CommandMenuPlacement | undefined])[] = [
        [CommandCategory.Create, legacySettings.createCommandMenuPlacement],
        [CommandCategory.Rename, legacySettings.renameCommandMenuPlacement],
        [CommandCategory.Reorder, legacySettings.reorderCommandMenuPlacement],
        [CommandCategory.SmartCutAndPaste, legacySettings.smartCutAndPasteCommandMenuPlacement],
        [CommandCategory.SplitAndExtract, legacySettings.splitCommandMenuPlacement],
        [CommandCategory.Swap, legacySettings.swapCommandMenuPlacement]
      ];
      const commandMenuPlacements = legacySettings.commandMenuPlacements ?? new Map<string, CommandMenuPlacement>();
      for (const [commandCategory, commandMenuPlacement] of legacyCategoryMenuPlacements) {
        if (commandMenuPlacement === undefined || commandMenuPlacement === CommandMenuPlacement.EditorMenu) {
          continue;
        }
        for (const command of menuPlaceableCommandsOfCategory(commandCategory)) {
          commandMenuPlacements.set(command.id, commandMenuPlacement);
        }
      }
      if (commandMenuPlacements.size > 0) {
        legacySettings.commandMenuPlacements = commandMenuPlacements;
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

    // The folder note's own name follows the same rules as the plugin's two other note-name templates —
    // Same vocabulary, same "must be one file-name segment" constraint (issue #216).
    this.registerValidator('folderNoteNameTemplate', validateNoteNameTemplate);

    this.registerValidator('reorderedFolderNameTemplate', validateReorderedFolderNameTemplate);
    this.registerValidator('reorderedFileNameTemplate', validateReorderedFileNameTemplate);
    this.registerValidator('folderNoteTitleTemplate', validateFolderNotePropertyTemplate);
    this.registerValidator('folderNoteAliasesTemplate', validateFolderNotePropertyTemplate);
    this.registerValidator('reorderedFileTitleTemplate', validateReorderedFileTitleTemplate);

    // An un-parseable `/regular expression/` entry no longer throws from the setter (obsidian-dev-utils
    // 88.4.0, issue #155) — the whole list quietly falls back to its default pattern instead. Without a
    // Validator that fallback is invisible, so a single broken entry would silently stop the other
    // Entries from matching. The validator is the ODU export, not a local copy.
    this.registerValidator('includePaths', pathsValidator);
    this.registerValidator('excludePaths', pathsValidator);

    // The command-visibility filter (issue #198) takes the same two entry forms, so it needs the same
    // Validator — the silent all-or-nothing fallback above is not specific to the content filter.
    this.registerValidator('commandIncludePaths', pathsValidator);
    this.registerValidator('commandExcludePaths', pathsValidator);

    // Each category's own pair (issue #249) is the same kind of list, entry forms included, so it needs
    // The same validator. There is deliberately NO legacy-settings converter to go with them: the two
    // Lists above keep meaning "every command", every pair below starts empty, and two empty lists block
    // Nothing — so an existing `data.json` already expresses exactly what it expressed before.
    this.registerValidator('createCommandIncludePaths', pathsValidator);
    this.registerValidator('createCommandExcludePaths', pathsValidator);
    this.registerValidator('mergeCommandIncludePaths', pathsValidator);
    this.registerValidator('mergeCommandExcludePaths', pathsValidator);
    this.registerValidator('moveAndFlattenCommandIncludePaths', pathsValidator);
    this.registerValidator('moveAndFlattenCommandExcludePaths', pathsValidator);
    this.registerValidator('renameCommandIncludePaths', pathsValidator);
    this.registerValidator('renameCommandExcludePaths', pathsValidator);
    this.registerValidator('reorderCommandIncludePaths', pathsValidator);
    this.registerValidator('reorderCommandExcludePaths', pathsValidator);
    this.registerValidator('smartCutAndPasteCommandIncludePaths', pathsValidator);
    this.registerValidator('smartCutAndPasteCommandExcludePaths', pathsValidator);
    this.registerValidator('splitCommandIncludePaths', pathsValidator);
    this.registerValidator('splitCommandExcludePaths', pathsValidator);
    this.registerValidator('swapCommandIncludePaths', pathsValidator);
    this.registerValidator('swapCommandExcludePaths', pathsValidator);
  }
}

/**
 * Reports the first token key the template uses out of a forbidden set, spelled the way it was typed.
 *
 * @param template - The template to check.
 * @param forbiddenTokenKeys - The lower-cased keys to look for.
 * @returns The offending key, or `undefined` when the template uses none of them.
 */
function findTokenKey(template: string, forbiddenTokenKeys: ReadonlySet<string>): string | undefined {
  return getTemplateTokenKeys(template).find((key) => forbiddenTokenKeys.has(key.toLowerCase()));
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
 * Reports the first token key the reordered-file resolver does not know.
 *
 * @param template - The template to check.
 * @returns The unknown key, or `undefined` when every token resolves.
 */
function findUnknownReorderedFileTokenKey(template: string): string | undefined {
  return findUnknownTokenKey(template, (probe) => {
    resolveReorderedFileTemplateTokens({ template: probe, tokens: SAMPLE_REORDERED_FILE_TOKENS });
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
 * Validates a template that writes a PROPERTY of a folder note — `folderNoteTitleTemplate` (issue #216) and
 * `folderNoteAliasesTemplate` (issue #217). Both describe the same folder from the same vocabulary, so they
 * are judged by the same rules.
 *
 * Unlike the name templates these may be EMPTY — that is how each property is left alone, which is why
 * there is no separate toggle beside either.
 *
 * @param value - The template as typed.
 * @returns The error message, or nothing when the template is valid.
 */
function validateFolderNotePropertyTemplate(value: string): MaybeReturn<string> {
  if (!value) {
    return;
  }

  const typedOnlyKey = findTokenKey(value, REORDER_TYPED_NAME_TOKEN_KEYS);
  if (typedOnlyKey) {
    return `{{${typedOnlyKey}}} cannot be used here, because the property describes the folder rather than what was typed`;
  }

  const unknownKey = findUnknownCreateFolderTokenKey(value);
  if (unknownKey) {
    return `Unknown token {{${unknownKey}}}`;
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

/**
 * Validates the `reorderedFileNameTemplate` setting (issue #216).
 *
 * @param value - The template as typed.
 * @returns The error message, or nothing when the template is valid.
 */
function validateReorderedFileNameTemplate(value: string): MaybeReturn<string> {
  return validateReorderNameTemplate({
    baseTokenKey: BASE_TOKEN_KEYS[ReorderItemKind.File],
    findUnknownTokenKey: findUnknownReorderedFileTokenKey,
    forbiddenTokenKeys: REORDER_FILE_RESULT_TOKEN_KEYS,
    subject: 'File name',
    value
  });
}

/**
 * Validates the `reorderedFileTitleTemplate` setting (issue #216). Empty is the opt-out, as above.
 *
 * @param value - The template as typed.
 * @returns The error message, or nothing when the template is valid.
 */
function validateReorderedFileTitleTemplate(value: string): MaybeReturn<string> {
  if (!value) {
    return;
  }

  const unknownKey = findUnknownReorderedFileTokenKey(value);
  if (unknownKey) {
    return `Unknown token {{${unknownKey}}}`;
  }
}

/**
 * Validates the `reorderedFolderNameTemplate` setting (issue #216).
 *
 * @param value - The template as typed.
 * @returns The error message, or nothing when the template is valid.
 */
function validateReorderedFolderNameTemplate(value: string): MaybeReturn<string> {
  return validateReorderNameTemplate({
    baseTokenKey: BASE_TOKEN_KEYS[ReorderItemKind.Folder],
    findUnknownTokenKey: findUnknownCreateFolderTokenKey,
    forbiddenTokenKeys: REORDER_FOLDER_FORBIDDEN_TOKEN_KEYS,
    subject: 'Folder name',
    value
  });
}

/**
 * The rules every reorder NAME template shares, whichever kind it names.
 *
 * The two required tokens are what make a renumbering possible at all: without `{{index}}` there is no
 * number to rewrite, and without the base token the new name would not carry the item's own name — the
 * rename would erase it. Requiring them here is also what lets `numbered-name.ts` build its parser from the
 * same template and always succeed.
 *
 * @param params - The template, its kind's tokens, and the wording for the message.
 * @returns The error message, or nothing when the template is valid.
 */
function validateReorderNameTemplate(params: ValidateReorderNameTemplateParams): MaybeReturn<string> {
  const {
    baseTokenKey,
    findUnknownTokenKey: findUnknownKey,
    forbiddenTokenKeys,
    subject,
    value
  } = params;

  if (!value.trim()) {
    return `${subject} template should not be empty`;
  }

  const resultKey = findTokenKey(value, forbiddenTokenKeys);
  if (resultKey) {
    return `{{${resultKey}}} cannot be used here, because this template IS the name`;
  }

  const unknownKey = findUnknownKey(value);
  if (unknownKey) {
    return `Unknown token {{${unknownKey}}}`;
  }

  const tokenKeys = new Set(getTemplateTokenKeys(value).map((key) => key.toLowerCase()));
  if (!tokenKeys.has('index')) {
    return `${subject} template should contain {{index}}, which is the number a reorder rewrites`;
  }

  if (!tokenKeys.has(baseTokenKey.toLowerCase())) {
    return `${subject} template should contain {{${baseTokenKey}}}, or renumbering would drop the name`;
  }

  if (!hasValidFileNameLiteral(value)) {
    return `Invalid ${subject.toLowerCase()}`;
  }
}
