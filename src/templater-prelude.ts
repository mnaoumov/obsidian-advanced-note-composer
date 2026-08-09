import type {
  CreateFolderTemplateTokens,
  NameTransformTokens
} from './template-tokens.ts';

/**
 * Every token bag the prelude can expose. A union rather than `Record<string, …>` because an interface has
 * no implicit index signature, so a bag would not be assignable to one — and listing them keeps a new bag a
 * deliberate edit here rather than something that silently starts working.
 */
export type TemplaterPreludeTokens = CreateFolderTemplateTokens | NameTransformTokens;

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
 * Builds the Templater execution-command prelude that exposes a command's tokens to Templater code
 * (issue #191). Shared by the created notes' content and by the `Name transform template` (issue #196),
 * which parses a bare string rather than a file but needs the same `TOKENS` binding.
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
 * **Every caller puts it FIRST, at position 0 of the text handed to Templater, and never writes it to disk.**
 * A `const` is in the temporal dead zone for every command ABOVE it, so a prelude placed any lower makes
 * `TOKENS` unusable in the note's own frontmatter — and Templater then abandons the WHOLE note, body
 * included, with a generic `Template parsing error, aborting.` notice. Prepending is only safe because the
 * combined string goes to `parse_template`: a FILE that starts with `<%*` has no frontmatter as far as the
 * metadata cache is concerned, which is what would break `tp.frontmatter`.
 *
 * @param tokens - The values to expose.
 * @returns The prelude, ending with a newline.
 */
export function buildTemplaterPrelude(tokens: TemplaterPreludeTokens): string {
  return `<%*\nconst ${TEMPLATER_PRELUDE_VARIABLE_NAME} = ${JSON.stringify(tokens)};\n-%>\n`;
}
