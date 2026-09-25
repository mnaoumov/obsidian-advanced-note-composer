import { fixFileName } from './filename-validation.ts';

const LEADING_OR_TRAILING_DOTS_REG_EXP = /^\.+|\.+$/g;

/**
 * The shortest word that can be an acronym. Below it the acronym rule is indistinguishable from ordinary
 * title-casing anyway — a lone `A` is already its own upper-case — so the length test only ever decides
 * real words.
 */
const MIN_ACRONYM_LENGTH = 2;

const TITLE_CASE_SEPARATOR_REG_EXP = /^(?:\s+|-)$/;

/**
 * Splits a name into title-casing units: the words AND the separators between them. The separator is a
 * capture group, so it survives the split and `join('')` puts it back exactly where it was — which is what
 * keeps `Foo - Bar` and `Foo-Bar` distinguishable.
 */
const TITLE_CASE_UNIT_REG_EXP = /(?<Separator>\s+|-)/;

const WHITESPACE_RUN_REG_EXP = /\s+/g;

/**
 * Parameters for {@link cleanTypedName}.
 */
export interface CleanTypedNameParams {
  /**
   * The name exactly as the user typed it.
   */
  readonly rawName: string;

  /**
   * Whether the Title Case pass runs.
   */
  readonly shouldTitleCase: boolean;
}

/**
 * Parameters for {@link normalizeTypedFolderName}.
 */
export interface NormalizeTypedFolderNameParams {
  /**
   * The folder name exactly as the user typed it into the prompt.
   */
  readonly rawName: string;

  /**
   * The string each invalid character is replaced with (the `replacement` setting).
   */
  readonly replacement: string;

  /**
   * Whether invalid characters are replaced at all (the `shouldReplaceInvalidTitleCharacters` setting).
   */
  readonly shouldReplaceInvalidCharacters: boolean;

  /**
   * Whether the Title Case pass runs (the `shouldTitleCaseCreatedFolderName` setting).
   */
  readonly shouldTitleCase: boolean;
}

/**
 * The cleaning half of {@link normalizeTypedFolderName}, everything BEFORE the invalid-character pass: trim,
 * drop leading/trailing dots, collapse every whitespace run to one space, and optionally Title Case.
 *
 * Exported on its own because a typed NOTE name is cleaned by the same rules (issue #283) but then goes
 * through `createNoteFromTypedName`, which owns the name transform and the invalid-character pass for notes.
 *
 * @param params - The typed name and whether to Title Case it.
 * @returns The cleaned name, or an empty string when nothing but whitespace and dots was typed.
 */
export function cleanTypedName(params: CleanTypedNameParams): string {
  const collapsedName = params.rawName
    .trim()
    .replaceAll(LEADING_OR_TRAILING_DOTS_REG_EXP, '')
    .replaceAll(WHITESPACE_RUN_REG_EXP, ' ')
    .trim();

  return params.shouldTitleCase ? toTitleCase(collapsedName) : collapsedName;
}

/**
 * Turns the name typed into the `Create folder with notes...` prompt into the normalized name the folder is
 * actually created under (issue #191), in the order the reporter's own `folder-note-extended` plugin applies
 * them: trim, drop leading/trailing dots, collapse every whitespace run to one space, Title Case, and only
 * then hand the result to the shared {@link fixFileName}.
 *
 * The dots are **stripped** rather than left to `fixFileName`, which would replace them with the
 * `replacement` string — `.Notes.` should become `Notes`, not `_Notes_`.
 *
 * Invalid characters are deliberately NOT given a second setting of their own: the plugin already has
 * `shouldReplaceInvalidTitleCharacters` + `replacement`, and reusing them is what keeps this command's
 * idea of a valid name identical to the split/merge target names'.
 *
 * @param params - The typed name and the settings governing how it is normalized.
 * @returns The normalized name, or an empty string when nothing usable was typed (the caller reports that
 * as a validation error rather than silently creating `Untitled`).
 */
export function normalizeTypedFolderName(params: NormalizeTypedFolderNameParams): string {
  const {
    rawName,
    replacement,
    shouldReplaceInvalidCharacters,
    shouldTitleCase
  } = params;

  const casedName = cleanTypedName({ rawName, shouldTitleCase });
  if (!casedName) {
    return '';
  }

  return fixFileName({
    fileName: casedName,
    replacement,
    shouldReplaceInvalidCharacters,
    // A typed folder name names ONE folder: a `/` in it collapses into the name instead of silently
    // creating a nested tree the prompt never showed.
    shouldTreatTitleAsPath: false
  });
}

/**
 * Capitalizes the first letter of each word and lower-cases the rest, EXCEPT a word that is already
 * entirely upper-case, which is left alone so an acronym survives (`api TEST` becomes `Api TEST`).
 *
 * @param name - The whitespace-collapsed name.
 * @returns The title-cased name.
 */
function toTitleCase(name: string): string {
  return name
    .split(TITLE_CASE_UNIT_REG_EXP)
    .map((unit) => {
      if (!unit || TITLE_CASE_SEPARATOR_REG_EXP.test(unit)) {
        return unit;
      }

      return unit.length >= MIN_ACRONYM_LENGTH && unit === unit.toUpperCase() ? unit : unit.charAt(0).toUpperCase() + unit.slice(1).toLowerCase();
    })
    .join('');
}
