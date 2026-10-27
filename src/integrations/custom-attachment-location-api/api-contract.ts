/**
 * @file
 *
 * The runtime half of `Custom Attachment Location`'s published API: its CONTRACT, one entry per method of
 * {@link CustomAttachmentLocationApi}, each with a schema over the argument list and a schema over the value
 * the method returns.
 *
 * This plugin publishes exactly this constant with its API, and a consumer copies it beside `api.d.ts` and
 * passes it as the `contract` when it looks the API up, so both ends validate against ONE definition. The
 * plugin registry checks the payloads against it only while the `obsidian-lib:validate-plugin-api-payloads` debug
 * switch is on.
 *
 * Copying it takes two dependencies beside `api.d.ts` and `obsidian`. `@mnaoumov/typescript-lib` carries the
 * contract type, the {@link https://standardschema.dev | Standard Schema} builders and the guard builders, in
 * its `api-contract` and `type-guards` entry points. `@mnaoumov/obsidian-lib` carries the file guards, in its
 * `file-system` entry point. What is left here is this API's own constant and the guards for its own shapes.
 * {@link defineApiContract} checks every entry against its method's signature, and the result is assignable to
 * any registry's contract type that is generic over the API (such as `ApiContract<CustomAttachmentLocationApi>`).
 *
 * It is not named `api.ts`: TypeScript would read `api.d.ts` as that file's own declarations.
 */

import type { TypedApiContract } from '@mnaoumov/typescript-lib/api-contract';
import type { FileStats } from 'obsidian';

import {
  isAbstractFile,
  isFile
} from '@mnaoumov/obsidian-lib/file-system';
import {
  BOOLEAN_GUARD,
  createApiContractSchemaBuilders,
  createExpectedTypeGuard,
  defineApiContract,
  nullableGuard,
  STRING_GUARD,
  UNDEFINED_GUARD
} from '@mnaoumov/typescript-lib/api-contract';
import {
  arrayTypeGuard,
  functionTypeGuard,
  isBoolean,
  isNull,
  isNumber,
  isString,
  isStringArray,
  literalTypeGuard,
  objectTypeGuard,
  optionalTypeGuard,
  unionTypeGuard
} from '@mnaoumov/typescript-lib/type-guards';

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

const { createArgumentsSchema, createTypeGuardSchema } = createApiContractSchemaBuilders('obsidian-custom-attachment-location');

const isAttachmentPathContext = literalTypeGuard<AttachmentPathContext>(['DeleteNote', 'RenameNote', 'Unknown']);
const isCollectAttachmentUsedByMultipleNotesMode = literalTypeGuard<CollectAttachmentUsedByMultipleNotesMode>([
  'Cancel',
  'Copy',
  'Move',
  'Prompt',
  'Skip'
]);
const isMoveAttachmentToProperFolderUsedByMultipleNotesMode = literalTypeGuard<MoveAttachmentToProperFolderUsedByMultipleNotesMode>([
  'Cancel',
  'CopyAll',
  'Prompt',
  'Skip'
]);

const isFileStats = objectTypeGuard<FileStats>({
  ctime: isNumber,
  mtime: isNumber,
  size: isNumber
});

const isCollectAttachmentsParams = objectTypeGuard<CollectAttachmentsParams>({
  pathsOrFiles: arrayTypeGuard(unionTypeGuard(isString, isAbstractFile))
});

const isGetAttachmentFolderPathParams = objectTypeGuard<GetAttachmentFolderPathParams>({
  attachmentFileName: optionalTypeGuard(isString),
  notePath: isString
});

const isGetAvailablePathForAttachmentsParams = objectTypeGuard<GetAvailablePathForAttachmentsParams>({
  attachmentFileBaseName: isString,
  attachmentFileExtension: isString,
  attachmentFileStats: optionalTypeGuard(isFileStats),
  context: isAttachmentPathContext,
  notePathOrFile: unionTypeGuard(isNull, isString, isFile),
  oldAttachmentPathOrFile: unionTypeGuard(isString, isFile),
  oldNotePathOrFile: optionalTypeGuard(unionTypeGuard(isString, isFile)),
  readAttachmentFileContent: unionTypeGuard(isNull, functionTypeGuard<() => Promise<ArrayBuffer>>()),
  shouldSkipDuplicateCheck: optionalTypeGuard(isBoolean),
  shouldSkipGeneratedAttachmentFileName: optionalTypeGuard(isBoolean),
  shouldSkipMissingAttachmentFolderCreation: optionalTypeGuard(isBoolean)
});

