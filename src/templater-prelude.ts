import type { CreateFolderTemplateTokens } from './template-tokens.ts';

import { extractFrontmatter } from './frontmatter-merge.ts';

/**
 * The name the prelude binds the token bag to.
 *
 * Deliberately matches the vocabulary the settings tab already uses for `{{tokens}}`, so one word covers both
 * halves of the feature. It is a `const` in the template's own scope, which means a user template declaring
 * its OWN `TOKENS` dies with a redeclaration `SyntaxError` — documented rather than defended against, since
 * silently renaming ours would be worse than failing loudly.
 */
export const TEMPLATER_PRELUDE_VARIABLE_NAME = 'TOKENS';

/**
 * Parameters for {@link insertTemplaterPrelude}.
 */
export interface InsertTemplaterPreludeParams {
  /**
   * The note's content, with the plugin's own `{{tokens}}` already resolved.
   */
  readonly content: string;

  /**
   * The values to expose to Templater code.
   */
  readonly tokens: CreateFolderTemplateTokens;
}

/**
 * Builds the Templater execution-command prelude that exposes this command's tokens to Templater code
 * (issue #191).
 *
 * Templater offers no way to pass data INTO a template run — `tp.config` carries only `template_file`,
 * `target_file`, `run_mode` and `active_file` — so the values are injected as source instead. A variable
 * declared in a `<%* %>` execution command stays in scope for every later `<% %>` command in the same
 * template, which is what makes `<% TOKENS.safeFolderName %>` resolve; and because these are real
 * values rather than text substitutions, `<% TOKENS.index + 1 %>` works too.
 *
 * `JSON.stringify` is the single escaping point: a folder name holding a `"` or a newline can never break
 * the literal, so no per-token escape syntax is needed anywhere else.
 *
 * The closing `-%>` trims exactly one newline after the command, so the prelude leaves no blank line behind.
 *
 * @param tokens - The values to expose.
 * @returns The prelude, ending with a newline.
 */
export function buildTemplaterPrelude(tokens: CreateFolderTemplateTokens): string {
  // Spread into a fresh literal so the entries type as the union the tokens actually hold: an interface has
  // No implicit index signature, which would otherwise leave every value `unknown`.
  const values: Record<string, number | string> = { ...tokens };
  const entries = Object.entries(values)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`)
    .join(',\n');
  return `<%*\nconst ${TEMPLATER_PRELUDE_VARIABLE_NAME} = {\n${entries}\n};\n-%>\n`;
}

/**
 * Prepends {@link buildTemplaterPrelude} to a note's content, BELOW its frontmatter block when it has one.
 *
 * The insertion point is not cosmetic: a prelude above the opening `---` stops that block being frontmatter
 * at all, so `tp.frontmatter` — and Obsidian's own metadata cache — would see nothing.
 *
 * Only called when Templater will actually run; otherwise the raw `<%* … %>` block would be left sitting in
 * the created note.
 *
 * @param params - The content and the values to expose.
 * @returns The content with the prelude inserted.
 */
export function insertTemplaterPrelude(params: InsertTemplaterPreludeParams): string {
  const { content, tokens } = params;
  const { content: body } = extractFrontmatter(content);
  const frontmatterBlock = content.slice(0, content.length - body.length);
  return `${frontmatterBlock}${buildTemplaterPrelude(tokens)}${body}`;
}
