/**
 * @file
 *
 * The runtime half of `Custom Attachment Location`'s published API: its CONTRACT, one entry per method of
 * {@link CustomAttachmentLocationApi}, each with a schema over the argument list and a schema over the value
 * the method returns.
 *
 * This plugin publishes exactly this constant with its API, and a consumer copies it beside `api.d.ts` and
 * passes it as the `contract` when it looks the API up, so both ends validate against ONE definition. The
 * plugin registry checks the payloads against it only while its debugger is on.
 *
 * Copyable for the same reason `api.d.ts` is: it imports from `obsidian` and `./api.d.ts` and nothing else. So
 * the schemas are hand-written {@link https://standardschema.dev | Standard Schema} objects rather than built
 * with a schema library, and the constant is typed structurally rather than as a registry type. A consumer on
 * a library whose contract type is generic over the API (such as `PluginApiContract<CustomAttachmentLocationApi>`)
 * can assign the constant to it, which checks every entry against its method's signature.
 *
 * It is not named `api.ts`: TypeScript would read `api.d.ts` as that file's own declarations.
 */

import type { FileStats } from 'obsidian';

import {
  TAbstractFile,
  TFile
} from 'obsidian';

import type {
  AttachmentPathContext,
  CollectAttachmentsParams,
  CollectAttachmentUsedByMultipleNotesMode,
  CustomAttachmentLocationApi,
  GetAttachmentFolderPathParams,
  GetAvailablePathForAttachmentsParams,
  GetProperAttachmentPathParams,
  IsAttachmentUnitFolderParams,
  MigratableCollectSettings,
  MigrateSettingsParams,
  MigrateSettingsResult,
  MoveAttachmentToProperFolderUsedByMultipleNotesMode
} from './api.d.ts';

/**
 * The type of {@link CUSTOM_ATTACHMENT_LOCATION_API_CONTRACT}: one entry per method of
 * {@link CustomAttachmentLocationApi}, each typed against that method's parameters and awaited return value.
 */
export type CustomAttachmentLocationApiContract = {
  readonly [TMethodName in keyof CustomAttachmentLocationApi]: CustomAttachmentLocationApiMethodContract<
    Parameters<CustomAttachmentLocationApi[TMethodName]>,
    Awaited<ReturnType<CustomAttachmentLocationApi[TMethodName]>>
  >;
};

/**
 * The payload schemas of one method.
 *
 * @typeParam TParameters - The method's parameters.
 * @typeParam TReturnValue - The method's return value, awaited.
 */
export interface CustomAttachmentLocationApiMethodContract<TParameters, TReturnValue> {
  /**
   * Validates the method's arguments, as an array.
   */
  readonly input: CustomAttachmentLocationApiSchema<TParameters>;

  /**
   * Validates the method's return value, or the value it resolves to.
   */
  readonly output: CustomAttachmentLocationApiSchema<TReturnValue>;
}

/**
 * A {@link https://standardschema.dev | Standard Schema} (`StandardSchemaV1<unknown, T>`), restated with
 * only the members this file uses so it needs no dependency for them.
 *
 * @typeParam T - The type a value that passes is.
 */
export interface CustomAttachmentLocationApiSchema<T> {
  /**
   * The Standard Schema properties.
   */
  readonly '~standard': CustomAttachmentLocationApiSchemaProps<T>;
}

/**
 * The result of a value that failed {@link CustomAttachmentLocationApiSchema}'s `validate`.
 */
export interface CustomAttachmentLocationApiSchemaFailure {
  /**
   * What was wrong with the value.
   */
  readonly issues: readonly CustomAttachmentLocationApiSchemaIssue[];
}

/**
 * One thing wrong with a value.
 */
export interface CustomAttachmentLocationApiSchemaIssue {
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
 * The Standard Schema properties of {@link CustomAttachmentLocationApiSchema}.
 *
 * @typeParam T - The type a value that passes is.
 */
export interface CustomAttachmentLocationApiSchemaProps<T> {
  /**
   * The inferred types, present for type inference only.
   */
  readonly types?: CustomAttachmentLocationApiSchemaTypes<T> | undefined;