const isGetProperAttachmentPathParams = objectTypeGuard<GetProperAttachmentPathParams>({
  attachmentPathOrFile: unionTypeGuard(isString, isFile),
  notePath: isString
});

const isIsAttachmentUnitFolderParams = objectTypeGuard<IsAttachmentUnitFolderParams>({
  folderPath: isString
});

const isMigratableCollectSettings = objectTypeGuard<MigratableCollectSettings>({
  attachmentUnitFolderPaths: optionalTypeGuard(isStringArray),
  collectAttachmentUsedByMultipleNotesMode: optionalTypeGuard(isCollectAttachmentUsedByMultipleNotesMode),
  excludePathsFromAttachmentCollecting: optionalTypeGuard(isStringArray),
  moveAttachmentToProperFolderUsedByMultipleNotesMode: optionalTypeGuard(isMoveAttachmentToProperFolderUsedByMultipleNotesMode),
  shouldCollectAttachmentsAutomatically: optionalTypeGuard(isBoolean)
});

const isMigrateSettingsParams = objectTypeGuard<MigrateSettingsParams>({
  proposedSettings: isMigratableCollectSettings,
  sourcePluginId: isString
});

const isMigrateSettingsResult = objectTypeGuard<MigrateSettingsResult>({
  isApplied: isBoolean
});
/**
 * The contract this plugin publishes with {@link CustomAttachmentLocationApi}, for a consumer to pass as the
 * `contract` when it looks the API up.
 */
export const CUSTOM_ATTACHMENT_LOCATION_API_CONTRACT: CustomAttachmentLocationApiContract = defineApiContract<CustomAttachmentLocationApi>({
  collectAttachments: {
    input: createArgumentsSchema([createExpectedTypeGuard('collect-attachments params: { pathsOrFiles: (string | TAbstractFile)[] }', isCollectAttachmentsParams)]),
    output: createTypeGuardSchema({ ...UNDEFINED_GUARD, expected: 'nothing' })
  },
  getAttachmentFolderPath: {
    input: createArgumentsSchema([createExpectedTypeGuard('attachment-folder-path params: { notePath: string, attachmentFileName?: string }', isGetAttachmentFolderPathParams)]),
    output: createTypeGuardSchema(nullableGuard({ ...STRING_GUARD, expected: 'a folder path' }))
  },
  getAvailablePathForAttachments: {
    input: createArgumentsSchema([createExpectedTypeGuard('available-path-for-attachments params', isGetAvailablePathForAttachmentsParams)]),
    output: createTypeGuardSchema({ ...STRING_GUARD, expected: 'an attachment path' })
  },
  getProperAttachmentPath: {
    input: createArgumentsSchema([createExpectedTypeGuard('proper-attachment-path params: { attachmentPathOrFile: string | TFile, notePath: string }', isGetProperAttachmentPathParams)]),
    output: createTypeGuardSchema(nullableGuard({ ...STRING_GUARD, expected: 'an attachment path' }))
  },
  isAttachmentUnitFolder: {
    input: createArgumentsSchema([createExpectedTypeGuard('attachment-unit-folder params: { folderPath: string }', isIsAttachmentUnitFolderParams)]),
    output: createTypeGuardSchema(BOOLEAN_GUARD)
  },
  migrateSettings: {
    input: createArgumentsSchema([createExpectedTypeGuard('migrate-settings params: { proposedSettings: MigratableCollectSettings, sourcePluginId: string }', isMigrateSettingsParams)]),
    output: createTypeGuardSchema(createExpectedTypeGuard('a migrate-settings result: { isApplied: boolean }', isMigrateSettingsResult))
  }
});
