import { toAliasList } from '../folders/folder-note-aliases.ts';

interface AddMergedNoteAliasParams {
  /**
   * The target note's `aliases` property exactly as it came out of its frontmatter.
   */
  readonly existingAliases: unknown;

  /**
   * The merged-away note's name, which becomes the alias.
   */
  readonly sourceName: string;

  /**
   * The target note's own name.
   */
  readonly targetName: string;
}

/**
 * Adds the merged-away note's name to the target note's aliases, so searching by the old name still finds the
 * note it was merged into (the alias half of `Merge as Alias`, ported from its source; the link half is the display
 * text `updateLink` already keeps).
 *
 * Names are compared case-insensitively, as Obsidian matches aliases and file names in its switcher: an alias
 * that differs from the note's own name or an existing alias only by case finds nothing new.
 *
 * @param params - The existing property and the two names.
 * @returns The new alias list, or `null` when nothing needs adding.
 */
export function addMergedNoteAlias(params: AddMergedNoteAliasParams): null | string[] {
  const { existingAliases, sourceName, targetName } = params;
  const normalizedSourceName = sourceName.toLowerCase();
  if (sourceName.trim() === '' || normalizedSourceName === targetName.toLowerCase()) {
    return null;
  }

  const aliases = toAliasList(existingAliases);
  return aliases.some((alias) => alias.toLowerCase() === normalizedSourceName) ? null : [...aliases, sourceName];
}
