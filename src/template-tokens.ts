import type {
  TFile,
  TFolder
} from 'obsidian';

import { moment as moment_ } from 'obsidian';
import { extractDefaultExportInterop } from 'obsidian-dev-utils/object-utils';
import { basename } from 'obsidian-dev-utils/path';
import { getMandatoryNamedGroup } from 'obsidian-dev-utils/reg-exp';
import { replaceAll } from 'obsidian-dev-utils/string';

import { parseNumberedName } from './numbered-name.ts';
import { TEMPLATE_TOKEN_REG_EXP } from './template-token-reg-exp.ts';

type TokenResolver = (key: string, format: string | undefined) => string;

/**
 * The token a folder's own name is written with, i.e. what {@link parseNumberedName} reads an existing
 * folder name back through. The same string as `BASE_TOKEN_KEYS[ReorderItemKind.Folder]`, spelled out here
 * rather than imported: `reorder-items.ts` imports THIS module, so importing it back would be a cycle.
 */
const FOLDER_BASE_TOKEN_KEY = 'safeFolderName';

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

/**
 * Everything a reorder knows about a FILE it is renumbering (issue #216).
 *
 * The folder-flavored bag above cannot serve here: `{{safeFolderName}}` would be a lie on a note, and a
 * file has an extension the numbering must never touch. Both spellings of the name are members for the same
 * reason as {@link CreateFolderTemplateTokens} — the new name WITH the index goes into `title`, the one
 * WITHOUT it is what the next renumbering reads back.
 */
export interface ReorderedFileTemplateTokens {
  /**
   * The file's extension, leading dot included (`.md`). Renumbering never rewrites it.
   */
  readonly extension: string;

  /**
   * The position the file is being renumbered to, counting from `1`.
   */
  readonly index: number;

  /**
   * The final basename, index included. Empty while the NAME template is being resolved, because it IS
   * that template's result — the settings validator rejects the token there.
   */
  readonly name: string;

  /**
   * The name of the folder the file sits in.
   */
  readonly parentFolder: string;

  /**
   * The path of the folder the file sits in.
   */
  readonly parentFolderPath: string;

  /**
   * The file's full vault path after the renumbering. Empty while the NAME template is being resolved, for
   * the same reason as {@link ReorderedFileTemplateTokens.name}.
   */
  readonly path: string;

  /**
   * The basename WITHOUT the index — what the file was called before the sequence claimed a number for it.
   */
  readonly safeName: string;
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

interface ResolveReorderedFileTemplateTokensParams {
  /**
   * The raw template string (may contain `{{token}}` / `{{token:format}}` placeholders).
   */
  readonly template: string;

  /**
   * The values the tokens resolve to.
   */
  readonly tokens: ReorderedFileTemplateTokens;
}

interface ResolveTemplateTokensParams {
  /**
   * The value substituted for the `{{content}}` token.
   */
  readonly content: string;

  /**
   * The template `{{safeFolderName}}` and `{{index}}` read the folder's number back through — the same
   * `reorderedFolderNameTemplate` that `Rename folder...` reads an existing folder's number with, so the
   * two can never disagree about what a numbered name looks like (issue #227).
   *
   * Omitted (or empty) means the folder is treated as unnumbered: `{{safeFolderName}}` is the whole name and
   * `{{index}}` is empty.
   */
  readonly folderNameTemplate?: string;

  /**
   * The folder `{{folderName}}` / `{{folderPath}}` / `{{parentFolderPath}}` / `{{safeFolderName}}` /
   * `{{index}}` describe, overriding the target note's own parent (issue #227).
   *
   * Only one caller needs it, and it is the reason the override exists: `splitIntoFolderNoteNameTemplate` is
   * resolved INSIDE `moveIntoOwnFolder`, after the new folder has been created but before the note has been
   * renamed into it — so the note's parent is still the folder ABOVE, and the folder these tokens should be
   * naming is the one being created.
   *
   * `{{parentFolder}}` / `{{newParentFolder}}` deliberately do NOT follow it: they are shipped tokens whose
   * documented value is the note's parent at the moment the template is resolved, and quietly moving them
   * one level down would rewrite what an existing `Split into folder note name template` produces.
   */
  readonly folderPath?: string;

  /**
   * The source note. Backs `{{fromPath}}` / `{{fromTitle}}` / `{{fromParentFolder}}`.
   *
   * `null` for a flow that has no source note to name — `Create empty note in folder...` creates a note
   * out of nothing, so there is no note it came FROM (issue #244). Those three tokens then resolve to the
   * empty string rather than throwing, exactly as `CreateNoteFromTypedNameParams.contextFile` is already
   * nullable for the same command.
   */
  readonly sourceFile: null | TFile;

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
 * The folder the note-flavored vocabulary's folder tokens name, already resolved (issue #227).
 */
interface TargetFolderTokens {
  readonly folderName: string;
  readonly folderPath: string;

