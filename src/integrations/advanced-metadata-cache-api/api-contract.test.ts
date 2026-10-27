import type {
  ApiMethodCases,
  PayloadCases
} from '@mnaoumov/typescript-lib/api-contract-verifier';
import type { TFile } from 'obsidian';

import {
  validateSync,
  verifyApiContract
} from '@mnaoumov/typescript-lib/api-contract-verifier';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import type { AdvancedMetadataCacheApi } from './api.d.ts';

import { ADVANCED_METADATA_CACHE_API_CONTRACT } from './api-contract.ts';

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

  function getCases(): Record<keyof AdvancedMetadataCacheApi, ApiMethodCases> {
    const pathOrFile: PayloadCases = { invalid: [[], [1], [{ path: 'Alpha.md' }], ['Alpha.md', 'extra'], 'Alpha.md'], valid: [['Alpha.md'], [file]] };
    const noArguments: PayloadCases = { invalid: [['extra'], null], valid: [[]] };
    const name: PayloadCases = { invalid: [[], [null]], valid: [['Some Alias']] };
    const nullableBacklinks: PayloadCases = { invalid: [{}, { ...BACKLINKS_DICT, data: {} }, { ...BACKLINKS_DICT, keys: 1 }, undefined], valid: [null, BACKLINKS_DICT] };
    const nullableSuggestions: PayloadCases = {
      invalid: [undefined, [null], [{ file: null }], [{ file: {}, path: 'a' }], [{ alias: 1, file: null, path: 'a' }]],
      // An `alias` of `undefined` and a key the suggestion does not name both pass, as before the guards moved to `@mnaoumov/typescript-lib`.
      valid: [null, [], [{ file: null, path: 'a' }, { alias: 'b', file, path: 'Alpha.md' }], [{ alias: undefined, file: null, path: 'a', unknownKey: true }]]
    };
    const nullableStrings: PayloadCases = { invalid: [undefined, [1]], valid: [null, ['a']] };
    const strings: PayloadCases = { invalid: [null, ['a', 1]], valid: [[], ['a']] };

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
          // An optional key of `undefined` and a key the params do not name both pass, as before the guards moved to `@mnaoumov/typescript-lib`.
          valid: [[{ proposedSettings: {}, sourcePluginId: 'x' }], [{ proposedSettings: { titlePropertyNames: ['subtitle'] }, sourcePluginId: 'x' }], [{
            proposedSettings: { titlePropertyNames: undefined, unknownKey: true },
            sourcePluginId: 'x',
            unknownKey: true
          }]]
        },
        output: { invalid: [null, {}, { isApplied: 'yes' }], valid: [{ isApplied: true }, { isApplied: false, unknownKey: true }] }
      }
    };
  }

  it('should pass the contract verification', async () => {
    expect(await verifyApiContract(ADVANCED_METADATA_CACHE_API_CONTRACT, { cases: getCases(), vendor: 'advanced-metadata-cache' })).toEqual([]);
  });

  it('should name the failing argument and what it expected', () => {
    expect(validateSync(ADVANCED_METADATA_CACHE_API_CONTRACT.getTitles.input, [1])).toEqual({
      issues: [{ message: 'Expected a path or a file.', path: [0] }]
    });
    expect(validateSync(ADVANCED_METADATA_CACHE_API_CONTRACT.getTitles.input, 'Alpha.md')).toEqual({
      issues: [{ message: 'Expected an argument list.' }]
    });
    expect(validateSync(ADVANCED_METADATA_CACHE_API_CONTRACT.getTitles.input, ['a', 'b'])).toEqual({
      issues: [{ message: 'Expected at most 1 argument(s), got 2.' }]
    });
    expect(validateSync(ADVANCED_METADATA_CACHE_API_CONTRACT.getTitles.output, null)).toEqual({
      issues: [{ message: 'Expected an array of titles.' }]
    });
  });
});
