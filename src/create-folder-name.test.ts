import {
  describe,
  expect,
  it
} from 'vitest';

import type { NormalizeTypedFolderNameParams } from './create-folder-name.ts';

import { normalizeTypedFolderName } from './create-folder-name.ts';

function normalize(rawName: string, overrides: Partial<NormalizeTypedFolderNameParams> = {}): string {
  return normalizeTypedFolderName({
    rawName,
    replacement: '_',
    shouldReplaceInvalidCharacters: true,
    shouldTitleCase: true,
    ...overrides
  });
}

describe('normalizeTypedFolderName', () => {
  describe('whitespace', () => {
    it('should trim leading and trailing whitespace', () => {
      expect(normalize('   notes   ')).toBe('Notes');
    });

    it('should collapse a run of spaces into one', () => {
      expect(normalize('my     notes')).toBe('My Notes');
    });

    it('should collapse tabs and newlines into a single space', () => {
      expect(normalize('my\t\tnotes\nhere')).toBe('My Notes Here');
    });

    it('should return an empty string for whitespace only', () => {
      expect(normalize(' '.repeat(3))).toBe('');
    });

    it('should return an empty string for an empty name', () => {
      expect(normalize('')).toBe('');
    });
  });

  describe('dots', () => {
    it('should strip leading dots', () => {
      expect(normalize('...notes')).toBe('Notes');
    });

    it('should strip trailing dots', () => {
      expect(normalize('notes...')).toBe('Notes');
    });

    it('should keep an inner dot', () => {
      expect(normalize('v1.2 notes')).toBe('V1.2 Notes');
    });

    it('should return an empty string for dots only', () => {
      expect(normalize('...')).toBe('');
    });
  });

  describe('title case', () => {
    it('should capitalize the first letter of each word and lower-case the rest', () => {
      // The reporter's own video: `test notes` becomes `Test Notes`.
      expect(normalize('test notes')).toBe('Test Notes');
    });

    it('should lower-case the tail of a mixed-case word', () => {
      expect(normalize('nOtEs')).toBe('Notes');
    });

    it('should leave a fully upper-case word alone, so an acronym survives', () => {
      expect(normalize('api TEST')).toBe('Api TEST');
    });

    it('should capitalize a single upper-case letter like any other word', () => {
      expect(normalize('a b')).toBe('A B');
    });

    it('should treat a hyphen as a word separator and keep it', () => {
      expect(normalize('foo-bar baz')).toBe('Foo-Bar Baz');
    });

    it('should keep the spacing around a spaced hyphen', () => {
      expect(normalize('FOO - bar')).toBe('FOO - Bar');
    });

    it('should leave digits alone', () => {
      expect(normalize('project 2026 notes')).toBe('Project 2026 Notes');
    });

    it('should leave the name as typed when turned off', () => {
      expect(normalize('test notes', { shouldTitleCase: false })).toBe('test notes');
    });

    it('should still trim and collapse when turned off', () => {
      expect(normalize('  test   notes  ', { shouldTitleCase: false })).toBe('test notes');
    });
  });

  describe('invalid characters', () => {
    it('should replace an invalid character with the replacement', () => {
      expect(normalize('a*b')).toBe('A_b');
    });

    it('should use the configured replacement', () => {
      expect(normalize('a*b', { replacement: '-' })).toBe('A-b');
    });

    it('should collapse a path-shaped name into one segment', () => {
      expect(normalize('a/b')).toBe('A_b');
    });

    it('should leave invalid characters in place when replacing is turned off', () => {
      // The caller reports this as invalid rather than silently rewriting it — the same choice the
      // Reporter's own plugin makes.
      expect(normalize('a*b', { shouldReplaceInvalidCharacters: false })).toBe('A*b');
    });
  });
});
