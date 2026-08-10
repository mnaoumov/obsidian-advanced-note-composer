/*
 * Built once and reused: a collator is expensive to construct and `localeCompare` with an options object
 * builds a throw-away one on EVERY comparison, which a sort over a folder of 50+ notes pays for
 * `n log n` times.
 */
const NATURAL_COLLATOR = new Intl.Collator(undefined, { numeric: true });

/**
 * Compares two names the way a person reads a numbered list: every run of digits counts as ONE number, and
 * everything around it compares as text. This is what issue #208 asked for — a folder tree numbered
 * `1. …`, `1.1 …`, `1.1.1 …`, `2. …` merges in that order instead of the text order that puts `30.` before
 * `5.`, because `'3' < '5'`.
 *
 * It is deliberately the GENERAL rule rather than an index-prefix parser: EVERY numeric run in the name
 * participates, at the position it appears, so `234alpha567` &lt; `1111alpha567` &lt; `1111alpha45678` — the
 * first pair decided by `234` &lt; `1111` and the second by `567` &lt; `45678`. A name with no digits in it
 * therefore sorts exactly as it did before.
 *
 * Locale-aware, like the plain `localeCompare` it replaces: the vault's names are the user's own language,
 * so `Ä` belongs where their locale puts it.
 *
 * @param a - The first name.
 * @param b - The second name.
 * @returns A negative number when `a` sorts first, a positive number when `b` does, and `0` when they tie.
 */
export function compareNatural(a: string, b: string): number {
  return NATURAL_COLLATOR.compare(a, b);
}
