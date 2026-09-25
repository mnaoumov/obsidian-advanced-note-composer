import {
  describe,
  expect,
  it
} from 'vitest';

import {
  shouldKeepFolderNameSeparate,
  shouldKeepFolderPathSeparate
} from './keep-separate-folder-names.ts';

describe('shouldKeepFolderNameSeparate', () => {
  it('should keep nothing separate when the list is empty', () => {
    // The default: a vault that has not asked for issue #267 merges same-named folders as before.
    expect(shouldKeepFolderNameSeparate({ folderName: 'B', keepSeparateFolderNames: [] })).toBe(false);
  });

  it('should match a plain entry against the whole name', () => {
    expect(shouldKeepFolderNameSeparate({ folderName: 'B', keepSeparateFolderNames: ['B'] })).toBe(true);
  });

  it('should not match a plain entry that is only part of the name', () => {
    // A plain entry is a NAME, not a prefix — otherwise listing `B` would also catch `Backup`.
    expect(shouldKeepFolderNameSeparate({ folderName: 'Backup', keepSeparateFolderNames: ['B'] })).toBe(false);
  });

  it('should match a name against any entry of the list', () => {
    expect(shouldKeepFolderNameSeparate({ folderName: 'Attachments', keepSeparateFolderNames: ['B', 'Attachments'] })).toBe(true);
  });

  it('should match a regular expression literal against the name', () => {
    expect(shouldKeepFolderNameSeparate({ folderName: '3. Beta', keepSeparateFolderNames: [String.raw`/^\d+\. /`] })).toBe(true);
  });

  it('should treat a regular expression literal as unanchored, as the path lists do', () => {
    // `/B/` catches every name holding a `B`; `/^B$/` is the form that catches only the name itself.
    expect(shouldKeepFolderNameSeparate({ folderName: 'Backup', keepSeparateFolderNames: ['/B/'] })).toBe(true);
    expect(shouldKeepFolderNameSeparate({ folderName: 'Backup', keepSeparateFolderNames: ['/^B$/'] })).toBe(false);
  });

  it('should match a name that is itself a path-shaped string against nothing but that whole name', () => {
    // The list never speaks about paths, so an entry written as one matches only a folder literally
    // named that — which no folder can be, since a name cannot hold a slash.
    expect(shouldKeepFolderNameSeparate({ folderName: 'B', keepSeparateFolderNames: ['A/B'] })).toBe(false);
  });

  it('should ignore an un-parseable regular expression literal rather than throwing', () => {
    // Issue #155's division of labour: the registered `pathsValidator` is what tells the user, and the
    // half-typed literal behaves as if it had never been listed.
    expect(shouldKeepFolderNameSeparate({ folderName: 'Inbox', keepSeparateFolderNames: [String.raw`/^Inbox\/`] })).toBe(false);
  });

  it('should treat a lone slash as a plain name rather than an empty regular expression', () => {
    // `/` is one character, so it is not a `/…/` literal; an empty pattern would otherwise match every
    // folder in the vault.
    expect(shouldKeepFolderNameSeparate({ folderName: 'B', keepSeparateFolderNames: ['/'] })).toBe(false);
  });

  it('should be case-sensitive', () => {
    // No flags are parsed out of the literal, which is what every other list in this plugin does too.
    expect(shouldKeepFolderNameSeparate({ folderName: 'b', keepSeparateFolderNames: ['B'] })).toBe(false);
  });
});

describe('shouldKeepFolderPathSeparate', () => {
  it('should keep nothing separate when the list is empty', () => {
    expect(shouldKeepFolderPathSeparate({ keepSeparateFolderPaths: [], paths: ['A/B', 'E/B'] })).toBe(false);
  });

  it('should match a plain path against that folder and its whole subtree', () => {
    // Issue #296's "folders in folder X": `E` covers every folder under `E`, at any depth.
    expect(shouldKeepFolderPathSeparate({ keepSeparateFolderPaths: ['E'], paths: ['E/B'] })).toBe(true);
    expect(shouldKeepFolderPathSeparate({ keepSeparateFolderPaths: ['E'], paths: ['E/B/C'] })).toBe(true);
  });

  it('should not match a plain path that is only a prefix of a folder name', () => {
    // The include/exclude grammar: `E` covers `E/…`, never `Else`.
    expect(shouldKeepFolderPathSeparate({ keepSeparateFolderPaths: ['E'], paths: ['Else/B'] })).toBe(false);
  });

  it('should match when any of the folder paths matches', () => {
    // Where the folder comes from, or where it would land: either end of the merge can be named.
    expect(shouldKeepFolderPathSeparate({ keepSeparateFolderPaths: ['A'], paths: ['A/B', 'E/B'] })).toBe(true);
    expect(shouldKeepFolderPathSeparate({ keepSeparateFolderPaths: ['E'], paths: ['A/B', 'E/B'] })).toBe(true);
    expect(shouldKeepFolderPathSeparate({ keepSeparateFolderPaths: ['X'], paths: ['A/B', 'E/B'] })).toBe(false);
  });

  it('should test a regular expression literal against the full path', () => {
    expect(shouldKeepFolderPathSeparate({ keepSeparateFolderPaths: [String.raw`/^E\/[^/]+$/`], paths: ['E/B'] })).toBe(true);
    expect(shouldKeepFolderPathSeparate({ keepSeparateFolderPaths: [String.raw`/^E\/[^/]+$/`], paths: ['E/B/C'] })).toBe(false);
  });

  it('should match nothing while the list holds an un-parseable regular expression', () => {
    // The shared all-or-nothing fallback of issue #155; `pathsValidator` is what reports it.
    expect(shouldKeepFolderPathSeparate({ keepSeparateFolderPaths: ['E', String.raw`/^E\/`], paths: ['E/B'] })).toBe(false);
  });
});
