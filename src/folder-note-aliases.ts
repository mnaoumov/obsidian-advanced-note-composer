/**
 * Parameters for {@link swapDerivedAlias}.
 */
export interface SwapDerivedAliasParams {
  /**
   * The `aliases` property exactly as it came out of the note's frontmatter — `undefined` when the note has
   * none, `null` for a bare `aliases:` line, a string for the single-value `aliases: alpha` form, or an
   * array. Typed `unknown` because frontmatter is user-authored: anything at all can be in there.
   */
  readonly existingAliases: unknown;

  /**
   * The alias the folder's NEW name renders to.
   */
  readonly newAlias: string;

  /**
   * The alias the folder's OLD name rendered to — the entry this swap is entitled to overwrite, because the
   * rename is what invalidated it.
   */
  readonly oldAlias: string;
}

/**
 * Replaces the alias a folder's OLD name derived, with the one its NEW name derives, leaving every other
 * alias exactly where it was (issue #217).
 *
 * A swap rather than a wholesale rewrite, and rather than an append: the property is the user's, and only
 * the one entry the rename invalidated is ours to touch. Appending instead would make `aliases` grow by one
 * dead entry per rename, while rewriting the list would silently discard the hand-written aliases that are
 * the reason the property exists.
 *
 * The old alias is matched EXACTLY. A note whose alias was edited by hand therefore keeps it and simply
 * gains the new one — the safe direction, since the alternative is deleting an alias nothing here can prove
 * was derived.
 *
 * @param params - The existing property, and the aliases the old and new names render to.
 * @returns The new list.
 */
export function swapDerivedAlias(params: SwapDerivedAliasParams): string[] {
  const {
    existingAliases,
    newAlias,
    oldAlias
  } = params;

  const aliases = toAliasList(existingAliases);
  const oldAliasIndex = aliases.indexOf(oldAlias);

  if (oldAliasIndex === -1) {
    return aliases.includes(newAlias) ? aliases : [...aliases, newAlias];
  }

  // Written at the old alias's own position, so a rename never reorders the property. The filter then drops
  // Any OTHER copy of the new alias, which is how a rename back to a name still listed further down leaves
  // One entry rather than two.
  return aliases
    .map((alias, index) => (index === oldAliasIndex ? newAlias : alias))
    .filter((alias, index) => index === oldAliasIndex || alias !== newAlias);
}

/**
 * Reads the `aliases` property into the list this module works on, accepting every shape Obsidian itself
 * accepts.
 *
 * Anything else — a number, an object, a nested list — is dropped rather than stringified: it was never a
 * usable alias, and inventing a string for it would write the user's malformed value back in a NEW shape,
 * which is the one outcome worse than leaving it alone.
 *
 * @param existingAliases - The raw property value.
 * @returns The aliases.
 */
function toAliasList(existingAliases: unknown): string[] {
  if (typeof existingAliases === 'string') {
    return [existingAliases];
  }

  if (!Array.isArray(existingAliases)) {
    return [];
  }

  return existingAliases.filter((alias): alias is string => typeof alias === 'string');
}
