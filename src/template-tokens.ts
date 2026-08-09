import type {
  TFile,
  TFolder
} from 'obsidian';

import { moment as moment_ } from 'obsidian';
import { extractDefaultExportInterop } from 'obsidian-dev-utils/object-utils';
import { getMandatoryNamedGroup } from 'obsidian-dev-utils/reg-exp';
import { replaceAll } from 'obsidian-dev-utils/string';

/**
 * Matches a single `{{Key}}` / `{{Key:Format}}` template placeholder. Shared by
 * {@link resolveTemplateTokens} and by the settings validators, so both agree on what counts as a token.
 */
export const TEMPLATE_TOKEN_REG_EXP = /{{(?<Key>.+?)(?::(?<Format>.+?))?}}/g;

type TokenResolver = (key: string, format: string | undefined) => string;

const moment = extractDefaultExportInterop(moment_);

/**
 * Everything the `Create folder with notes...` command knows about the folder it is creating (issue #191).
 *
 * Both spellings of the name are members rather than one being derived from the other, because the reporter's
 * own output needs both at once: the note's `title` is the folder name WITH its index (`1. Test Notes`)
 * while its alias is the name WITHOUT it (`Test Notes`).
 *
 * The same bag is handed to the Templater prelude, so a value added here becomes available to `{{tokens}}`
 * and to `<% TOKENS.… %>` at the same time.
 */
export interface CreateFolderTemplateTokens {
  /**
   * The final folder name, index and any ` 1` de-duplication suffix included. Empty while the folder-NAME
   * template is being resolved, because it IS that template's result — the settings validator rejects the
   * token there.
   */
  readonly folderName: string;

  /**
   * The created folder's full vault path. Empty while the folder-NAME template is being resolved, for the
   * same reason as {@link CreateFolderTemplateTokens.folderName}.
   */
  readonly folderPath: string;

  /**
   * The next number in the sibling sequence.
   */
  readonly index: number;

  /**
   * The name of the folder the new folder is created in.
   */
  readonly parentFolder: string;

  /**
   * The path of the folder the new folder is created in.
   */
  readonly parentFolderPath: string;

  /**
   * The name exactly as typed into the prompt, before any normalization.
   */
  readonly rawFolderName: string;

  /**
   * The normalized typed name, WITHOUT the index.
   */
  readonly safeFolderName: string;
}

/**
 * Everything the `Name transform template` knows about the name it is rewriting (issue #196).
 *
 * Exactly one member, deliberately: the transform's whole job is to turn the supplied name into another
 * name, so anything else it needs it can compute from that string. The same bag is handed to the Templater
 * prelude, so `{{rawString}}` and `<% TOKENS.rawString %>` always mean the same thing.
 */
export interface NameTransformTokens {
  /**
   * The name as supplied, before ANY normalization — the typed folder name, the typed split target, or a
   * note-name template's own resolved output.
   */
  readonly rawString: string;
}

interface ResolveCreateFolderTemplateTokensParams {
  /**
   * The raw template string (may contain `{{token}}` / `{{token:format}}` placeholders).
   */
  readonly template: string;

  /**
   * The values the tokens resolve to.
   */
  readonly tokens: CreateFolderTemplateTokens;
}

interface ResolveFolderTemplateTokensParams {
  /**
   * The folder the tokens are resolved against. Backs `{{folderName}}` / `{{folderPath}}` and
   * `{{parentFolder}}`.
   */
  readonly sourceFolder: TFolder;

  /**
   * The raw template string (may contain `{{token}}` / `{{token:format}}` placeholders).
   */
  readonly template: string;
}

interface ResolveNameTransformTokensParams {
  /**
   * The raw template string (may contain `{{token}}` / `{{token:format}}` placeholders).
   */
  readonly template: string;

  /**
   * The values the tokens resolve to.
   */
  readonly tokens: NameTransformTokens;
}

interface ResolveTemplateTokensParams {
  /**
   * The value substituted for the `{{content}}` token.
   */
  readonly content: string;

  /**
   * The source note. Backs `{{fromPath}}` / `{{fromTitle}}` / `{{fromParentFolder}}`.
   */
  readonly sourceFile: TFile;

