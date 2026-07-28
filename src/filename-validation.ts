export const INVALID_CHARACTERS_REG_EXP = /[*\\<>:|?#^[\]"]+/g;
export const TRAILING_DOTS_OR_SPACES_REG_EXP = /[ .]+$/g;

/**
 * Parameters for {@link fixFileName}.
 */
export interface FixFileNameParams {
  /**
   * The raw, user-supplied name to sanitize (without the `.md` extension).
   */
  readonly fileName: string;

  /**
   * The string each invalid character is replaced with. Empty removes the character instead.
   */
  readonly replacement: string;

  /**
   * Whether invalid characters are replaced at all. When `false` the name is returned as typed (minus the
   * path collapsing below), so the caller can report it as invalid rather than silently rewriting it.
   */
  readonly shouldReplaceInvalidCharacters: boolean;

  /**
   * Whether `/` keeps its meaning as a path separator. When `false`, a slash is folded into a backslash
   * first, which {@link INVALID_CHARACTERS_REG_EXP} then replaces — so a path-shaped name collapses into
   * one segment.
   */
  readonly shouldTreatTitleAsPath: boolean;
}

const UNTITLED = 'Untitled';

/**
 * Sanitizes a user-supplied note name so it can be used as a file name: invalid characters and trailing
 * dots/spaces are replaced, and a leading dot or space is replaced too (Obsidian treats a dot-leading
 * name as hidden). Empty segments are dropped, and an empty name becomes `Untitled`.
 *
 * Shared by every flow that turns typed text into a file name — the split/extract target
 * (`SplitItemSelector`) and the folder-merge target name — so they all agree on what a valid name is.
 *
 * @param params - The name to sanitize and the settings governing how.
 * @returns The sanitized name.
 */
export function fixFileName(params: FixFileNameParams): string {
  const {
    replacement,
    shouldReplaceInvalidCharacters,
    shouldTreatTitleAsPath
  } = params;
  let { fileName } = params;

  if (!fileName) {
    return UNTITLED;
  }

  if (!shouldTreatTitleAsPath) {
    fileName = fileName.replaceAll('/', '\\');
  }

  if (!shouldReplaceInvalidCharacters) {
    return fileName;
  }

  const parts = fileName.split('/');
  const fixedParts = parts.filter((part) => !!part).map((part) => {
    let fixedPart = part;
    fixedPart = fixedPart.replaceAll(INVALID_CHARACTERS_REG_EXP, (substring) => replacement.repeat(substring.length));
    fixedPart = fixedPart.replaceAll(TRAILING_DOTS_OR_SPACES_REG_EXP, (substring) => replacement.repeat(substring.length));
    if (fixedPart.startsWith('.') || fixedPart.startsWith(' ')) {
      fixedPart = replacement + fixedPart.slice(1);
    }
    return fixedPart;
  });
  return fixedParts.join('/');
}
