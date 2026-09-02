import type { TFolder } from 'obsidian';

import {
  isFile,
  isFolder,
  isMarkdownFile
} from 'obsidian-dev-utils/obsidian/file-system';
import { getMandatoryNamedGroup } from 'obsidian-dev-utils/reg-exp';

import { buildNumberedNameRegExp } from './numbered-name.ts';
import { ReorderItemKind } from './reorder-items.ts';

/**
 * The index an item gets when no numbered sibling of its kind exists yet. The reporter's own plugin starts
 * at `1`, not at `0`.
 */
export const FIRST_SIBLING_INDEX = 1;

/**
 * Parameters for {@link resolveNextSiblingIndex}.
 */
export interface ResolveNextSiblingIndexParams {
  /**
   * Which siblings form the sequence — {@link ReorderItemKind.Folder} scans the child FOLDERS,
   * {@link ReorderItemKind.File} the child NOTES.
   */
  readonly kind: ReorderItemKind;

  /**
   * The name template that numbers this kind, as typed into its setting.
   */
  readonly nameTemplate: string;

  /**
   * The folder the new item is created in — its children are the siblings that get scanned.
   */
  readonly parentFolder: TFolder;
}

const INDEX_CAPTURE_GROUP_NAME = 'Index';

/**
 * Derives, from a name template, the pattern that recognizes an already-numbered sibling.
 *
 * A thin delegate to {@link buildNumberedNameRegExp} asking for no base capture: this side only needs to
 * know WHETHER a sibling is numbered and with what, never what its name-without-the-index was. The default
 * `{{index}}. {{safeFolderName}}` therefore compiles to `^(\d+)\. .*$` — precisely the `/^(\d+)\./` rule
 * the reporter's `folder-note-extended` uses.
 *
 * @param nameTemplate - The name template, as typed.
 * @returns The sibling pattern, or `null` when the template has no `{{index}}` token at all — that template
 * does not number anything, so there is no sequence to continue.
 */
export function buildNumberedSiblingRegExp(nameTemplate: string): null | RegExp {
  return buildNumberedNameRegExp({ baseTokenKey: null, nameTemplate });
}

/**
 * Reads the existing numbering of an item's siblings and returns the next number in the sequence —
 * `1 + max`, so a deleted item in the middle never causes a collision and a gap is never backfilled
 * (issues #191 and #269). The reporter of #269 spelled that out: `1, 3, 4` continues at `5`, not at `2`
 * and not at `4`.
 *
 * Only siblings of the SAME KIND count. A numbered note beside a numbered folder belongs to a different
 * sequence, and treating the two as one would make the number a folder gets depend on notes that have
 * nothing to do with it.
 *
 * @param params - The kind, the name template, and the folder whose children are scanned.
 * @returns The next index, or {@link FIRST_SIBLING_INDEX} when nothing of that kind is numbered yet.
 */
export function resolveNextSiblingIndex(params: ResolveNextSiblingIndexParams): number {
  const { kind, nameTemplate, parentFolder } = params;
  const siblingRegExp = buildNumberedSiblingRegExp(nameTemplate);
  if (!siblingRegExp) {
    return FIRST_SIBLING_INDEX;
  }

  let maxIndex = 0;
  for (const child of parentFolder.children) {
    const name = resolveSiblingName(child, kind);
    if (name === null) {
      continue;
    }

    const match = siblingRegExp.exec(name);
    if (!match) {
      continue;
    }

    // The group is `\d+`, so this always parses — no `NaN` branch to cover.
    maxIndex = Math.max(maxIndex, Number.parseInt(getMandatoryNamedGroup(match, INDEX_CAPTURE_GROUP_NAME), 10));
  }

  return maxIndex + 1;
}

/**
 * The name a child contributes to the sequence, or `null` when it is not part of it at all.
 *
 * A file contributes its BASENAME, never its extension: the templates that number files
 * (`reorderedFileNameTemplate`, `numberedSplitNoteNameTemplate`) name the basename, so matching against
 * `1. Alpha.md` would never recognize `1. Alpha`. Non-markdown files are skipped along with folders of the
 * wrong kind — an attachment named `9. diagram.png` is not part of a note sequence.
 *
 * @param child - The child to classify.
 * @param kind - The kind whose sequence is being read.
 * @returns The name to match, or `null` to skip the child.
 */
function resolveSiblingName(child: TFolder['children'][number], kind: ReorderItemKind): null | string {
  if (kind === ReorderItemKind.Folder) {
    return isFolder(child) ? child.name : null;
  }

  return isFile(child) && isMarkdownFile(child) ? child.basename : null;
}
