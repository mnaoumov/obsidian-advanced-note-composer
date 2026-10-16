import type { ApiMethodContract } from '@mnaoumov/typescript-lib/api-contract';

import {
  App,
  TFile,
  TFolder
} from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { CustomAttachmentLocationApi } from './api.d.ts';

import { CUSTOM_ATTACHMENT_LOCATION_API_CONTRACT } from './api-contract.ts';

interface MethodCases {
  readonly input: PayloadCase;
  readonly output: PayloadCase;
}

type MethodName = keyof CustomAttachmentLocationApi;

interface PayloadCase {
  readonly invalid: readonly unknown[];
  readonly valid: readonly unknown[];
}

type Schema = NonNullable<ApiMethodContract['input']>;

type SchemaResult = Awaited<ReturnType<Schema['~standard']['validate']>>;

const app = App.createConfigured__();
const file = TFile.create__(app.vault, 'Notes/Alpha.md').asOriginalType__();
const folder = TFolder.create__(app.vault, 'Notes').asOriginalType__();

const AVAILABLE_PATH_PARAMS = {
  attachmentFileBaseName: 'image',
  attachmentFileExtension: 'png',
  context: 'RenameNote',
  notePathOrFile: 'Notes/Renamed.md',
  oldAttachmentPathOrFile: 'Attachments/Alpha/image.png',
  oldNotePathOrFile: 'Notes/Alpha.md',
  readAttachmentFileContent: null,
  shouldSkipMissingAttachmentFolderCreation: true
};

const NULL_OR_STRING: PayloadCase = { invalid: [undefined, 1, false], valid: [null, '', 'Attachments/Alpha'] };

const CASES: Record<MethodName, MethodCases> = {
  collectAttachments: {
    input: {
      invalid: [[], [null], [{}], [{ pathsOrFiles: 'Notes/Alpha.md' }], [{ pathsOrFiles: [1] }], [{ pathsOrFiles: [] }, 'extra'], { pathsOrFiles: [] }],
      valid: [[{ pathsOrFiles: [] }], [{ pathsOrFiles: ['Notes/Alpha.md', file, folder] }]]
    },
    output: { invalid: [null, false, ''], valid: [undefined] }
  },
  getAttachmentFolderPath: {
    input: {
      invalid: [[], [{}], [{ notePath: 1 }], [{ attachmentFileName: 1, notePath: 'Notes/Alpha.md' }]],
      valid: [[{ notePath: 'Notes/Alpha.md' }], [{ attachmentFileName: 'image.png', notePath: 'Notes/Alpha.md' }], [{
        attachmentFileName: undefined,
        notePath: 'Notes/Alpha.md'
      }]]
    },
    output: NULL_OR_STRING
  },
  getAvailablePathForAttachments: {
    input: {
      invalid: [
        [],
        [{ ...AVAILABLE_PATH_PARAMS, context: 'Save' }],
        [{ ...AVAILABLE_PATH_PARAMS, notePathOrFile: folder }],
        [{ ...AVAILABLE_PATH_PARAMS, oldAttachmentPathOrFile: null }],
        [{ ...AVAILABLE_PATH_PARAMS, readAttachmentFileContent: undefined }],
        [{ ...AVAILABLE_PATH_PARAMS, attachmentFileStats: { ctime: 1, mtime: 2 } }],
        [{ ...AVAILABLE_PATH_PARAMS, shouldSkipDuplicateCheck: 'yes' }],
        [{ ...AVAILABLE_PATH_PARAMS, attachmentFileBaseName: undefined }]
      ],
      valid: [
        [AVAILABLE_PATH_PARAMS],
        [{
          ...AVAILABLE_PATH_PARAMS,
          attachmentFileStats: { ctime: 1, mtime: 2, size: 3 },
          context: 'Unknown',
          notePathOrFile: null,
          oldAttachmentPathOrFile: file,
          oldNotePathOrFile: file,
          readAttachmentFileContent: vi.fn<() => Promise<ArrayBuffer>>(),
          shouldSkipDuplicateCheck: true,
          shouldSkipGeneratedAttachmentFileName: false,
          shouldSkipMissingAttachmentFolderCreation: undefined
        }]
      ]
    },
    output: { invalid: [null, undefined, 1], valid: ['Attachments/Alpha/image.png'] }
  },
  getProperAttachmentPath: {
    input: {
      invalid: [[], [{ notePath: 'Notes/Alpha.md' }], [{ attachmentPathOrFile: folder, notePath: 'Notes/Alpha.md' }]],
      valid: [[{ attachmentPathOrFile: 'image.png', notePath: 'Notes/Alpha.md' }], [{ attachmentPathOrFile: file, notePath: 'Notes/Alpha.md' }]]
    },
    output: NULL_OR_STRING
  },
  isAttachmentUnitFolder: {
    input: {
      invalid: [[], ['Notes/page_files'], [{ folderPath: null }]],
      valid: [[{ folderPath: 'Notes/page_files' }]]
    },
    output: { invalid: [null, undefined, 'true'], valid: [true, false] }
  },
  migrateSettings: {
    input: {
      invalid: [
        [],
        [{ proposedSettings: {} }],
        [{ proposedSettings: null, sourcePluginId: 'consistent-attachments-and-links' }],
        [{ proposedSettings: { collectAttachmentUsedByMultipleNotesMode: 'CopyAll' }, sourcePluginId: 'consistent-attachments-and-links' }],
        [{ proposedSettings: { moveAttachmentToProperFolderUsedByMultipleNotesMode: 'Copy' }, sourcePluginId: 'consistent-attachments-and-links' }],
        [{ proposedSettings: { attachmentUnitFolderPaths: [1] }, sourcePluginId: 'consistent-attachments-and-links' }],
        [{ proposedSettings: { shouldCollectAttachmentsAutomatically: 'yes' }, sourcePluginId: 'consistent-attachments-and-links' }]
      ],
      valid: [
        [{ proposedSettings: {}, sourcePluginId: 'consistent-attachments-and-links' }],
        [{
          proposedSettings: {
            attachmentUnitFolderPaths: ['/_files$/'],
            collectAttachmentUsedByMultipleNotesMode: 'Copy',
            excludePathsFromAttachmentCollecting: [],
            moveAttachmentToProperFolderUsedByMultipleNotesMode: 'CopyAll',
            shouldCollectAttachmentsAutomatically: true
          },
          sourcePluginId: 'consistent-attachments-and-links'
        }]
      ]
    },
    output: { invalid: [null, undefined, true, {}, { isApplied: 'yes' }], valid: [{ isApplied: true }, { isApplied: false }] }
  }
};

