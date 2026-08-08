import type { TFolder } from 'obsidian';

import { isFolder } from 'obsidian-dev-utils/obsidian/file-system';
import {
  escapeRegExp,
  getMandatoryNamedGroup
} from 'obsidian-dev-utils/reg-exp';

import { TEMPLATE_TOKEN_REG_EXP } from './template-tokens.ts';

/**
 * The index a folder gets when no numbered sibling exists yet. The reporter's own plugin starts at `1`, not
 * at `0`.
 */
export const FIRST_FOLDER_INDEX = 1;

const INDEX_CAPTURE_GROUP_NAME = 'Index';
const INDEX_TOKEN_KEY = 'index';

/**
 * Parameters for {@link resolveNextFolderIndex}.
 */
export interface ResolveNextFolderIndexParams {
  /**
   * The `createFolderNameTemplate` setting, as typed.
   */
  readonly nameTemplate: string;

  /**
   * The folder the new folder is created in — its child folders are the siblings that get scanned.
   */
  readonly parentFolder: TFolder;
}

/**
 * Derives, from the folder-name template itself, the pattern that recognizes an already-numbered sibling.
 *
 * `{{index}}` becomes `(\d+)` and **every other token becomes `.*`** — that second half is the load-bearing
 * one. Substituting the real values instead would produce a pattern matching only a folder with the SAME
 * name, so the scan would find nothing and every folder would be numbered `1`. Widening the other tokens is
 * what makes the default `{{index}}. {{safeFolderName}}` compile to `^(\d+)\. .*$` — precisely the
 * `/^(\d+)\./` rule the reporter's `folder-note-extended` uses.
 *
 * Only the FIRST `{{index}}` is captured: a second named group of the same name is a regex `SyntaxError`, and
 * the first occurrence is the one that carries the number anyway.
 *
 * @param nameTemplate - The `createFolderNameTemplate` setting, as typed.
 * @returns The sibling pattern, or `null` when the template has no `{{index}}` token at all — that template
 * does not number anything, so there is no sequence to continue.
 */
export function buildNumberedSiblingRegExp(nameTemplate: string): null | RegExp {
  // A fresh instance: the shared regex carries the `g` flag, and `matchAll` reads its `lastIndex`.
  const tokenRegExp = new RegExp(TEMPLATE_TOKEN_REG_EXP.source, 'g');
  let hasIndexToken = false;
  let pattern = '';
  let literalStart = 0;

  for (const match of nameTemplate.matchAll(tokenRegExp)) {
    pattern += escapeRegExp(nameTemplate.slice(literalStart, match.index));
    if (getMandatoryNamedGroup(match, 'Key').toLowerCase() === INDEX_TOKEN_KEY) {
      pattern += hasIndexToken ? String.raw`\d+` : String.raw`(?<${INDEX_CAPTURE_GROUP_NAME}>\d+)`;
      hasIndexToken = true;
    } else {
      pattern += '.*';
    }
    literalStart = match.index + match[0].length;
  }

  if (!hasIndexToken) {
    return null;
  }

  pattern += escapeRegExp(nameTemplate.slice(literalStart));
  return new RegExp(`^${pattern}$`);
}

/**
 * Reads the sibling folders' existing numbering and returns the next number in the sequence (issue #191) —
 * `1 + max`, so a deleted folder in the middle never causes a collision and a gap is never backfilled.
 *
 * Only FOLDERS count as siblings; a numbered note beside them is unrelated to the folder sequence.
 *
 * @param params - The name template and the folder whose children are scanned.
 * @returns The next index, or {@link FIRST_FOLDER_INDEX} when nothing is numbered yet.
 */
export function resolveNextFolderIndex(params: ResolveNextFolderIndexParams): number {
  const { nameTemplate, parentFolder } = params;
  const siblingRegExp = buildNumberedSiblingRegExp(nameTemplate);
  if (!siblingRegExp) {
    return FIRST_FOLDER_INDEX;
  }

  let maxIndex = 0;
  for (const child of parentFolder.children) {
    if (!isFolder(child)) {
      continue;
    }

    const match = siblingRegExp.exec(child.name);
    if (!match) {
      continue;
    }

    // The group is `\d+`, so this always parses — no `NaN` branch to cover.
    maxIndex = Math.max(maxIndex, Number.parseInt(getMandatoryNamedGroup(match, INDEX_CAPTURE_GROUP_NAME), 10));
  }

  return maxIndex + 1;
}
