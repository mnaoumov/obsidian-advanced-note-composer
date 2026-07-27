import type { TFile } from 'obsidian';

import { moment as moment_ } from 'obsidian';
import { extractDefaultExportInterop } from 'obsidian-dev-utils/object-utils';
import { replaceAll } from 'obsidian-dev-utils/string';

/**
 * Matches a single `{{Key}}` / `{{Key:Format}}` template placeholder. Shared by
 * {@link resolveTemplateTokens} and by the settings validators, so both agree on what counts as a token.
 */
export const TEMPLATE_TOKEN_REG_EXP = /{{(?<Key>.+?)(?::(?<Format>.+?))?}}/g;

const moment = extractDefaultExportInterop(moment_);

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
 * Resolves the template tokens (`{{content}}`, `{{fromTitle}}`, `{{parentFolder}}`, ...) inside a
 * template string. See {@link ResolveTemplateTokensParams} for the token semantics.
 *
 * @param params - The template and the notes its tokens are resolved against.
 * @returns The template with every token replaced by its value.
 */
export function resolveTemplateTokens(params: ResolveTemplateTokensParams): string {
  const { content, sourceFile, targetFile, template } = params;
  return replaceAll({
    replacer: ({ groups }) => {
      /* v8 ignore start -- defensive optional access on always-present named regex groups. */
      const key = groups?.['Key'] ?? '';
      const format = groups?.['Format'];
      /* v8 ignore stop */
      switch (key.toLowerCase()) {
        case 'fromParentFolder'.toLowerCase():
          return getParentFolderName(sourceFile);
        case 'fromPath'.toLowerCase():
          return sourceFile.path;
        case 'fromTitle'.toLowerCase():
          return sourceFile.basename;
        case 'newParentFolder'.toLowerCase():
        case 'parentFolder'.toLowerCase():
          return getParentFolderName(targetFile);
        case 'newPath'.toLowerCase():
          return targetFile.path;
        case 'newTitle'.toLowerCase():
          return targetFile.basename;
        case 'content':
          return content;
        case 'date':
          return moment().format(format ?? 'YYYY-MM-DD');
        case 'time':
          return moment().format(format ?? 'HH:mm');
        default:
          throw new Error(`Invalid template key: ${key}`);
      }
    },
    searchValue: TEMPLATE_TOKEN_REG_EXP,
    str: template
  });
}

function getParentFolderName(file: TFile): string {
  return file.parent?.name ?? '';
}
