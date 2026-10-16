/**
 * @file
 *
 * The runtime half of this plugin's published API: its CONTRACT, one entry per method of
 * {@link AdvancedMetadataCacheApi}, each with a schema over the argument list and a schema over the
 * value the method returns (awaited, for the `Safe` methods).
 *
 * This plugin publishes exactly this constant with its API, and a consumer copies it beside `api.d.ts`
 * and passes it as the `contract` when it looks the API up, so both ends validate against ONE
 * definition. The plugin registry checks the payloads against it only while its debugger is on.
 *
 * The contract types, the {@link https://standardschema.dev | Standard Schema} builders and the common
 * guards come from `@mnaoumov/typescript-lib/api-contract`, so a consumer copying this file needs that
 * package; `api.d.ts` itself still imports from `obsidian` alone. What is left here is the constant and
 * the guards only this API has. `defineApiContract` checks every entry against its method's signature.
 */

import type { TypedApiContract } from '@mnaoumov/typescript-lib/api-contract';
import type { Reference } from 'obsidian';

import {
  createArgumentsSchema,
  createTypeGuardSchema,
  defineApiContract,
  nullableGuard,
  STRING_ARRAY_GUARD,
  STRING_GUARD
} from '@mnaoumov/typescript-lib/api-contract';
import { isStringArray } from '@mnaoumov/typescript-lib/type-guards';
import { TFile } from 'obsidian';

import type {
  AdvancedMetadataCacheApi,
  CustomArrayDict,
  HeadingTimes,
  LinkSuggestion,
  MigrateSettingsParams,
  MigrateSettingsResult
} from './api.d.ts';

/**
 * The type of {@link ADVANCED_METADATA_CACHE_API_CONTRACT}: one entry per method of
 * {@link AdvancedMetadataCacheApi}, each typed against that method's parameters and awaited return value.
 */
export type AdvancedMetadataCacheApiContract = TypedApiContract<AdvancedMetadataCacheApi>;

const BACKLINKS_DICT_GUARD = { expected: 'a backlinks dictionary', typeGuard: isBacklinksDict };
const LINK_SUGGESTION_ARRAY_GUARD = { expected: 'an array of link suggestions', typeGuard: isLinkSuggestionArray };
const NAME_GUARD = { ...STRING_GUARD, expected: 'a name' };
const PATH_OR_FILE_GUARD = { expected: 'a path or a file', typeGuard: isPathOrFile };

/**
 * The contract this plugin publishes with {@link AdvancedMetadataCacheApi}, for a consumer to pass as the
 * `contract` when it looks the API up.
 */