  /**
   * The number the folder's name carries, or `null` when it carries none — which is what makes
   * `{{index}}` empty rather than a made-up `0`.
   */
  readonly index: null | number;
  readonly safeFolderName: string;
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
 * Resolves the tokens a reorder exposes when renaming a FILE (issue #216) inside a template string.
 *
 * Shares {@link TEMPLATE_TOKEN_REG_EXP} and the "unknown key throws" contract with the other resolvers, so
 * `{{date}}` / `{{time}}` work here too and a typo still fails loudly — and `{{index}}` takes the same
 * zero-pad MASK, so `{{index:000}}` numbers notes the way it numbers folders.
 *
 * @param params - The template and the values its tokens resolve to.
 * @returns The template with every token replaced by its value.
 */
export function resolveReorderedFileTemplateTokens(params: ResolveReorderedFileTemplateTokensParams): string {
  const { template, tokens } = params;
  return replaceTemplateTokens(template, (key, format) => {
    switch (key.toLowerCase()) {
      case 'parentFolder'.toLowerCase(): {
        return tokens.parentFolder;
      }
      case 'parentFolderPath'.toLowerCase(): {
        return tokens.parentFolderPath;
      }
      case 'safeName'.toLowerCase(): {
        return tokens.safeName;
      }
      case 'extension': {
        return tokens.extension;
      }
      case 'index': {
        return formatIndex(tokens.index, format);
      }
      case 'name': {
        return tokens.name;
      }
      case 'path': {
        return tokens.path;
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
 * Since issue #227 the folder-flavored keys of the `Create folder with notes...` vocabulary resolve here
 * too, so a template written for that command can be pasted into `Split template` unchanged — see
 * {@link resolveTargetFolderTokens} for which folder they name and why two of that command's keys are
 * deliberately still unknown here.
 *
 * @param params - The template and the notes its tokens are resolved against.
 * @returns The template with every token replaced by its value.
 */
export function resolveTemplateTokens(params: ResolveTemplateTokensParams): string {
  const { content, sourceFile, targetFile, template } = params;

  // Resolved ON DEMAND, and memoized for the second folder token in the same template. A template with no
  // Folder token must not read the target note's folder or build a numbering pattern at all — the folder
  // Keys are an addition to a vocabulary every merge and split already resolves, so paying for them
  // Unconditionally would make every template that predates them do work it has no use for.
  let folderTokens: null | TargetFolderTokens = null;

  function getFolderTokens(): TargetFolderTokens {
    folderTokens ??= resolveTargetFolderTokens(params);
    return folderTokens;
  }

  return replaceTemplateTokens(template, (key, format) => {
    switch (key.toLowerCase()) {
      case 'folderName'.toLowerCase(): {
        return getFolderTokens().folderName;
      }
      case 'folderPath'.toLowerCase():
      case 'parentFolderPath'.toLowerCase(): {
        return getFolderTokens().folderPath;
      }
      // The three `from` tokens are the only ones a source note backs, and each answers for itself rather
      // Than being resolved together up front: a shared eager read would touch the source note even for a
      // Template that names none of them.
      case 'fromParentFolder'.toLowerCase(): {
        return sourceFile ? getParentFolderName(sourceFile) : '';
      }
      case 'fromPath'.toLowerCase(): {
        return sourceFile?.path ?? '';
      }
      case 'fromTitle'.toLowerCase(): {
        return sourceFile?.basename ?? '';
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
      case 'safeFolderName'.toLowerCase(): {
        return getFolderTokens().safeFolderName;
      }
      case 'content': {
        return content;
      }
      case 'index': {
        // An unnumbered folder has no number to render, and none to pad either — `{{index:000}}` over
        // Nothing would be `000`, a number the folder does not carry.
        const { index } = getFolderTokens();
        return index === null ? '' : formatIndex(index, format);
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

function getParentFolderPath(file: TFile): string {
  return file.parent?.path ?? '';
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

/**
 * Resolves the folder the note-flavored vocabulary's folder tokens describe (issue #227).
 *
 * **That folder is the target note's OWN folder** — which, for a split with `Split into folder` on, is
 * precisely the folder the split just created, and for every other flow is simply the folder the note landed
 * in. One rule, no mode. `{{folderPath}}` and `{{parentFolderPath}}` are the same string for that reason, as
 * are `{{folderName}}` and `{{parentFolder}}` everywhere the caller passes no
 * {@link ResolveTemplateTokensParams.folderPath} override; the aliases exist so a template written against
 * the `Create folder with notes...` vocabulary reads the same when pasted into `Split template`.
 *
 * Two keys of that vocabulary are deliberately NOT resolved here and keep throwing as unknown:
 * `{{rawFolderName}}`, because a split has no folder-name prompt (the typed string names the NOTE), and
 * `{{file}}`, because it is a marker declaring MULTIPLE notes while a split writes one.
 *
 * The vault root is left exactly as the vault reports it — an empty `name`, a `/` `path` — matching
 * {@link resolveFolderTemplateTokens} and {@link resolveCreateFolderTemplateTokens}, which both read those
 * properties raw.
 *
 * @param params - The resolve parameters.
 * @returns The folder tokens' values, with `index` `null` when the folder carries no number.
 */
function resolveTargetFolderTokens(params: ResolveTemplateTokensParams): TargetFolderTokens {
  const { folderNameTemplate, folderPath, targetFile } = params;
  const folderName = folderPath === undefined ? getParentFolderName(targetFile) : basename(folderPath);
  const { baseName, index } = parseNumberedName({
    baseTokenKey: FOLDER_BASE_TOKEN_KEY,
    name: folderName,
    // An absent template describes no numbered name at all, so `parseNumberedName` reports the name whole
    // With no index — which IS "this folder is not numbered".
    nameTemplate: folderNameTemplate ?? ''
  });

  return {
    folderName,
    folderPath: folderPath ?? getParentFolderPath(targetFile),
    index,
    safeFolderName: baseName
  };
}
