import {
  describe,
  expect,
  it
} from 'vitest';

import {
  INVALID_CHARACTERS_REG_EXP,
  TRAILING_DOTS_OR_SPACES_REG_EXP
} from './filename-validation.ts';

describe('INVALID_CHARACTERS_REG_EXP', () => {
  it('should match asterisk', () => {
    expect('file*name').toMatch(INVALID_CHARACTERS_REG_EXP);
  });

  it('should match backslash', () => {
    expect('file\\name').toMatch(INVALID_CHARACTERS_REG_EXP);
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

describe('TRAILING_DOTS_OR_SPACES_REG_EXP', () => {
  it('should match trailing dots', () => {
    expect('filename...').toMatch(TRAILING_DOTS_OR_SPACES_REG_EXP);
  });

  it('should match trailing spaces', () => {
    expect('filename   ').toMatch(TRAILING_DOTS_OR_SPACES_REG_EXP);
  });

  it('should match trailing mix of dots and spaces', () => {
    expect('filename. .').toMatch(TRAILING_DOTS_OR_SPACES_REG_EXP);
  });

  it('should not match valid filename without trailing dots or spaces', () => {
    TRAILING_DOTS_OR_SPACES_REG_EXP.lastIndex = 0;
    expect(TRAILING_DOTS_OR_SPACES_REG_EXP.test('filename')).toBe(false);
  });

  it('should not match dots in the middle', () => {
    TRAILING_DOTS_OR_SPACES_REG_EXP.lastIndex = 0;
    expect(TRAILING_DOTS_OR_SPACES_REG_EXP.test('file.name')).toBe(false);
  });
});
