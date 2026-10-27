/**
 * Parameters for {@link swapDerivedAliases}.
 */
export interface SwapDerivedAliasesParams {
  /**
   * The `aliases` property exactly as it came out of the note's frontmatter — `undefined` when the note has
   * none, `null` for a bare `aliases:` line, a string for the single-value `aliases: alpha` form, or an
   * array. Typed `unknown` because frontmatter is user-authored: anything at all can be in there.
   */
  readonly existingAliases: unknown;

  /**
   * The aliases the folder's NEW name renders to, in the order the template produced them.
   */
  readonly newAliases: readonly string[];

  /**
   * The aliases the folder's OLD name rendered to — the entries this swap is entitled to remove, because the
   * rename is what invalidated them.
   */
  readonly oldAliases: readonly string[];
}

/**
 * Replaces the aliases a folder's OLD name derived, with the ones its NEW name derives, leaving every other
 * alias exactly where it was (issue #217, generalized to several aliases per template by issue #294).
 *
 * A swap rather than a wholesale rewrite, and rather than an append: the property is the user's, and only
 * the entries the rename invalidated are ours to touch. Appending instead would make `aliases` grow by dead
 * entries on every rename, while rewriting the list would silently discard the hand-written aliases that are
 * the reason the property exists.
 *
 * The new aliases are written, as a block, where the FIRST old alias stood, so a rename never moves the
 * derived aliases relative to the hand-written ones. Every other old alias is dropped, and so is every other
 * copy of a new one, which is how an alias present in BOTH renders ends up listed once.
 *
 * The old aliases are matched EXACTLY. A note whose alias was edited by hand therefore keeps it and simply
 * gains the new ones — the safe direction, since the alternative is deleting an alias nothing here can prove
 * was derived.
 *
 * @param params - The existing property, and the aliases the old and new names render to.
 * @returns The new list.
 */
export function swapDerivedAliases(params: SwapDerivedAliasesParams): string[] {
  const {
    existingAliases,
    newAliases,
    oldAliases
  } = params;

  const aliases = toAliasList(existingAliases);
  const uniqueNewAliases = [...new Set(newAliases)];
  const firstOldAliasIndex = aliases.findIndex((alias) => oldAliases.includes(alias));

  if (firstOldAliasIndex === -1) {
    return [...aliases, ...uniqueNewAliases.filter((alias) => !aliases.includes(alias))];
  }

  // Nothing before the first old alias is old by definition, so only copies of the new aliases go there.
  return [
    ...aliases.slice(0, firstOldAliasIndex).filter((alias) => !uniqueNewAliases.includes(alias)),
    ...uniqueNewAliases,
    ...aliases.slice(firstOldAliasIndex + 1).filter((alias) => !oldAliases.includes(alias) && !uniqueNewAliases.includes(alias))
  ];
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

  return Array.isArray(existingAliases) ? existingAliases.filter((alias): alias is string => typeof alias === 'string') : [];
}
