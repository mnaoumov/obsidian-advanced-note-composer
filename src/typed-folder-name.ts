import type { App } from 'obsidian';
import type { MaybeReturn } from 'obsidian-dev-utils/type';

import type { PluginSettings } from './plugin-settings.ts';

import { normalizeTypedFolderName } from './create-folder-name.ts';
import { INVALID_CHARACTERS_REG_EXP } from './filename-validation.ts';
import {
  applyNameTransform,
  NameTransformError
} from './name-transform.ts';

/**
 * Parameters for {@link normalizeTypedFolderNameWithTransform}.
 */
export interface NormalizeTypedFolderNameWithTransformParams {
  readonly app: App;

  /**
   * The name exactly as the user typed it into the prompt.
   */
  readonly rawName: string;

  /**
   * Exactly the settings a typed folder name is normalized by — a `Pick` rather than the whole object, so a
   * caller holding the deep-readonly settings can pass them straight in.
   */
  readonly settings: Pick<PluginSettings, 'nameTransformTemplate' | 'replacement' | 'shouldReplaceInvalidTitleCharacters'>;

  /**
   * Whether the Title Case pass runs. A decision of the CALLER's rather than of the setting, because the two
   * prompts differ: `Create folder with notes...` names a folder that does not exist yet and title-cases it
   * per `shouldTitleCaseCreatedFolderName`, while `Rename folder...` seeds the prompt with the folder's
   * EXISTING name — title-casing there would rewrite letters the user never typed, turning an untouched
   * `iOS` into `Ios` merely because the prompt was confirmed.
   */
  readonly shouldTitleCase: boolean;
}

/**
 * Parameters for {@link validateTypedFolderName} — the same ones, since it judges a name by normalizing it.
 */
export type ValidateTypedFolderNameParams = NormalizeTypedFolderNameWithTransformParams;

/**
 * Applies the `Name transform template` and then the shared folder-name normalization, in that order.
 *
 * The transform runs FIRST, on the untouched typed text (issue #196) — that is what `{{rawString}}` means,
 * and running it after the invalid-character pass would leave it nothing to map.
 *
 * Shared by every prompt that takes a folder name so that the name which was ACCEPTED and the name that is
 * actually written can never diverge — {@link validateTypedFolderName} judges a name by running this very
 * function.
 *
 * @param params - The typed name and the settings governing how it is normalized.
 * @returns The normalized name, or an empty string when nothing usable was typed.
 */
export async function normalizeTypedFolderNameWithTransform(params: NormalizeTypedFolderNameWithTransformParams): Promise<string> {
  const {
    app,
    rawName,
    settings,
    shouldTitleCase
  } = params;

  return normalizeTypedFolderName({
    rawName: await applyNameTransform({
      app,
      // These commands work on a folder, so they have no note of their own to offer — the Templater context
      // Is left to the shared fallback chain, which does not require one to be open (issue #218).
      contextFile: null,
      rawString: rawName,
      template: settings.nameTransformTemplate
    }),
    replacement: settings.replacement,
    shouldReplaceInvalidCharacters: settings.shouldReplaceInvalidTitleCharacters,
    shouldTitleCase
  });
}

/**
 * Validates what was typed into a folder-name prompt, in the terms the user typed it.
 *
 * A broken `Name transform template` is reported HERE rather than being allowed to escape (issue #196): the
 * prompt is the one place that can say what went wrong and re-ask with the typed text intact, and every
 * later use of the template runs on a name this validator already accepted.
 *
 * @param params - The typed name and the settings governing how it is normalized.
 * @returns The error message, or nothing when the name is usable.
 */
export async function validateTypedFolderName(params: ValidateTypedFolderNameParams): Promise<MaybeReturn<string>> {
  let normalizedName: string;
  try {
    normalizedName = await normalizeTypedFolderNameWithTransform(params);
  } catch (error) {
    /* v8 ignore next 3 -- the transform is the only thing here that throws, and it throws nothing else. */
    if (!(error instanceof NameTransformError)) {
      throw error;
    }
    return error.message;
  }

  if (!normalizedName) {
    return 'Folder name cannot be empty';
  }

  // Only reachable with `Should replace invalid title characters` off, which leaves the characters in
  // Place for the user to fix — the same choice the reporter's own plugin makes.
  if (new RegExp(INVALID_CHARACTERS_REG_EXP.source).test(normalizedName)) {
    return 'Folder name contains invalid characters';
  }
}