  /**
   * The destination note. Backs `{{newPath}}` / `{{newTitle}}` / `{{newParentFolder}}` and the bare
   * `{{parentFolder}}` alias.
   */
  readonly targetFile: TFile;

  /**
   * The raw template string (may contain `{{token}}` / `{{token:format}}` placeholders).
   */
  readonly template: string;
}

/**
 * Lists the token keys a template uses, VERBATIM — the resolvers match case-insensitively, but a validator
 * that reports a key back to the user has to spell it the way they typed it.
 *
 * Used by the settings validators to reject a token that is grammatically fine but meaningless where it was
 * written — which resolving cannot detect, since resolving it would simply succeed.
 *
 * @param template - The raw template string.
 * @returns The keys, in the order they appear, with duplicates kept.
 */
export function getTemplateTokenKeys(template: string): string[] {
  // A fresh instance: the shared regex carries the `g` flag, and `matchAll` reads its `lastIndex`.
  const tokenRegExp = new RegExp(TEMPLATE_TOKEN_REG_EXP.source, 'g');
  return [...template.matchAll(tokenRegExp)].map((match) => getMandatoryNamedGroup(match, 'Key'));
}

/**
 * Resolves the tokens of the `Create folder with notes...` command (issue #191) inside a template string.
 * Backs BOTH of that command's templates — the folder name and the folder content — because they share one
 * token vocabulary; only `{{folderName}}` / `{{folderPath}}` are unavailable in the name template, which the
 * settings validator enforces rather than this resolver.
 *
 * Shares {@link TEMPLATE_TOKEN_REG_EXP} and the "unknown key throws" contract with the other resolvers, so
 * `{{date}}` / `{{time}}` work here too and a typo still fails loudly.
 *
 * `{{index}}` takes its `{{key:format}}` part as a zero-pad MASK rather than a moment format: `{{index:000}}`
 * pads to the mask's own length, so the width is written the way it will look.
 *
 * @param params - The template and the values its tokens resolve to.
 * @returns The template with every token replaced by its value.
 */
export function resolveCreateFolderTemplateTokens(params: ResolveCreateFolderTemplateTokensParams): string {
  const { template, tokens } = params;
  return replaceTemplateTokens(template, (key, format) => {
    switch (key.toLowerCase()) {
      case 'folderName'.toLowerCase(): {
        return tokens.folderName;
      }
      case 'folderPath'.toLowerCase(): {
        return tokens.folderPath;
      }
      case 'parentFolder'.toLowerCase(): {
        return tokens.parentFolder;
      }
      case 'parentFolderPath'.toLowerCase(): {
        return tokens.parentFolderPath;
      }
      case 'rawFolderName'.toLowerCase(): {
        return tokens.rawFolderName;
      }
      case 'safeFolderName'.toLowerCase(): {
        return tokens.safeFolderName;
      }
      case 'index': {
        return formatIndex(tokens.index, format);
      }
      default: {
        return resolveDateTimeToken(key, format);
      }
    }
  });
}

/**
 * Resolves the folder-flavored template tokens (`{{folderName}}`, `{{folderPath}}`,
 * `{{parentFolder}}`, `{{date:FORMAT}}`, `{{time:FORMAT}}`) inside a template string.
 *
 * Used where a template names something derived from a FOLDER rather than from a source/destination note
 * pair — the `Merge folder contents into a single file` target note name (issue #160). It shares
 * {@link TEMPLATE_TOKEN_REG_EXP} and the "unknown key throws" contract with
 * {@link resolveTemplateTokens}, so both agree on what a token is; only the key set differs, because the
 * note-flavored keys have nothing to resolve against here.
 *
 * @param params - The template and the folder its tokens are resolved against.
 * @returns The template with every token replaced by its value.
 */
export function resolveFolderTemplateTokens(params: ResolveFolderTemplateTokensParams): string {
  const { sourceFolder, template } = params;
  return replaceTemplateTokens(template, (key, format) => {
    switch (key.toLowerCase()) {
      case 'folderName'.toLowerCase(): {
        return sourceFolder.name;
      }
      case 'folderPath'.toLowerCase(): {
        return sourceFolder.path;
      }
      case 'parentFolder'.toLowerCase(): {
        return sourceFolder.parent?.name ?? '';
      }
      default: {
        return resolveDateTimeToken(key, format);
      }
    }
  });
}

