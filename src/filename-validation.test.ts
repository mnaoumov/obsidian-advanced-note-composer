import {
  describe,
  expect,
  it
} from 'vitest';

import type { FixFileNameParams } from './filename-validation.ts';

import {
  fixFileName,
  INVALID_CHARACTERS_REG_EXP
} from './filename-validation.ts';

describe('INVALID_CHARACTERS_REG_EXP', () => {
  it('should match asterisk', () => {
    expect('file*name').toMatch(INVALID_CHARACTERS_REG_EXP);
  });

  it('should match backslash', () => {
    expect(String.raw`file\name`).toMatch(INVALID_CHARACTERS_REG_EXP);
  });

  it('should match less-than', () => {
    expect('file<name').toMatch(INVALID_CHARACTERS_REG_EXP);
  });

  it('should match greater-than', () => {
    expect('file>name').toMatch(INVALID_CHARACTERS_REG_EXP);
  });

  it('should match colon', () => {
    expect('file:name').toMatch(INVALID_CHARACTERS_REG_EXP);
  });

  it('should match pipe', () => {
    expect('file|name').toMatch(INVALID_CHARACTERS_REG_EXP);
  });

  it('should match question mark', () => {
    expect('file?name').toMatch(INVALID_CHARACTERS_REG_EXP);
  });

  it('should match hash', () => {
    expect('file#name').toMatch(INVALID_CHARACTERS_REG_EXP);
  });

  it('should match caret', () => {
    expect('file^name').toMatch(INVALID_CHARACTERS_REG_EXP);
  });

  it('should match square brackets', () => {
    expect('file[name]').toMatch(INVALID_CHARACTERS_REG_EXP);
  });

  it('should match double quote', () => {
    expect('file"name').toMatch(INVALID_CHARACTERS_REG_EXP);
  });

  it('should not match valid filename characters', () => {
    INVALID_CHARACTERS_REG_EXP.lastIndex = 0;
    expect(INVALID_CHARACTERS_REG_EXP.test('valid-file_name.md')).toBe(false);
  });

  it('should match multiple invalid characters at once', () => {
    const matches = 'a*b<c'.match(INVALID_CHARACTERS_REG_EXP);
    expect(matches).not.toBeNull();
  });
});

describe('fixFileName', () => {
  function fix(fileName: string, overrides: Partial<FixFileNameParams> = {}): string {
    return fixFileName({
      replacement: '_',
      shouldReplaceInvalidCharacters: true,
      shouldTreatTitleAsPath: true,
      ...overrides,
      fileName
    });
  }

  it('should return Untitled for an empty name', () => {
    expect(fix('')).toBe('Untitled');
  });

  it('should keep a valid name as is', () => {
    expect(fix('valid name')).toBe('valid name');
  });

  it('should replace invalid characters', () => {
    expect(fix('a*b<c')).toBe('a_b_c');
  });

  it('should replace a run of invalid characters with one replacement per character', () => {
    expect(fix('a**b')).toBe('a__b');
  });

  it('should remove invalid characters when the replacement is empty', () => {
    expect(fix('a*b', { replacement: '' })).toBe('ab');
  });

  it('should replace trailing dots', () => {
    expect(fix('name..')).toBe('name__');
  });

  it('should replace trailing spaces', () => {
    expect(fix('name  ')).toBe('name__');
  });

  it('should replace a trailing mix of dots and spaces', () => {
    expect(fix('name. ')).toBe('name__');
  });

  it('should keep dots in the middle of a name', () => {
    expect(fix('file.name')).toBe('file.name');
  });

  it('should replace a leading dot', () => {
    expect(fix('.hidden')).toBe('_hidden');
  });

  it('should replace a leading space', () => {
    expect(fix(' name')).toBe('_name');
  });

  it('should keep path separators when the name is treated as a path', () => {
    expect(fix('foo/bar/baz')).toBe('foo/bar/baz');
  });

  it('should drop empty path segments', () => {
    expect(fix('foo//bar')).toBe('foo/bar');
  });

  it('should collapse a path-shaped name into one segment when the name is not treated as a path', () => {
    expect(fix('foo/bar/baz', { shouldTreatTitleAsPath: false })).toBe('foo_bar_baz');
  });

  it('should return the name as typed when invalid characters are not replaced', () => {
    expect(fix('a*b', { shouldReplaceInvalidCharacters: false })).toBe('a*b');
  });

  it('should still collapse a path-shaped name when invalid characters are not replaced', () => {
    expect(fix('foo/bar', { shouldReplaceInvalidCharacters: false, shouldTreatTitleAsPath: false })).toBe(String.raw`foo\bar`);
  });
});
