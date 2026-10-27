import {
  describe,
  expect,
  it
} from 'vitest';

import { swapDerivedAliases } from './folder-note-aliases.ts';

describe('swapDerivedAliases', () => {
  it('should replace the derived alias where it stands', () => {
    expect(swapDerivedAliases({ existingAliases: ['Alpha'], newAliases: ['Beta'], oldAliases: ['Alpha'] })).toEqual(['Beta']);
  });

  it('should keep every other alias, in its own position', () => {
    expect(swapDerivedAliases({
      existingAliases: ['first', 'Alpha', 'last'],
      newAliases: ['Beta'],
      oldAliases: ['Alpha']
    })).toEqual(['first', 'Beta', 'last']);
  });

  it('should append when the old alias is not there, so a note gains the alias it never had', () => {
    expect(swapDerivedAliases({ existingAliases: ['mine'], newAliases: ['Beta'], oldAliases: ['Alpha'] })).toEqual(['mine', 'Beta']);
  });

  it('should leave the list alone when it already carries the new alias', () => {
    expect(swapDerivedAliases({ existingAliases: ['Beta', 'mine'], newAliases: ['Beta'], oldAliases: ['Alpha'] })).toEqual(['Beta', 'mine']);
  });

  it('should drop the duplicate a rename back onto a listed name would create', () => {
    // Renaming `Alpha` back to `Beta` while `Beta` is still listed further down leaves ONE entry, at the
    // derived alias's own position.
    expect(swapDerivedAliases({
      existingAliases: ['Alpha', 'mine', 'Beta'],
      newAliases: ['Beta'],
      oldAliases: ['Alpha']
    })).toEqual(['Beta', 'mine']);
  });

  it('should start a list for a note that has no aliases at all', () => {
    expect(swapDerivedAliases({ existingAliases: undefined, newAliases: ['Beta'], oldAliases: ['Alpha'] })).toEqual(['Beta']);
  });

  it('should treat a bare `aliases:` line as an empty list', () => {
    expect(swapDerivedAliases({ existingAliases: null, newAliases: ['Beta'], oldAliases: ['Alpha'] })).toEqual(['Beta']);
  });

  it('should accept the single-value `aliases: alpha` form', () => {
    expect(swapDerivedAliases({ existingAliases: 'Alpha', newAliases: ['Beta'], oldAliases: ['Alpha'] })).toEqual(['Beta']);
  });

  it('should drop entries that were never usable aliases rather than stringifying them', () => {
    expect(swapDerivedAliases({
      existingAliases: ['Alpha', 42, { nested: true }],
      newAliases: ['Beta'],
      oldAliases: ['Alpha']
    })).toEqual(['Beta']);
  });

  it('should be a no-op when both names render to the same alias', () => {
    expect(swapDerivedAliases({ existingAliases: ['Same', 'mine'], newAliases: ['Same'], oldAliases: ['Same'] })).toEqual(['Same', 'mine']);
  });

  it('should write several new aliases as a block where the first old one stood', () => {
    expect(swapDerivedAliases({
      existingAliases: ['first', 'A', 'mine', 'B', 'last'],
      newAliases: ['C', 'D'],
      oldAliases: ['A', 'B']
    })).toEqual(['first', 'C', 'D', 'mine', 'last']);
  });

  it('should list an alias both renders produce once, when the old and new sets overlap', () => {
    expect(swapDerivedAliases({
      existingAliases: ['mine', 'A', 'B'],
      newAliases: ['B', 'C'],
      oldAliases: ['A', 'B']
    })).toEqual(['mine', 'B', 'C']);
  });

  it('should append only the new aliases the note lacks when none of the old ones is there', () => {
    expect(swapDerivedAliases({
      existingAliases: ['mine', 'D'],
      newAliases: ['C', 'D'],
      oldAliases: ['A', 'B']
    })).toEqual(['mine', 'D', 'C']);
  });

  it('should collapse a new alias the template produced twice', () => {
    expect(swapDerivedAliases({ existingAliases: ['A'], newAliases: ['C', 'C'], oldAliases: ['A'] })).toEqual(['C']);
  });

  it('should drop the old aliases and add nothing when the new name renders none', () => {
    expect(swapDerivedAliases({ existingAliases: ['A', 'mine'], newAliases: [], oldAliases: ['A'] })).toEqual(['mine']);
  });
});