export const ADVANCED_METADATA_CACHE_API_CONTRACT: AdvancedMetadataCacheApiContract = defineApiContract<AdvancedMetadataCacheApi>({
  getBacklinksForFile: {
    input: createArgumentsSchema([PATH_OR_FILE_GUARD]),
    output: createTypeGuardSchema(nullableGuard(BACKLINKS_DICT_GUARD))
  },
  getBacklinksForFileOriginal: {
    input: createArgumentsSchema([{ expected: 'a file', typeGuard: isFile }]),
    output: createTypeGuardSchema(BACKLINKS_DICT_GUARD)
  },
  getBacklinksForFileSafe: {
    input: createArgumentsSchema([PATH_OR_FILE_GUARD]),
    output: createTypeGuardSchema(nullableGuard(BACKLINKS_DICT_GUARD))
  },
  getHeadingTimes: {
    input: createArgumentsSchema([PATH_OR_FILE_GUARD]),
    output: createTypeGuardSchema({ expected: 'an array of heading times', typeGuard: isHeadingTimesArray })
  },
  getLinkSuggestions: {
    input: createArgumentsSchema([]),
    output: createTypeGuardSchema(nullableGuard(LINK_SUGGESTION_ARRAY_GUARD))
  },
  getLinkSuggestionsOriginal: {
    input: createArgumentsSchema([]),
    output: createTypeGuardSchema(LINK_SUGGESTION_ARRAY_GUARD)
  },
  getLinkSuggestionsSafe: {
    input: createArgumentsSchema([]),
    output: createTypeGuardSchema(nullableGuard(LINK_SUGGESTION_ARRAY_GUARD))
  },
  getPathsByName: {
    input: createArgumentsSchema([NAME_GUARD]),
    output: createTypeGuardSchema(nullableGuard({ ...STRING_ARRAY_GUARD, expected: 'an array of paths' }))
  },
  getPathsByNameSafe: {
    input: createArgumentsSchema([NAME_GUARD]),
    output: createTypeGuardSchema(nullableGuard({ ...STRING_ARRAY_GUARD, expected: 'an array of paths' }))
  },
  getTitlePropertyNames: {
    input: createArgumentsSchema([]),
    output: createTypeGuardSchema({ ...STRING_ARRAY_GUARD, expected: 'an array of property names' })
  },
  getTitles: {
    input: createArgumentsSchema([PATH_OR_FILE_GUARD]),
    output: createTypeGuardSchema({ ...STRING_ARRAY_GUARD, expected: 'an array of titles' })
  },
  migrateSettings: {
    input: createArgumentsSchema([{ expected: 'migrate settings params', typeGuard: isMigrateSettingsParams }]),
    output: createTypeGuardSchema({ expected: 'a migrate settings result', typeGuard: isMigrateSettingsResult })
  }
});

function isArrayOf<T>(value: unknown, isValid: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every((item) => isValid(item));
}

function isBacklinksDict(value: unknown): value is CustomArrayDict<Reference> {
  return isObject(value)
    && Reflect.get(value, 'data') instanceof Map
    && typeof Reflect.get(value, 'get') === 'function'
    && typeof Reflect.get(value, 'keys') === 'function';
}

function isFile(value: unknown): value is TFile {
  return value instanceof TFile;
}

function isHeadingTimes(value: unknown): value is HeadingTimes {
  return isObject(value)
    && isNullableNumber(Reflect.get(value, 'created'))
    && typeof Reflect.get(value, 'heading') === 'string'
    && typeof Reflect.get(value, 'level') === 'number'
    && typeof Reflect.get(value, 'line') === 'number'
    && isNullableNumber(Reflect.get(value, 'modified'))
    && isNullableNumber(Reflect.get(value, 'seen'));
}

function isHeadingTimesArray(value: unknown): value is HeadingTimes[] {
  return isArrayOf(value, isHeadingTimes);
}

function isLinkSuggestion(value: unknown): value is LinkSuggestion {
  if (!isObject(value)) {
    return false;
  }

  const alias: unknown = Reflect.get(value, 'alias');
  const file: unknown = Reflect.get(value, 'file');
  return (alias === undefined || typeof alias === 'string')
    && (file === null || isFile(file))
    && typeof Reflect.get(value, 'path') === 'string';
}

function isLinkSuggestionArray(value: unknown): value is LinkSuggestion[] {
  return isArrayOf(value, isLinkSuggestion);
}

function isMigrateSettingsParams(value: unknown): value is MigrateSettingsParams {
  if (!isObject(value) || typeof Reflect.get(value, 'sourcePluginId') !== 'string') {
    return false;
  }

  const proposedSettings: unknown = Reflect.get(value, 'proposedSettings');
  if (!isObject(proposedSettings)) {
    return false;
  }

  const titlePropertyNames: unknown = Reflect.get(proposedSettings, 'titlePropertyNames');
  return titlePropertyNames === undefined || isStringArray(titlePropertyNames);
}

function isMigrateSettingsResult(value: unknown): value is MigrateSettingsResult {
  return isObject(value) && typeof Reflect.get(value, 'isApplied') === 'boolean';
}

function isNullableNumber(value: unknown): value is null | number {
  return value === null || typeof value === 'number';
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function isPathOrFile(value: unknown): value is string | TFile {
  return typeof value === 'string' || isFile(value);
}
