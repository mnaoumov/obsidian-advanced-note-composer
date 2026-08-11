import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { ParsedNumberedName } from './numbered-name.ts';

import {
  buildNumberedNameRegExp,
  parseNumberedName
} from './numbered-name.ts';

const FILE_BASE_TOKEN_KEY = 'safeName';
const FOLDER_BASE_TOKEN_KEY = 'safeFolderName';
const FOLDER_NAME_TEMPLATE = '{{index}}. {{safeFolderName}}';

function parseFolderName(name: string, nameTemplate = FOLDER_NAME_TEMPLATE): ParsedNumberedName {
  return parseNumberedName({ baseTokenKey: FOLDER_BASE_TOKEN_KEY, name, nameTemplate });
}

describe('buildNumberedNameRegExp', () => {
  it('should capture the base token and widen every other non-index token', () => {
    const regExp = ensureNonNullable(buildNumberedNameRegExp({
      baseTokenKey: FOLDER_BASE_TOKEN_KEY,
      nameTemplate: '{{index}}. {{safeFolderName}} ({{parentFolder}})'
    }));
    expect(regExp.source).toBe(String.raw`^(?<Index>\d+)\. (?<Base>.*) \(.*\)$`);
  });

  it('should widen every non-index token when no base token is asked for', () => {
    const regExp = ensureNonNullable(buildNumberedNameRegExp({ baseTokenKey: null, nameTemplate: FOLDER_NAME_TEMPLATE }));
    expect(regExp.source).toBe(String.raw`^(?<Index>\d+)\. .*$`);
  });

  it('should capture only the first base token, since a duplicate group name is a syntax error', () => {
    const regExp = ensureNonNullable(buildNumberedNameRegExp({
      baseTokenKey: FOLDER_BASE_TOKEN_KEY,
      nameTemplate: '{{index}}. {{safeFolderName}}-{{safeFolderName}}'
    }));
    expect(regExp.source).toBe(String.raw`^(?<Index>\d+)\. (?<Base>.*)-.*$`);
  });

  it('should capture only the first index token, since a duplicate group name is a syntax error', () => {
    const regExp = ensureNonNullable(buildNumberedNameRegExp({
      baseTokenKey: FOLDER_BASE_TOKEN_KEY,
      nameTemplate: '{{index}}-{{index}}. {{safeFolderName}}'
    }));
    expect(regExp.source).toBe(String.raw`^(?<Index>\d+)-\d+\. (?<Base>.*)$`);
  });

  it('should escape the literal text', () => {
    const regExp = ensureNonNullable(buildNumberedNameRegExp({
      baseTokenKey: FOLDER_BASE_TOKEN_KEY,
      nameTemplate: '({{index}}) {{safeFolderName}}'
    }));
    expect(regExp.source).toBe(String.raw`^\((?<Index>\d+)\) (?<Base>.*)$`);
  });

  it('should return null when the template numbers nothing', () => {
    expect(buildNumberedNameRegExp({ baseTokenKey: FOLDER_BASE_TOKEN_KEY, nameTemplate: '{{safeFolderName}}' })).toBeNull();
  });

  it('should return null when the template never names the item, so renumbering would lose the name', () => {
    expect(buildNumberedNameRegExp({ baseTokenKey: FOLDER_BASE_TOKEN_KEY, nameTemplate: '{{index}}. {{parentFolder}}' })).toBeNull();
  });
});

describe('parseNumberedName', () => {
  it('should split a numbered name into its index and its base name', () => {
    expect(parseFolderName('1. Untitled 2')).toEqual({ baseName: 'Untitled 2', index: 1 });
  });

  it('should report an unnumbered name as having no index, keeping the whole name as the base', () => {
    expect(parseFolderName('Untitled')).toEqual({ baseName: 'Untitled', index: null });
  });

  it('should read a zero-padded index as its numeric value', () => {
    expect(parseFolderName('007 - Alpha', '{{index:000}} - {{safeFolderName}}')).toEqual({ baseName: 'Alpha', index: 7 });
  });

  it('should parse an index written as a suffix, since the pattern comes from the template', () => {
    expect(parseFolderName('Alpha (3)', '{{safeFolderName}} ({{index}})')).toEqual({ baseName: 'Alpha', index: 3 });
  });

  it('should parse a template with no separator at all', () => {
    expect(parseFolderName('2 Alpha', '{{index}} {{safeFolderName}}')).toEqual({ baseName: 'Alpha', index: 2 });
  });

  it('should keep the base name verbatim, so a reorder changes the index and nothing else', () => {
    expect(parseFolderName('3. iPhone  NOTES')).toEqual({ baseName: 'iPhone  NOTES', index: 3 });
  });

  it('should refuse a name the template cannot have produced', () => {
    expect(parseFolderName('Alpha - 3', '{{index}}. {{safeFolderName}}')).toEqual({ baseName: 'Alpha - 3', index: null });
  });

  it('should refuse every name when the template numbers nothing', () => {
    expect(parseFolderName('1. Alpha', '{{safeFolderName}}')).toEqual({ baseName: '1. Alpha', index: null });
  });

  it('should parse a file basename through the file token', () => {
    expect(parseNumberedName({
      baseTokenKey: FILE_BASE_TOKEN_KEY,
      name: '12. Meeting notes',
      nameTemplate: '{{index}}. {{safeName}}'
    })).toEqual({ baseName: 'Meeting notes', index: 12 });
  });

  it('should match the token case-insensitively, the way the resolvers do', () => {
    expect(parseFolderName('4. Alpha', '{{INDEX}}. {{SafeFolderName}}')).toEqual({ baseName: 'Alpha', index: 4 });
  });
});