/**
 * Resolves the tokens of the `Name transform template` setting (issue #196) inside a template string.
 *
 * Shares {@link TEMPLATE_TOKEN_REG_EXP} and the "unknown key throws" contract with the other resolvers, so
 * `{{date}}` / `{{time}}` work here too and a typo still fails loudly — here it surfaces as a prompt
 * validation error rather than as a mangled name.
 *
 * @param params - The template and the values its tokens resolve to.
 * @returns The template with every token replaced by its value.
 */
export function resolveNameTransformTokens(params: ResolveNameTransformTokensParams): string {
  const { template, tokens } = params;
  return replaceTemplateTokens(template, (key, format) => {
    switch (key.toLowerCase()) {
      case 'rawString'.toLowerCase(): {
        return tokens.rawString;
      }
      default: {
        return resolveDateTimeToken(key, format);
      }
    }
  });
}

/**
 * Resolves the template tokens (`{{content}}`, `{{fromTitle}}`, `{{parentFolder}}`, ...) inside a
 * template string. See {@link ResolveTemplateTokensParams} for the token semantics.
 *
 * @param params - The template and the notes its tokens are resolved against.
 * @returns The template with every token replaced by its value.
 */
export function resolveTemplateTokens(params: ResolveTemplateTokensParams): string {
  const { content, sourceFile, targetFile, template } = params;
  return replaceTemplateTokens(template, (key, format) => {
    switch (key.toLowerCase()) {
      case 'fromParentFolder'.toLowerCase(): {
        return getParentFolderName(sourceFile);
      }
      case 'fromPath'.toLowerCase(): {
        return sourceFile.path;
      }
      case 'fromTitle'.toLowerCase(): {
        return sourceFile.basename;
      }
      case 'newParentFolder'.toLowerCase():
      case 'parentFolder'.toLowerCase(): {
        return getParentFolderName(targetFile);
      }
      case 'newPath'.toLowerCase(): {
        return targetFile.path;
      }
      case 'newTitle'.toLowerCase(): {
        return targetFile.basename;
      }
      case 'content': {
        return content;
      }
      default: {
        return resolveDateTimeToken(key, format);
      }
    }
  });
}

/**
 * Renders `{{index}}`, zero-padding it to the width of the `{{index:MASK}}` mask when one is given.
 *
 * @param index - The next number in the sibling sequence.
 * @param format - The optional mask, whose LENGTH is the target width (`000` means three digits).
 * @returns The rendered index.
 */
function formatIndex(index: number, format: string | undefined): string {
  const renderedIndex = index.toString();
  return format ? renderedIndex.padStart(format.length, '0') : renderedIndex;
}

function getParentFolderName(file: TFile): string {
  return file.parent?.name ?? '';
}

function replaceTemplateTokens(template: string, tokenResolver: TokenResolver): string {
  return replaceAll({
    $string: template,
    replacer: ({ groups }) => {
      /* v8 ignore start -- defensive optional access on always-present named regex groups. */
      const key = groups?.['Key'] ?? '';
      const format = groups?.['Format'];
      /* v8 ignore stop */
      return tokenResolver(key, format);
    },
    searchValue: TEMPLATE_TOKEN_REG_EXP
  });
}

/**
 * Resolves the tokens every flavor of template shares, and rejects anything else. Being the `default`
 * branch of each resolver's switch is what keeps `{{date}}` / `{{time}}` available everywhere while an
 * unknown key still throws with the same message it always did.
 *
 * @param key - The token key as written, e.g. `date`.
 * @param format - The optional `{{key:format}}` part.
 * @returns The resolved value.
 */
function resolveDateTimeToken(key: string, format: string | undefined): string {
  switch (key.toLowerCase()) {
    case 'date': {
      return moment().format(format ?? 'YYYY-MM-DD');
    }
    case 'time': {
      return moment().format(format ?? 'HH:mm');
    }
    default: {
      throw new Error(`Invalid template key: ${key}`);
    }
  }
}
