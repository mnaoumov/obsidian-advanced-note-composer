import type {
  TFile,
  TFolder
} from 'obsidian';

import { moment as moment_ } from 'obsidian';
import { extractDefaultExportInterop } from 'obsidian-dev-utils/object-utils';
import { replaceAll } from 'obsidian-dev-utils/string';

/**
 * Matches a single `{{Key}}` / `{{Key:Format}}` template placeholder. Shared by
 * {@link resolveTemplateTokens} and by the settings validators, so both agree on what counts as a token.
 */
export const TEMPLATE_TOKEN_REG_EXP = /{{(?<Key>.+?)(?::(?<Format>.+?))?}}/g;

type TokenResolver = (key: string, format: string | undefined) => string;

const moment = extractDefaultExportInterop(moment_);

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