  /**
   * Validates a value.
   *
   * @param value - The value to validate.
   * @returns The value when it passes; otherwise the issues found.
   */
  readonly validate: (value: unknown) => CustomAttachmentLocationApiSchemaResult<T>;

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
 * The result of {@link CustomAttachmentLocationApiSchema}'s `validate`.
 *
 * @typeParam T - The type a value that passes is.
 */
export type CustomAttachmentLocationApiSchemaResult<T> = CustomAttachmentLocationApiSchemaFailure | CustomAttachmentLocationApiSchemaSuccess<T>;

/**
 * The result of a value that passed {@link CustomAttachmentLocationApiSchema}'s `validate`.
 *
 * @typeParam T - The type a value that passes is.
 */
export interface CustomAttachmentLocationApiSchemaSuccess<T> {
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
export interface CustomAttachmentLocationApiSchemaTypes<T> {
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

type Guard<T> = (value: unknown) => value is T;

type PropertyGuards<T extends object> = {
  readonly [TKey in keyof T]-?: Guard<Partial<Pick<T, TKey>> extends Pick<T, TKey> ? T[TKey] | undefined : T[TKey]>;
};

interface ValueSchemaParams<T> {
  readonly expected: string;
  readonly isValid: (value: unknown) => value is T;
}

const VENDOR = 'obsidian-custom-attachment-location';

const isAttachmentPathContext = createLiteralGuard<AttachmentPathContext>(['DeleteNote', 'RenameNote', 'Unknown']);
const isCollectAttachmentUsedByMultipleNotesMode = createLiteralGuard<CollectAttachmentUsedByMultipleNotesMode>([
  'Cancel',
  'Copy',
  'Move',
  'Prompt',
  'Skip'
]);
const isMoveAttachmentToProperFolderUsedByMultipleNotesMode = createLiteralGuard<MoveAttachmentToProperFolderUsedByMultipleNotesMode>([
  'Cancel',
  'CopyAll',
  'Prompt',
  'Skip'
]);

const isFileStats = createObjectGuard<FileStats>({
  ctime: isNumber,
  mtime: isNumber,
  size: isNumber
});

const isCollectAttachmentsParams = createObjectGuard<CollectAttachmentsParams>({
  pathsOrFiles: createArrayGuard(createUnionGuard(isString, isAbstractFile))
});

const isGetAttachmentFolderPathParams = createObjectGuard<GetAttachmentFolderPathParams>({
  attachmentFileName: createOptionalGuard(isString),
  notePath: isString
});

const isGetAvailablePathForAttachmentsParams = createObjectGuard<GetAvailablePathForAttachmentsParams>({
  attachmentFileBaseName: isString,
  attachmentFileExtension: isString,
  attachmentFileStats: createOptionalGuard(isFileStats),
  context: isAttachmentPathContext,
  notePathOrFile: createUnionGuard(isNull, createUnionGuard(isString, isFile)),
  oldAttachmentPathOrFile: createUnionGuard(isString, isFile),
  oldNotePathOrFile: createOptionalGuard(createUnionGuard(isString, isFile)),
  readAttachmentFileContent: createUnionGuard(isNull, isAttachmentFileContentReader),
  shouldSkipDuplicateCheck: createOptionalGuard(isBoolean),
  shouldSkipGeneratedAttachmentFileName: createOptionalGuard(isBoolean),
  shouldSkipMissingAttachmentFolderCreation: createOptionalGuard(isBoolean)
});

const isGetProperAttachmentPathParams = createObjectGuard<GetProperAttachmentPathParams>({
  attachmentPathOrFile: createUnionGuard(isString, isFile),
  notePath: isString
});

const isIsAttachmentUnitFolderParams = createObjectGuard<IsAttachmentUnitFolderParams>({
  folderPath: isString
});

const isMigratableCollectSettings = createObjectGuard<MigratableCollectSettings>({
  attachmentUnitFolderPaths: createOptionalGuard(isStringArray),
  collectAttachmentUsedByMultipleNotesMode: createOptionalGuard(isCollectAttachmentUsedByMultipleNotesMode),
  excludePathsFromAttachmentCollecting: createOptionalGuard(isStringArray),
  moveAttachmentToProperFolderUsedByMultipleNotesMode: createOptionalGuard(isMoveAttachmentToProperFolderUsedByMultipleNotesMode),
  shouldCollectAttachmentsAutomatically: createOptionalGuard(isBoolean)
});

const isMigrateSettingsParams = createObjectGuard<MigrateSettingsParams>({
  proposedSettings: isMigratableCollectSettings,
  sourcePluginId: isString
});

const isMigrateSettingsResult = createObjectGuard<MigrateSettingsResult>({
  isApplied: isBoolean
});

/**
 * The contract this plugin publishes with {@link CustomAttachmentLocationApi}, for a consumer to pass as the
 * `contract` when it looks the API up.
 */
export const CUSTOM_ATTACHMENT_LOCATION_API_CONTRACT: CustomAttachmentLocationApiContract = {
  collectAttachments: {
    input: createArgumentsSchema<[params: CollectAttachmentsParams]>([{
      expected: 'collect-attachments params: { pathsOrFiles: (string | TAbstractFile)[] }',
      isValid: isCollectAttachmentsParams
    }]),
    output: createValueSchema({ expected: 'nothing', isValid: isUndefined })
  },
  getAttachmentFolderPath: {
    input: createArgumentsSchema<[params: GetAttachmentFolderPathParams]>([{
      expected: 'attachment-folder-path params: { notePath: string, attachmentFileName?: string }',
      isValid: isGetAttachmentFolderPathParams
    }]),
    output: createValueSchema({ expected: 'a folder path or null', isValid: isNullOrString })
  },
  getAvailablePathForAttachments: {
    input: createArgumentsSchema<[params: GetAvailablePathForAttachmentsParams]>([{
      expected: 'available-path-for-attachments params',
      isValid: isGetAvailablePathForAttachmentsParams
    }]),
    output: createValueSchema({ expected: 'an attachment path', isValid: isString })
  },
  getProperAttachmentPath: {
    input: createArgumentsSchema<[params: GetProperAttachmentPathParams]>([{
      expected: 'proper-attachment-path params: { attachmentPathOrFile: string | TFile, notePath: string }',
      isValid: isGetProperAttachmentPathParams
    }]),
    output: createValueSchema({ expected: 'an attachment path or null', isValid: isNullOrString })
  },
  isAttachmentUnitFolder: {
    input: createArgumentsSchema<[params: IsAttachmentUnitFolderParams]>([{
      expected: 'attachment-unit-folder params: { folderPath: string }',
      isValid: isIsAttachmentUnitFolderParams
    }]),
    output: createValueSchema({ expected: 'a boolean', isValid: isBoolean })
  },
  migrateSettings: {
    input: createArgumentsSchema<[params: MigrateSettingsParams]>([{
      expected: 'migrate-settings params: { proposedSettings: MigratableCollectSettings, sourcePluginId: string }',
      isValid: isMigrateSettingsParams
    }]),
    output: createValueSchema({ expected: 'a migrate-settings result: { isApplied: boolean }', isValid: isMigrateSettingsResult })
  }
};

function createArgumentsSchema<TParameters extends readonly unknown[]>(
  parameters: ArgumentSchemaParams<TParameters>
): CustomAttachmentLocationApiSchema<TParameters> {
  const parameterList: readonly ValueSchemaParams<unknown>[] = parameters;

  function getIssues(value: unknown): CustomAttachmentLocationApiSchemaIssue[] {
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

function createArrayGuard<T>(isItem: Guard<T>): Guard<T[]> {
  return (value): value is T[] => Array.isArray(value) && value.every((item) => isItem(item));
}

function createLiteralGuard<T extends string>(literals: readonly T[]): Guard<T> {
  const literalList: readonly unknown[] = literals;
  return (value): value is T => literalList.includes(value);
}

function createObjectGuard<T extends object>(propertyGuards: PropertyGuards<T>): Guard<T> {
  return (value): value is T => {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    for (const key in propertyGuards) {
      if (!propertyGuards[key](getProperty(value, key))) {
        return false;
      }
    }

    return true;
  };
}

function createOptionalGuard<T>(isPresent: Guard<T>): Guard<T | undefined> {
  return createUnionGuard(isUndefined, isPresent);
}

function createSchema<T>(validate: (value: unknown) => CustomAttachmentLocationApiSchemaResult<T>): CustomAttachmentLocationApiSchema<T> {
  return {
    '~standard': {
      validate,
      vendor: VENDOR,
      version: 1
    }
  };
}

function createUnionGuard<TFirst, TSecond>(isFirst: Guard<TFirst>, isSecond: Guard<TSecond>): Guard<TFirst | TSecond> {
  return (value): value is TFirst | TSecond => isFirst(value) || isSecond(value);
}

function createValueSchema<T>(params: ValueSchemaParams<T>): CustomAttachmentLocationApiSchema<T> {
  return createSchema((value) => params.isValid(value) ? { value } : { issues: [{ message: `Expected ${params.expected}.` }] });
}

function getProperty(value: object, key: string): unknown {
  return Reflect.get(value, key);
}

function isAbstractFile(value: unknown): value is TAbstractFile {
  return value instanceof TAbstractFile;
}

function isAttachmentFileContentReader(value: unknown): value is () => Promise<ArrayBuffer> {
  return typeof value === 'function';
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isFile(value: unknown): value is TFile {
  return value instanceof TFile;
}

function isNull(value: unknown): value is null {
  return value === null;
}

function isNullOrString(value: unknown): value is null | string {
  return isNull(value) || isString(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => isString(item));
}

function isUndefined(value: unknown): value is undefined {
  return value === undefined;
}
