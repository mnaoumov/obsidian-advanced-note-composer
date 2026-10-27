/**
 * Matches a single `{{Key}}` / `{{Key:Format}}` template placeholder. Shared by every resolver in
 * `template-tokens.ts` and by the settings validators, so all of them agree on what counts as a token.
 *
 * It lives in a module of its own rather than beside those resolvers because `numbered-name.ts` builds a
 * PARSER out of a name template and therefore needs the same grammar, while `template-tokens.ts` resolves
 * `{{safeFolderName}}` / `{{index}}` THROUGH `parseNumberedName` (issue #227) — so with the constant kept
 * next to the resolvers the two modules would import each other, which `import-x/no-cycle` refuses.
 * `template-tokens.ts` re-exports it, so nothing that already imported it from there had to change.
 */
export const TEMPLATE_TOKEN_REG_EXP = /{{(?<Key>.+?)(?::(?<Format>.+?))?}}/g;
