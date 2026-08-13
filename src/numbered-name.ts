import {
  escapeRegExp,
  getMandatoryNamedGroup
} from 'obsidian-dev-utils/reg-exp';

import { TEMPLATE_TOKEN_REG_EXP } from './template-token-reg-exp.ts';

/**
 * Parameters for {@link buildNumberedNameRegExp}.
 */
export interface BuildNumberedNameRegExpParams {
  /**
   * The token that carries the item's own name (`safeFolderName` for a folder, `safeName` for a file),
   * captured so it can be read back out of an existing name. `null` asks only whether the name is
   * numbered at all, leaving every non-index token widened.
   */
  readonly baseTokenKey: null | string;

  /**
   * The name template, as typed into its setting.
   */
  readonly nameTemplate: string;
}

/**
 * An existing name, split into the parts a renumbering rewrites and the parts it must not touch.
 */
export interface ParsedNumberedName {
  /**
   * The name with its index removed — kept VERBATIM, so a reorder changes the index and nothing else.
   */
  readonly baseName: string;

  /**
   * The index the name currently carries, or `null` when the template did not produce this name (an
   * unnumbered folder, or one named by some other scheme).
   */
  readonly index: null | number;
}

/**
 * Parameters for {@link parseNumberedName}.
 */
export interface ParseNumberedNameParams {
  /**
   * The token that carries the item's own name — `safeFolderName` for a folder, `safeName` for a file.
   */
  readonly baseTokenKey: string;

  /**
   * The existing name: a folder's name, or a file's basename (never its extension).
   */
  readonly name: string;

  /**
   * The name template, as typed into its setting.
   */
  readonly nameTemplate: string;
}

const BASE_CAPTURE_GROUP_NAME = 'Base';
const INDEX_CAPTURE_GROUP_NAME = 'Index';
const INDEX_TOKEN_KEY = 'index';

/**
 * Derives, from a name template, the pattern that recognizes a name the template itself could have
 * produced — `{{index}}` becomes `(\d+)`, the caller's base token becomes a capture, and every other token
 * becomes `.*`.
 *
 * Widening the other tokens is load-bearing: substituting their real values would produce a pattern
 * matching only an item of the SAME name, so nothing would ever be recognized. It is also what makes the
 * whole numbering scheme configurable — the separator is literal template text, `{{index:000}}` still
 * compiles to `\d+` (a padded `007` reads as 7), and because the pattern is built rather than assumed, an
 * index written as a suffix (`{{safeFolderName}} ({{index}})`) parses exactly as readily as a prefix.
 *
 * Only the FIRST occurrence of each captured token is captured: a second named group of the same name is a
 * regex `SyntaxError`, and the first occurrence is the one carrying the value anyway.
 *
 * @param params - The template and the token to capture as the base name.
 * @returns The pattern, or `null` when the template cannot describe a numbered name — it has no
 * `{{index}}` (nothing to renumber) or, when a base token was asked for, never names the item (so
 * renumbering would lose the name).
 */
export function buildNumberedNameRegExp(params: BuildNumberedNameRegExpParams): null | RegExp {
  const { baseTokenKey, nameTemplate } = params;
  // A fresh instance: the shared regex carries the `g` flag, and `matchAll` reads its `lastIndex`.
  const tokenRegExp = new RegExp(TEMPLATE_TOKEN_REG_EXP.source, 'g');
  const lowerCasedBaseTokenKey = baseTokenKey?.toLowerCase() ?? null;
  let hasBaseToken = false;
  let hasIndexToken = false;
  let pattern = '';
  let literalStart = 0;

  for (const match of nameTemplate.matchAll(tokenRegExp)) {
    pattern += escapeRegExp(nameTemplate.slice(literalStart, match.index));
    const key = getMandatoryNamedGroup(match, 'Key').toLowerCase();
    if (key === INDEX_TOKEN_KEY) {
      pattern += hasIndexToken ? String.raw`\d+` : String.raw`(?<${INDEX_CAPTURE_GROUP_NAME}>\d+)`;
      hasIndexToken = true;
    } else if (key === lowerCasedBaseTokenKey && !hasBaseToken) {
      pattern += `(?<${BASE_CAPTURE_GROUP_NAME}>.*)`;
      hasBaseToken = true;
    } else {
      pattern += '.*';
    }
    literalStart = match.index + match[0].length;
  }

  if (!hasIndexToken) {
    return null;
  }

  if (lowerCasedBaseTokenKey !== null && !hasBaseToken) {
    return null;
  }

  pattern += escapeRegExp(nameTemplate.slice(literalStart));
  return new RegExp(`^${pattern}$`);
}

/**
 * Reads an existing name back through the template that names items of its kind, so a reorder can rewrite
 * the index while leaving everything else exactly as it was.
 *
 * @param params - The name, the template, and the token that carries the item's own name.
 * @returns The parsed name. A name the template could not have produced — an unnumbered folder, or one
 * following some other scheme — comes back whole as {@link ParsedNumberedName.baseName} with no index,
 * which is what lets a reorder number a folder that never had a number.
 */
export function parseNumberedName(params: ParseNumberedNameParams): ParsedNumberedName {
  const { baseTokenKey, name, nameTemplate } = params;
  const numberedNameRegExp = buildNumberedNameRegExp({ baseTokenKey, nameTemplate });
  if (!numberedNameRegExp) {
    return { baseName: name, index: null };
  }

  const match = numberedNameRegExp.exec(name);
  if (!match) {
    return { baseName: name, index: null };
  }

  return {
    baseName: getMandatoryNamedGroup(match, BASE_CAPTURE_GROUP_NAME),
    // The group is `\d+`, so this always parses — no `NaN` branch to cover.
    index: Number.parseInt(getMandatoryNamedGroup(match, INDEX_CAPTURE_GROUP_NAME), 10)
  };
}
