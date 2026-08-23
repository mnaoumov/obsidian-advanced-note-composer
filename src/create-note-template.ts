/**
 * @file
 *
 * Where the caret goes in a note the plugin CREATES from a template (issue #244).
 *
 * The reporter asked for `{{content}}` to mark the cursor position in the created note, which sounds like a
 * second meaning for a token that everywhere else interpolates moved text. It is not one. A create moves
 * nothing, so `{{content}}` interpolates to the empty string — and the place where that substitution
 * happened IS the caret. Same token, same substitution; all this module adds is a way to say where it
 * landed.
 *
 * It says so as the TAIL — the resolved template that follows `{{content}}` — rather than as an absolute
 * offset, because the offset is not knowable until the note has been written. A template carrying its own
 * frontmatter has that block hoisted out and merged into whatever frontmatter the note already has (an
 * alias, a `frontmatterTitleMode` title), so anything measured from the START of the file shifts.
 * Everything after `{{content}}` is written verbatim at the end, so the tail pins the caret exactly:
 * `caret = content.length - tail.length`. Handing the caller the string rather than its length also lets it
 * confirm the note really does end with that tail before applying the arithmetic to a still-loading editor.
 */

import type { TFile } from 'obsidian';

import { getMandatoryNamedGroup } from 'obsidian-dev-utils/reg-exp';

import { TEMPLATE_TOKEN_REG_EXP } from './template-token-reg-exp.ts';
import { resolveTemplateTokens } from './template-tokens.ts';

/**
 * Parameters for {@link resolveTemplateTail}.
 */
export interface ResolveTemplateTailParams {
  /**
   * What `{{safeFolderName}}` / `{{index}}` read the folder's number back through — the same
   * `reorderedFolderNameTemplate` the rest of the template vocabulary reads it through (issue #227).
   */
  readonly folderNameTemplate: string;

  /**
   * The source note `{{fromTitle}}` / `{{fromPath}}` / `{{fromParentFolder}}` name, or `null` for a flow
   * that creates a note out of nothing and therefore has none.
   */
  readonly sourceFile: null | TFile;

  /**
   * The created note. Backs `{{newPath}}` / `{{newTitle}}` / `{{newParentFolder}}` and the folder tokens.
   */
  readonly targetFile: TFile;

  /**
   * The template being applied to the created note — the `Split template` setting.
   */
  readonly template: string;
}

/**
 * The lower-cased `{{content}}` key, matched the way the resolvers match it: they all lower-case the key
 * before comparing, so `{{Content}}` is the same token and marks the same caret.
 */
const CONTENT_TOKEN_KEY = 'content';

/**
 * Resolves the part of the template that follows `{{content}}`, which is what the caret is positioned by
 * once the created note has been written.
 *
 * The tail is resolved on its own rather than by resolving the whole template and slicing it, so no caller
 * has to keep two resolutions in step. That is safe because token resolution is per-token and
 * context-free — every token in the tail resolves to the same string it would have resolved to in place.
 *
 * @param params - The template and the notes its tokens are resolved against.
 * @returns The resolved tail, or the empty string when the template has no `{{content}}` token — which puts
 * the caret at the end of the note. That case is unreachable through the settings UI (the `splitTemplate`
 * validator refuses a non-empty template without the token), so it is the answer for a hand-edited
 * `data.json` rather than a designed behavior.
 */
export function resolveTemplateTail(params: ResolveTemplateTailParams): string {
  const tail = extractTailAfterContentToken(params.template);
  if (tail === null) {
    return '';
  }

  return resolveTemplateTokens({
    ...params,
    content: '',
    template: tail
  });
}

/**
 * Splits the template at its FIRST `{{content}}` token and returns everything after it, unresolved.
 *
 * The end offset comes from the regex's own `lastIndex` rather than from the match's index plus its length:
 * both are the same number, and `lastIndex` is the one that needs no indexed access to read.
 *
 * @param template - The raw template string.
 * @returns The unresolved tail, or `null` when the template carries no `{{content}}` token.
 */
function extractTailAfterContentToken(template: string): null | string {
  // A fresh instance: the shared regex carries the `g` flag, so this loop would otherwise resume from — and
  // Leave behind — a `lastIndex` belonging to another caller.
  const tokenRegExp = new RegExp(TEMPLATE_TOKEN_REG_EXP.source, 'g');

  for (let match = tokenRegExp.exec(template); match; match = tokenRegExp.exec(template)) {
    if (getMandatoryNamedGroup(match, 'Key').toLowerCase() === CONTENT_TOKEN_KEY) {
      return template.slice(tokenRegExp.lastIndex);
    }
  }

  return null;
}
