import type { TFile } from 'obsidian';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import type {
  AdvancedMetadataCacheApiSchema,
  AdvancedMetadataCacheApiSchemaResult
} from './api-contract.ts';
import type { AdvancedMetadataCacheApi } from './api.d.ts';

import { ADVANCED_METADATA_CACHE_API_CONTRACT } from './api-contract.ts';

interface MethodCases {
  readonly input: PayloadCase;
  readonly output: PayloadCase;
}

type MethodName = keyof AdvancedMetadataCacheApi;

interface PayloadCase {
  readonly invalid: readonly unknown[];
  readonly valid: readonly unknown[];
}

const BACKLINKS_DICT = {
  data: new Map(),
  get: (): null => null,
  keys: (): string[] => []
};

const HEADING_TIMES = {
  created: null,
  heading: 'One',
  level: 1,
  line: 0,
  modified: 1,
  seen: null
};

describe('ADVANCED_METADATA_CACHE_API_CONTRACT', () => {
  let file: TFile;

  beforeEach(() => {
    const app = App.createConfigured__();
    file = castTo<TFile>(app.vault.createSync__('Alpha.md', ''));
  });

  function getCases(): Record<MethodName, MethodCases> {
    const pathOrFile: PayloadCase = { invalid: [[], [1], [{ path: 'Alpha.md' }], ['Alpha.md', 'extra'], 'Alpha.md'], valid: [['Alpha.md'], [file]] };
    const noArguments: PayloadCase = { invalid: [['extra'], null], valid: [[]] };
    const name: PayloadCase = { invalid: [[], [null]], valid: [['Some Alias']] };
    const nullableBacklinks: PayloadCase = { invalid: [{}, { ...BACKLINKS_DICT, data: {} }, { ...BACKLINKS_DICT, keys: 1 }, undefined], valid: [null, BACKLINKS_DICT] };
    const nullableSuggestions: PayloadCase = {
      invalid: [undefined, [null], [{ file: null }], [{ file: {}, path: 'a' }], [{ alias: 1, file: null, path: 'a' }]],
      valid: [null, [], [{ file: null, path: 'a' }, { alias: 'b', file, path: 'Alpha.md' }]]
    };
    const nullableStrings: PayloadCase = { invalid: [undefined, [1]], valid: [null, ['a']] };
    const strings: PayloadCase = { invalid: [null, ['a', 1]], valid: [[], ['a']] };

    return {
      getBacklinksForFile: { input: pathOrFile, output: nullableBacklinks },
      getBacklinksForFileOriginal: {
        input: { invalid: [['Alpha.md'], []], valid: [[file]] },
        output: { invalid: [null], valid: [BACKLINKS_DICT] }
      },
      getBacklinksForFileSafe: { input: pathOrFile, output: nullableBacklinks },
      getHeadingTimes: {
        input: pathOrFile,
        output: {
          invalid: [null, [null], [{ ...HEADING_TIMES, created: '1' }], [{ ...HEADING_TIMES, heading: 1 }], [{ ...HEADING_TIMES, level: '1' }], [{ ...HEADING_TIMES, line: null }], [{ ...HEADING_TIMES, modified: undefined }], [{ ...HEADING_TIMES, seen: '1' }]],
          valid: [[], [HEADING_TIMES]]
        }
      },
      getLinkSuggestions: { input: noArguments, output: nullableSuggestions },
      getLinkSuggestionsOriginal: { input: noArguments, output: { invalid: [null], valid: [[{ file: null, path: 'a' }]] } },
      getLinkSuggestionsSafe: { input: noArguments, output: nullableSuggestions },
      getPathsByName: { input: name, output: nullableStrings },
      getPathsByNameSafe: { input: name, output: nullableStrings },
      getTitlePropertyNames: { input: noArguments, output: strings },
      getTitles: { input: pathOrFile, output: strings },
      migrateSettings: {
        input: {
          invalid: [[], [null], [{ proposedSettings: {} }], [{ proposedSettings: null, sourcePluginId: 'x' }], [{
            proposedSettings: { titlePropertyNames: [1] },
            sourcePluginId: 'x'
          }]],
          valid: [[{ proposedSettings: {}, sourcePluginId: 'x' }], [{ proposedSettings: { titlePropertyNames: ['subtitle'] }, sourcePluginId: 'x' }]]
        },
        output: { invalid: [null, {}, { isApplied: 'yes' }], valid: [{ isApplied: true }] }
      }
    };
  }

  it('should have one entry per method of the API, each with both schemas', () => {
    expect(Object.keys(ADVANCED_METADATA_CACHE_API_CONTRACT).sort()).toEqual(Object.keys(getCases()).sort());
    for (const methodName of castTo<MethodName[]>(Object.keys(ADVANCED_METADATA_CACHE_API_CONTRACT))) {
      const methodContract = ADVANCED_METADATA_CACHE_API_CONTRACT[methodName];
      for (const schema of [methodContract.input, methodContract.output]) {
        expect(schema['~standard']).toMatchObject({ vendor: 'advanced-metadata-cache', version: 1 });
      }
    }
  });

  it('should accept every valid payload and refuse every invalid one', () => {
    const cases = getCases();
    for (const methodName of castTo<MethodName[]>(Object.keys(cases))) {
      for (const half of ['input', 'output'] as const) {
        const schema: AdvancedMetadataCacheApiSchema<unknown> = ADVANCED_METADATA_CACHE_API_CONTRACT[methodName][half];
        const { invalid, valid } = cases[methodName][half];
        for (const [index, value] of valid.entries()) {
          expect(validate(schema, value), `${methodName} ${half} should accept valid case ${String(index)}`).toEqual({ value });
        }

        for (const [index, value] of invalid.entries()) {
          expect(validate(schema, value).issues, `${methodName} ${half} should refuse invalid case ${String(index)}`).not.toHaveLength(0);
        }
      }
    }
  });

  it('should name the failing argument and what it expected', () => {
    expect(validate(ADVANCED_METADATA_CACHE_API_CONTRACT.getTitles.input, [1])).toEqual({
      issues: [{ message: 'Expected a path or a file.', path: [0] }]
    });
    expect(validate(ADVANCED_METADATA_CACHE_API_CONTRACT.getTitles.input, 'Alpha.md')).toEqual({
      issues: [{ message: 'Expected an argument list.' }]
    });
    expect(validate(ADVANCED_METADATA_CACHE_API_CONTRACT.getTitles.input, ['a', 'b'])).toEqual({
      issues: [{ message: 'Expected at most 1 argument(s), got 2.' }]
    });
    expect(validate(ADVANCED_METADATA_CACHE_API_CONTRACT.getTitles.output, null)).toEqual({
      issues: [{ message: 'Expected an array of titles.' }]
    });
  });
});

function validate(schema: AdvancedMetadataCacheApiSchema<unknown>, value: unknown): AdvancedMetadataCacheApiSchemaResult<unknown> {
  return schema['~standard'].validate(value);
}
