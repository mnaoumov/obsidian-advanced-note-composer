/**
 * @file
 *
 * The runtime half of `Custom Attachment Location`'s published API: its CONTRACT, one entry per method of
 * {@link CustomAttachmentLocationApi}, each with a schema over the argument list and a schema over the value
 * the method returns.
 *
 * This plugin publishes exactly this constant with its API, and a consumer copies it beside `api.d.ts` and
 * passes it as the `contract` when it looks the API up, so both ends validate against ONE definition. The
 * plugin registry checks the payloads against it only while the `obsidian-lib:validate-plugin-api-payloads`
 * debug switch is on.
 *
 * Copying it takes one dependency beside `api.d.ts` and `obsidian`: `@mnaoumov/typescript-lib`, whose
 * `api-contract` subpath carries the contract type, the {@link https://standardschema.dev | Standard Schema}
 * builders and the common guards. What is left here is this API's own constant and the guards for its own
 * shapes. {@link defineApiContract} checks every entry against its method's signature, and the result is
 * assignable to any registry's contract type that is generic over the API (such as
 * `PluginApiContract<CustomAttachmentLocationApi>`).
 *
 * It is not named `api.ts`: TypeScript would read `api.d.ts` as that file's own declarations.
 */

import type { TypedApiContract } from '@mnaoumov/typescript-lib/api-contract';
import type { FileStats } from 'obsidian';

import {
  BOOLEAN_GUARD,
  createArgumentsSchema,
  createTypeGuardSchema,
  defineApiContract,
  nullableGuard,
  STRING_GUARD,
  UNDEFINED_GUARD
} from '@mnaoumov/typescript-lib/api-contract';
import {
  isBoolean,
  isNumber,
  isString,
  isStringArray,
  isUndefined
} from '@mnaoumov/typescript-lib/type-guards';
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
export type CustomAttachmentLocationApiContract = TypedApiContract<CustomAttachmentLocationApi>;

type Guard<T> = (value: unknown) => value is T;

type PropertyGuards<T extends object> = {
  readonly [TKey in keyof T]-?: Guard<Partial<Pick<T, TKey>> extends Pick<T, TKey> ? T[TKey] | undefined : T[TKey]>;
};

const VENDOR = 'obsidian-custom-attachment-location';

const SCHEMA_OPTIONS = { vendor: VENDOR };

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
export const CUSTOM_ATTACHMENT_LOCATION_API_CONTRACT: CustomAttachmentLocationApiContract = defineApiContract<CustomAttachmentLocationApi>({
  collectAttachments: {
    input: createArgumentsSchema([{
      expected: 'collect-attachments params: { pathsOrFiles: (string | TAbstractFile)[] }',
      typeGuard: isCollectAttachmentsParams
    }], SCHEMA_OPTIONS),
    output: createTypeGuardSchema({ ...SCHEMA_OPTIONS, ...UNDEFINED_GUARD, expected: 'nothing' })
  },
  getAttachmentFolderPath: {
    input: createArgumentsSchema([{
      expected: 'attachment-folder-path params: { notePath: string, attachmentFileName?: string }',
      typeGuard: isGetAttachmentFolderPathParams
    }], SCHEMA_OPTIONS),
    output: createTypeGuardSchema({ ...SCHEMA_OPTIONS, ...nullableGuard({ ...STRING_GUARD, expected: 'a folder path' }) })
  },
  getAvailablePathForAttachments: {
    input: createArgumentsSchema([{
      expected: 'available-path-for-attachments params',
      typeGuard: isGetAvailablePathForAttachmentsParams
    }], SCHEMA_OPTIONS),
    output: createTypeGuardSchema({ ...SCHEMA_OPTIONS, ...STRING_GUARD, expected: 'an attachment path' })
  },
  getProperAttachmentPath: {
    input: createArgumentsSchema([{
      expected: 'proper-attachment-path params: { attachmentPathOrFile: string | TFile, notePath: string }',
      typeGuard: isGetProperAttachmentPathParams
    }], SCHEMA_OPTIONS),
    output: createTypeGuardSchema({ ...SCHEMA_OPTIONS, ...nullableGuard({ ...STRING_GUARD, expected: 'an attachment path' }) })
  },
  isAttachmentUnitFolder: {
    input: createArgumentsSchema([{
      expected: 'attachment-unit-folder params: { folderPath: string }',
      typeGuard: isIsAttachmentUnitFolderParams
    }], SCHEMA_OPTIONS),
    output: createTypeGuardSchema({ ...SCHEMA_OPTIONS, ...BOOLEAN_GUARD })
  },
  migrateSettings: {
    input: createArgumentsSchema([{
      expected: 'migrate-settings params: { proposedSettings: MigratableCollectSettings, sourcePluginId: string }',
      typeGuard: isMigrateSettingsParams
    }], SCHEMA_OPTIONS),
    output: createTypeGuardSchema({ ...SCHEMA_OPTIONS, expected: 'a migrate-settings result: { isApplied: boolean }', typeGuard: isMigrateSettingsResult })
  }
});

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
      if (!propertyGuards[key](Reflect.get(value, key))) {
        return false;
      }
    }

    return true;
  };
}

function createOptionalGuard<T>(isPresent: Guard<T>): Guard<T | undefined> {
  return createUnionGuard(isUndefined, isPresent);
}

function createUnionGuard<TFirst, TSecond>(isFirst: Guard<TFirst>, isSecond: Guard<TSecond>): Guard<TFirst | TSecond> {
  return (value): value is TFirst | TSecond => isFirst(value) || isSecond(value);
}

function isAbstractFile(value: unknown): value is TAbstractFile {
  return value instanceof TAbstractFile;
}

function isAttachmentFileContentReader(value: unknown): value is () => Promise<ArrayBuffer> {
  return typeof value === 'function';
}

function isFile(value: unknown): value is TFile {
  return value instanceof TFile;
}

function isNull(value: unknown): value is null {
  return value === null;
}
