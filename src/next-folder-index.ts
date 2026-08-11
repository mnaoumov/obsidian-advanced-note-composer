import type { TFolder } from 'obsidian';

import { isFolder } from 'obsidian-dev-utils/obsidian/file-system';
import { getMandatoryNamedGroup } from 'obsidian-dev-utils/reg-exp';

import { buildNumberedNameRegExp } from './numbered-name.ts';

/**
 * The index a folder gets when no numbered sibling exists yet. The reporter's own plugin starts at `1`, not
 * at `0`.
 */
export const FIRST_FOLDER_INDEX = 1;

const INDEX_CAPTURE_GROUP_NAME = 'Index';

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
 * A thin delegate to {@link buildNumberedNameRegExp} asking for no base capture: this side only needs to
 * know WHETHER a sibling is numbered and with what, never what its name-without-the-index was. The default
 * `{{index}}. {{safeFolderName}}` therefore still compiles to `^(\d+)\. .*$` — precisely the `/^(\d+)\./`
 * rule the reporter's `folder-note-extended` uses.
 *
 * @param nameTemplate - The `newFolderNameTemplate` setting, as typed.
 * @returns The sibling pattern, or `null` when the template has no `{{index}}` token at all — that template
 * does not number anything, so there is no sequence to continue.
 */
export function buildNumberedSiblingRegExp(nameTemplate: string): null | RegExp {
  return buildNumberedNameRegExp({ baseTokenKey: null, nameTemplate });
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
