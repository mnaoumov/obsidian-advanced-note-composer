import {
  describe,
  expect,
  it
} from 'vitest';

import { addMergedNoteAlias } from './merged-note-alias.ts';

describe('addMergedNoteAlias', () => {
  it('should append the source name to an existing list', () => {
    expect(addMergedNoteAlias({ existingAliases: ['a'], sourceName: 'Old', targetName: 'New' })).toEqual(['a', 'Old']);
  });

  it('should start a list when the target has no aliases', () => {
    expect(addMergedNoteAlias({ existingAliases: undefined, sourceName: 'Old', targetName: 'New' })).toEqual(['Old']);
  });

  it('should keep a single-value alias', () => {
    expect(addMergedNoteAlias({ existingAliases: 'a', sourceName: 'Old', targetName: 'New' })).toEqual(['a', 'Old']);
  });

  it('should skip an alias the target already has, ignoring case', () => {
    expect(addMergedNoteAlias({ existingAliases: ['old'], sourceName: 'Old', targetName: 'New' })).toBeNull();
  });

  it('should skip when the two names are equal, ignoring case', () => {
    expect(addMergedNoteAlias({ existingAliases: [], sourceName: 'Note', targetName: 'note' })).toBeNull();
  });

  it('should skip a blank source name', () => {
    expect(addMergedNoteAlias({ existingAliases: [], sourceName: ' ', targetName: 'New' })).toBeNull();
  });
});
