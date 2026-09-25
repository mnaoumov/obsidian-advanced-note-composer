import {
  escapeRegExp,
  getMandatoryNamedGroup
} from 'obsidian-dev-utils/reg-exp';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';

import type {
  HeadingTreeNode,
  SplitReorderableSectionsResult
} from './heading-sections.ts';

import { TEMPLATE_TOKEN_REG_EXP } from './template-token-reg-exp.ts';
import { resolveHeadingNumberTemplateTokens } from './template-tokens.ts';

/**
 * How `Reorder headings` treats the numbers in a note's headings (issue #295).
 */
export interface HeadingNumbering {
  /**
   * Whether to number every heading. Mutable: the modal's `Number headings` checkbox flips it, and the
   * rows re-render from it.
   */
  shouldNumber: boolean;

  /**
   * The template a heading is written with, e.g. `{{index}}. {{headingText}}`.
   */
  readonly template: string;

  /**
   * Whether every heading of the note already carried a number before the reorder. Clearing the checkbox
   * on such a note is how its numbers are removed; clearing it on any other note leaves its headings exactly
   * as typed, so a heading that merely starts with a number is never stripped by accident.
   */
  readonly wasNumbered: boolean;
}

/**
 * The key of the token that carries a heading's own text.
 */
export const HEADING_TEXT_TOKEN_KEY = 'headingText';

/**
 * The keys of the tokens that write a heading's number: its position among its siblings, and the dotted
 * chain from its top-level ancestor down.
 */
export const HEADING_INDEX_TOKEN_KEYS: readonly string[] = ['index', 'outlineIndex'];

const BASE_CAPTURE_GROUP_NAME = 'Base';

/**
 * What each numbering token looks like once rendered, so an existing number can be recognized — and
 * removed — through the same template that wrote it.
 */
const INDEX_TOKEN_PATTERNS = new Map<string, string>([
  ['index', String.raw`\d+`],
  ['outlineIndex'.toLowerCase(), String.raw`\d+(?:\.\d+)*`]
]);

/**
 * Parameters for {@link stripHeadingNumber}.
 */
export interface StripHeadingNumberParams {
  /**
   * The heading text as it stands.
   */
  readonly headingText: string;

  /**
   * The heading-number template.
   */
  readonly template: string;
}

/**
 * Works out the text every heading will have, indexed like {@link SplitReorderableSectionsResult.sections}.
 *
 * Numbering walks the tree as it stands, so the numbers always follow the order the modal shows: a heading
 * is numbered by its position among its siblings, and the chain behind `{{outlineIndex}}` by the positions
 * of its ancestors. A number an earlier renumbering wrote is removed first, so renumbering `2. Intro` gives
 * `1. Intro` rather than `1. 2. Intro`.
 *
 * @param split - The split note, holding the confirmed tree.
 * @param numbering - How the numbers are treated.
 * @returns The heading text per section.
 */
export function computeHeadingTexts(split: SplitReorderableSectionsResult, numbering: HeadingNumbering): string[] {
  const baseTexts = split.sections.map((section) => stripHeadingNumber({ headingText: section.headingText, template: numbering.template }));
  if (!numbering.shouldNumber) {
    return numbering.wasNumbered ? baseTexts : split.sections.map((section) => section.headingText);
  }

  const texts = [...baseTexts];
  visit(split.roots, []);
  return texts;

  function visit(nodes: readonly HeadingTreeNode[], parentOutlineIndex: readonly number[]): void {
    for (const [position, node] of nodes.entries()) {
      const index = position + 1;
      const outlineIndex = [...parentOutlineIndex, index];
      texts[node.index] = resolveHeadingNumberTemplateTokens({
        template: numbering.template,
        tokens: {
          // Every node indexes a section of the same split, so a fallback would be a branch nothing can reach.
          headingText: ensureNonNullable(baseTexts[node.index]),
          index,
          outlineIndex
        }
      });
      visit(node.children, outlineIndex);
    }
  }
}

/**
 * Whether every heading of a note carries a number the template could have written — i.e. whether the note
 * is already numbered, so `Reorder headings` keeps it numbered without being asked.
 *
 * @param split - The split note.
 * @param template - The heading-number template.
 * @returns `true` when the note has headings and every one of them parses as numbered.
 */
export function isEveryHeadingNumbered(split: SplitReorderableSectionsResult, template: string): boolean {
  const numberedHeadingRegExp = buildNumberedHeadingRegExp(template);
  return numberedHeadingRegExp !== null
    && split.sections.length > 0
    && split.sections.every((section) => numberedHeadingRegExp.test(section.headingText));
}

/**
 * Removes the number the template would have written from a heading's text, keeping the rest VERBATIM.
 *
 * @param params - The heading text and the template.
 * @returns The text without its number, or the text unchanged when the template could not have produced it.
 */
export function stripHeadingNumber(params: StripHeadingNumberParams): string {
  const match = buildNumberedHeadingRegExp(params.template)?.exec(params.headingText);
  return match ? getMandatoryNamedGroup(match, BASE_CAPTURE_GROUP_NAME) : params.headingText;
}

/**
 * Derives, from the heading-number template, the pattern that recognizes a heading the template itself
 * could have written: each numbering token becomes the digits it renders, `{{headingText}}` becomes a
 * capture, and every other token becomes `.*`. The same construction `numbered-name.ts` uses for folder and
 * note names, with the second numbering token a heading outline needs.
 *
 * @param template - The heading-number template.
 * @returns The pattern, or `null` when the template has no numbering token or no `{{headingText}}` — then
 * nothing it writes can be told apart from a heading that was never numbered.
 */
function buildNumberedHeadingRegExp(template: string): null | RegExp {
  // A fresh instance: the shared regex carries the `g` flag, and `matchAll` reads its `lastIndex`.
  const tokenRegExp = new RegExp(TEMPLATE_TOKEN_REG_EXP.source, 'g');
  const lowerCasedHeadingTextTokenKey = HEADING_TEXT_TOKEN_KEY.toLowerCase();
  let hasHeadingTextToken = false;
  let hasIndexToken = false;
  let pattern = '';
  let literalStart = 0;

  for (const match of template.matchAll(tokenRegExp)) {
    pattern += escapeRegExp(template.slice(literalStart, match.index));
    const key = getMandatoryNamedGroup(match, 'Key').toLowerCase();
    const indexPattern = INDEX_TOKEN_PATTERNS.get(key);
    if (indexPattern !== undefined) {
      pattern += indexPattern;
      hasIndexToken = true;
    } else if (key === lowerCasedHeadingTextTokenKey && !hasHeadingTextToken) {
      pattern += `(?<${BASE_CAPTURE_GROUP_NAME}>.*)`;
      hasHeadingTextToken = true;
    } else {
      pattern += '.*';
    }
    literalStart = match.index + match[0].length;
  }

  if (!hasIndexToken || !hasHeadingTextToken) {
    return null;
  }

  pattern += escapeRegExp(template.slice(literalStart));
  return new RegExp(`^${pattern}$`);
}
