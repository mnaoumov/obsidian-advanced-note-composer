import type { FrontMatterInfo } from 'obsidian';
import type { GenericObject } from 'obsidian-dev-utils/type-guards';

import {
  getFrontMatterInfo,
  parseYaml
} from 'obsidian';

/**
 * A note's content split into its frontmatter and everything below it.
 */
export interface ExtractFrontmatterResult {
  /**
   * The content below the frontmatter block (the whole string when there is none).
   */
  readonly content: string;

  /**
   * The parsed frontmatter, or an empty object when there is none (or it does not parse).
   */
  readonly frontmatter: Frontmatter;
}

/**
 * The frontmatter of a note, as parsed from its YAML block. `title` is called out because several flows
 * treat it specially (a merge relocates the source note and keeps its title, a split's new-file title is
 * governed by `frontmatterTitleMode` instead).
 */
export interface Frontmatter extends GenericObject {
  title?: string;
}

/**
 * Parameters for {@link mergeRecursively}.
 */
export interface MergeRecursivelyParams {
  /**
   * The object whose values win.
   */
  readonly newObj: GenericObject;

  /**
   * The object merged into, IN PLACE, and returned.
   */
  readonly oldObj: GenericObject;
}

/**
 * Splits a note's content into its parsed frontmatter and the content below it. An non-parsing YAML block
 * is not frontmatter at all: it is left as part of the content, so a broken block is never silently
 * swallowed.
 *
 * @param str - The note content.
 * @returns The frontmatter and the content below it.
 */
export function extractFrontmatter(str: string): ExtractFrontmatterResult {
  const frontmatterInfo = getFrontMatterInfo(str);
  // NOTE: on a parse failure this resets `frontmatterInfo.contentStart` to 0, which is what keeps the
  // Broken block in the content below.
  const frontmatter = safeParseFrontmatter(frontmatterInfo);

  return {
    content: str.slice(frontmatterInfo.contentStart),
    frontmatter
  };
}

/**
 * Deep-merges {@link MergeRecursivelyParams.newObj} into {@link MergeRecursivelyParams.oldObj}, with the new
 * values winning: nested objects merge recursively, arrays union with duplicates removed, and a
 * `null`/`undefined` old value is simply replaced.
 *
 * @param params - The objects to merge.
 * @returns `oldObj`, mutated in place.
 */
export function mergeRecursively(params: MergeRecursivelyParams): GenericObject {
  const { newObj, oldObj } = params;
  const oldKeys = Object.keys(oldObj);
  for (const [newKey, newValue] of Object.entries(newObj)) {
    if (oldKeys.includes(newKey)) {
      const oldValue = oldObj[newKey];
      if (oldValue === undefined || oldValue === null) {
        oldObj[newKey] = newValue;
      } else if (Array.isArray(oldObj[newKey]) && Array.isArray(newValue)) {
        oldObj[newKey] = [...oldObj[newKey], ...newValue].unique();
      } else if (typeof oldObj[newKey] === 'object' && typeof newValue === 'object') {
        oldObj[newKey] = mergeRecursively({ newObj: newValue as GenericObject, oldObj: oldObj[newKey] as GenericObject });
      } else {
        oldObj[newKey] = newValue;
      }
    } else {
      oldObj[newKey] = newValue;
    }
  }
  return oldObj;
}

/**
 * Parses a frontmatter block, treating an non-parsing one as no frontmatter at all — and rewinding
 * `contentStart` to `0` so the caller keeps the broken block as content instead of dropping it.
 *
 * @param frontmatterInfo - The frontmatter info to parse, mutated on a parse failure.
 * @returns The parsed frontmatter, or an empty object.
 */
function safeParseFrontmatter(frontmatterInfo: FrontMatterInfo): Frontmatter {
  try {
    return (parseYaml(frontmatterInfo.frontmatter) as Frontmatter | null) ?? {};
  } catch {
    frontmatterInfo.contentStart = 0;
    return {};
  }
}
