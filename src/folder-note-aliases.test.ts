import {
  describe,
  expect,
  it
} from 'vitest';

import { swapDerivedAlias } from './folder-note-aliases.ts';

describe('swapDerivedAlias', () => {
  it('should replace the derived alias where it stands', () => {
    expect(swapDerivedAlias({ existingAliases: ['Alpha'], newAlias: 'Beta', oldAlias: 'Alpha' })).toEqual(['Beta']);
  });

  it('should keep every other alias, in its own position', () => {
    expect(swapDerivedAlias({
      existingAliases: ['first', 'Alpha', 'last'],
      newAlias: 'Beta',
      oldAlias: 'Alpha'
    })).toEqual(['first', 'Beta', 'last']);
  });

  it('should append when the old alias is not there, so a note gains the alias it never had', () => {
    expect(swapDerivedAlias({ existingAliases: ['mine'], newAlias: 'Beta', oldAlias: 'Alpha' })).toEqual(['mine', 'Beta']);
  });

  it('should leave the list alone when it already carries the new alias', () => {
    expect(swapDerivedAlias({ existingAliases: ['Beta', 'mine'], newAlias: 'Beta', oldAlias: 'Alpha' })).toEqual(['Beta', 'mine']);
  });

  it('should drop the duplicate a rename back onto a listed name would create', () => {
    // Renaming `Alpha` back to `Beta` while `Beta` is still listed further down leaves ONE entry, at the
    // Derived alias's own position.
    expect(swapDerivedAlias({
      existingAliases: ['Alpha', 'mine', 'Beta'],
      newAlias: 'Beta',
      oldAlias: 'Alpha'
    })).toEqual(['Beta', 'mine']);
  });

  it('should start a list for a note that has no aliases at all', () => {
    expect(swapDerivedAlias({ existingAliases: undefined, newAlias: 'Beta', oldAlias: 'Alpha' })).toEqual(['Beta']);
  });

  it('should treat a bare `aliases:` line as an empty list', () => {
    expect(swapDerivedAlias({ existingAliases: null, newAlias: 'Beta', oldAlias: 'Alpha' })).toEqual(['Beta']);
  });

  it('should accept the single-value `aliases: alpha` form', () => {
    expect(swapDerivedAlias({ existingAliases: 'Alpha', newAlias: 'Beta', oldAlias: 'Alpha' })).toEqual(['Beta']);
  });

  it('should drop entries that were never usable aliases rather than stringifying them', () => {
    expect(swapDerivedAlias({
      existingAliases: ['Alpha', 42, { nested: true }],
      newAlias: 'Beta',
      oldAlias: 'Alpha'
    })).toEqual(['Beta']);
  });

  it('should be a no-op when both names render to the same alias', () => {
    expect(swapDerivedAlias({ existingAliases: ['Same', 'mine'], newAlias: 'Same', oldAlias: 'Same' })).toEqual(['Same', 'mine']);
  });
});
