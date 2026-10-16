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
 * Copyable for the same reason `api.d.ts` is: it imports from `obsidian` and `./api.d.ts` and nothing
 * else. So the schemas are hand-written {@link https://standardschema.dev | Standard Schema} objects
 * rather than built with a schema library, and the constant is typed structurally rather than as a
 * registry type. A consumer on a library whose contract type is generic over the API (such as
 * `PluginApiContract<AdvancedMetadataCacheApi>`) can assign the constant to it, which checks every entry
 * against its method's signature.
 */

import type { Reference } from 'obsidian';

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
export type AdvancedMetadataCacheApiContract = {
  readonly [TMethodName in keyof AdvancedMetadataCacheApi]: AdvancedMetadataCacheApiMethodContract<
    Parameters<AdvancedMetadataCacheApi[TMethodName]>,
    Awaited<ReturnType<AdvancedMetadataCacheApi[TMethodName]>>
  >;
};

/**
 * The payload schemas of one method.
 *
 * @typeParam TParameters - The method's parameters.
 * @typeParam TReturnValue - The method's return value, awaited.
 */
export interface AdvancedMetadataCacheApiMethodContract<TParameters, TReturnValue> {
  /**
   * Validates the method's arguments, as an array.
   */
  readonly input: AdvancedMetadataCacheApiSchema<TParameters>;

  /**
   * Validates the method's return value, or the value it resolves to.
   */
  readonly output: AdvancedMetadataCacheApiSchema<TReturnValue>;
}

/**
 * A {@link https://standardschema.dev | Standard Schema} (`StandardSchemaV1<unknown, T>`), restated with
 * only the members this file uses so it needs no dependency for them.
 *
 * @typeParam T - The type a value that passes is.
 */
export interface AdvancedMetadataCacheApiSchema<T> {
  /**
   * The Standard Schema properties.
   */
  readonly '~standard': AdvancedMetadataCacheApiSchemaProps<T>;
}

/**
 * The result of a value that failed {@link AdvancedMetadataCacheApiSchema}'s `validate`.
 */
export interface AdvancedMetadataCacheApiSchemaFailure {
  /**
   * What was wrong with the value.
   */
  readonly issues: readonly AdvancedMetadataCacheApiSchemaIssue[];
}

/**
 * One thing wrong with a value.
 */
export interface AdvancedMetadataCacheApiSchemaIssue {
  /**
   * What was expected.
   */
  readonly message: string;

  /**
   * Where in the value, e.g. `[0]` for the first argument; absent for the value as a whole.
   */
  readonly path?: readonly PropertyKey[];
}

/**
 * The Standard Schema properties of {@link AdvancedMetadataCacheApiSchema}.
 *
 * @typeParam T - The type a value that passes is.
 */
export interface AdvancedMetadataCacheApiSchemaProps<T> {
  /**
   * The inferred types, present for type inference only.
   */
  readonly types?: AdvancedMetadataCacheApiSchemaTypes<T> | undefined;

  /**
   * Validates a value.
   *
   * @param value - The value to validate.
   * @returns The value when it passes; otherwise the issues found.
   */
  readonly validate: (value: unknown) => AdvancedMetadataCacheApiSchemaResult<T>;

  /**
   * Who made the schema.
   */
  readonly vendor: string;

  /**
   * The Standard Schema version.
   */
  readonly version: 1;
}

/**
 * The result of {@link AdvancedMetadataCacheApiSchema}'s `validate`.
 *
 * @typeParam T - The type a value that passes is.
 */
export type AdvancedMetadataCacheApiSchemaResult<T> = AdvancedMetadataCacheApiSchemaFailure | AdvancedMetadataCacheApiSchemaSuccess<T>;

/**
 * The result of a value that passed {@link AdvancedMetadataCacheApiSchema}'s `validate`.
 *
 * @typeParam T - The type a value that passes is.
 */
export interface AdvancedMetadataCacheApiSchemaSuccess<T> {
  /**
   * Absent on success.
   */
  readonly issues?: undefined;

  /**
   * The value.
   */
  readonly value: T;
}

/**
 * The types a schema infers, present for type inference only.
 *
 * @typeParam T - The type a value that passes is.
 */
export interface AdvancedMetadataCacheApiSchemaTypes<T> {
  /**
   * The type the schema accepts.
   */
  readonly input: unknown;

  /**
   * The type a value that passes is.
   */
  readonly output: T;
}

type ArgumentSchemaParams<TParameters extends readonly unknown[]> = {
  readonly [TIndex in keyof TParameters]: ValueSchemaParams<TParameters[TIndex]>;
};

interface ValueSchemaParams<T> {
  readonly expected: string;
  readonly isValid: (value: unknown) => value is T;
}

const VENDOR = 'advanced-metadata-cache';

const PATH_OR_FILE: ValueSchemaParams<string | TFile> = {
  expected: 'a path or a file',
  isValid: isPathOrFile
};

/**
 * The contract this plugin publishes with {@link AdvancedMetadataCacheApi}, for a consumer to pass as the
 * `contract` when it looks the API up.
 */
export const ADVANCED_METADATA_CACHE_API_CONTRACT: AdvancedMetadataCacheApiContract = {
  getBacklinksForFile: {
    input: createArgumentsSchema<[pathOrFile: string | TFile]>([PATH_OR_FILE]),
    output: createValueSchema({ expected: 'a backlinks dictionary or null', isValid: isNullableBacklinksDict })
  },
  getBacklinksForFileOriginal: {
    input: createArgumentsSchema<[file: TFile]>([{ expected: 'a file', isValid: isFile }]),
    output: createValueSchema({ expected: 'a backlinks dictionary', isValid: isBacklinksDict })
  },
  getBacklinksForFileSafe: {
    input: createArgumentsSchema<[pathOrFile: string | TFile]>([PATH_OR_FILE]),
    output: createValueSchema({ expected: 'a backlinks dictionary or null', isValid: isNullableBacklinksDict })
  },
  getHeadingTimes: {
    input: createArgumentsSchema<[pathOrFile: string | TFile]>([PATH_OR_FILE]),
    output: createValueSchema({ expected: 'an array of heading times', isValid: isHeadingTimesArray })
  },
  getLinkSuggestions: {
    input: createArgumentsSchema<[]>([]),
    output: createValueSchema({ expected: 'an array of link suggestions or null', isValid: isNullableLinkSuggestionArray })
  },
  getLinkSuggestionsOriginal: {
    input: createArgumentsSchema<[]>([]),
    output: createValueSchema({ expected: 'an array of link suggestions', isValid: isLinkSuggestionArray })
  },
  getLinkSuggestionsSafe: {
    input: createArgumentsSchema<[]>([]),
    output: createValueSchema({ expected: 'an array of link suggestions or null', isValid: isNullableLinkSuggestionArray })
  },
  getPathsByName: {
    input: createArgumentsSchema<[name: string]>([{ expected: 'a name', isValid: isString }]),
    output: createValueSchema({ expected: 'an array of paths or null', isValid: isNullableStringArray })
  },
  getPathsByNameSafe: {
    input: createArgumentsSchema<[name: string]>([{ expected: 'a name', isValid: isString }]),
    output: createValueSchema({ expected: 'an array of paths or null', isValid: isNullableStringArray })
  },
  getTitlePropertyNames: {
    input: createArgumentsSchema<[]>([]),
    output: createValueSchema({ expected: 'an array of property names', isValid: isStringArray })
  },
  getTitles: {
    input: createArgumentsSchema<[pathOrFile: string | TFile]>([PATH_OR_FILE]),
    output: createValueSchema({ expected: 'an array of titles', isValid: isStringArray })
  },
  migrateSettings: {
    input: createArgumentsSchema<[params: MigrateSettingsParams]>([{ expected: 'migrate settings params', isValid: isMigrateSettingsParams }]),
    output: createValueSchema({ expected: 'a migrate settings result', isValid: isMigrateSettingsResult })
  }
};

function createArgumentsSchema<TParameters extends readonly unknown[]>(
  parameters: ArgumentSchemaParams<TParameters>
): AdvancedMetadataCacheApiSchema<TParameters> {
  const parameterList: readonly ValueSchemaParams<unknown>[] = parameters;

  function getIssues(value: unknown): AdvancedMetadataCacheApiSchemaIssue[] {
    if (!Array.isArray(value)) {
      return [{ message: 'Expected an argument list.' }];
    }

    return value.length > parameterList.length
      ? [{ message: `Expected at most ${String(parameterList.length)} argument(s), got ${String(value.length)}.` }]
      : parameterList.flatMap((parameter, index) => parameter.isValid(value[index]) ? [] : [{ message: `Expected ${parameter.expected}.`, path: [index] }]);
  }

  function isArgumentList(value: unknown): value is TParameters {
    return getIssues(value).length === 0;
  }

  return createSchema((value) => isArgumentList(value) ? { value } : { issues: getIssues(value) });
}

function createSchema<T>(validate: (value: unknown) => AdvancedMetadataCacheApiSchemaResult<T>): AdvancedMetadataCacheApiSchema<T> {
  return {
    '~standard': {
      validate,
      vendor: VENDOR,
      version: 1
    }
  };
}

function createValueSchema<T>(params: ValueSchemaParams<T>): AdvancedMetadataCacheApiSchema<T> {
  return createSchema((value) => params.isValid(value) ? { value } : { issues: [{ message: `Expected ${params.expected}.` }] });
}

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

function isNullableBacklinksDict(value: unknown): value is CustomArrayDict<Reference> | null {
  return value === null || isBacklinksDict(value);
}

function isNullableLinkSuggestionArray(value: unknown): value is LinkSuggestion[] | null {
  return value === null || isLinkSuggestionArray(value);
}

function isNullableNumber(value: unknown): value is null | number {
  return value === null || typeof value === 'number';
}

function isNullableStringArray(value: unknown): value is null | string[] {
  return value === null || isStringArray(value);
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function isPathOrFile(value: unknown): value is string | TFile {
  return typeof value === 'string' || isFile(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return isArrayOf(value, isString);
}