const METHOD_NAMES: readonly MethodName[] = [
  'collectAttachments',
  'getAttachmentFolderPath',
  'getAvailablePathForAttachments',
  'getProperAttachmentPath',
  'isAttachmentUnitFolder',
  'migrateSettings'
];

describe('CUSTOM_ATTACHMENT_LOCATION_API_CONTRACT', () => {
  it('should have one entry per method of the API, each with both schemas', () => {
    expect(Object.keys(CUSTOM_ATTACHMENT_LOCATION_API_CONTRACT).sort()).toEqual([...METHOD_NAMES].sort());
    for (const methodName of METHOD_NAMES) {
      const methodContract = CUSTOM_ATTACHMENT_LOCATION_API_CONTRACT[methodName];
      for (const schema of [methodContract.input, methodContract.output]) {
        expect(schema['~standard']).toMatchObject({ vendor: 'obsidian-custom-attachment-location', version: 1 });
      }
    }
  });

  it('should accept every valid payload and refuse every invalid one', async () => {
    for (const methodName of METHOD_NAMES) {
      for (const half of ['input', 'output'] as const) {
        const schema: Schema = CUSTOM_ATTACHMENT_LOCATION_API_CONTRACT[methodName][half];
        const { invalid, valid } = CASES[methodName][half];
        for (const [index, value] of valid.entries()) {
          expect(await validate(schema, value), `${methodName} ${half} should accept valid case ${String(index)}`).toEqual({ value });
        }

        for (const [index, value] of invalid.entries()) {
          const result = await validate(schema, value);
          expect(result.issues, `${methodName} ${half} should refuse invalid case ${String(index)}`).not.toHaveLength(0);
        }
      }
    }
  });

  it('should name the failing argument and what it expected', async () => {
    expect(await validate(CUSTOM_ATTACHMENT_LOCATION_API_CONTRACT.isAttachmentUnitFolder.input, [{ folderPath: 1 }])).toEqual({
      issues: [{ message: 'Expected attachment-unit-folder params: { folderPath: string }.', path: [0] }]
    });
    expect(await validate(CUSTOM_ATTACHMENT_LOCATION_API_CONTRACT.isAttachmentUnitFolder.input, 'Notes')).toEqual({
      issues: [{ message: 'Expected an argument list.' }]
    });
    expect(await validate(CUSTOM_ATTACHMENT_LOCATION_API_CONTRACT.isAttachmentUnitFolder.input, [{ folderPath: 'a' }, 'b'])).toEqual({
      issues: [{ message: 'Expected at most 1 argument(s), got 2.' }]
    });
    expect(await validate(CUSTOM_ATTACHMENT_LOCATION_API_CONTRACT.migrateSettings.output, null)).toEqual({
      issues: [{ message: 'Expected a migrate-settings result: { isApplied: boolean }.' }]
    });
  });
});

async function validate(schema: Schema, value: unknown): Promise<SchemaResult> {
  return await schema['~standard'].validate(value);
}
