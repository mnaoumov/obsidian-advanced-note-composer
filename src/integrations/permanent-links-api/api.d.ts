import type { TFile } from 'obsidian';

/**
Contract version 1.1.0, published under plugin id `permanent-links`.
*/
export interface PermanentLinksApi {
  /**
  Adds an alias without removing existing keys. Rejects invalid or occupied keys.
  */
  addKey: (file: TFile, key: string) => Promise<void>;
  /**
  Reuses the first key or assigns a random twelve-character key.
  */
  assignKey: (file: TFile) => Promise<string>;
  /**
  Returns a copy of the file's keys, in primary-key order.
  */
  getKeys: (file: TFile) => readonly string[];
  /**
  Moves every source key to the destination, preserving its primary key and aliases.
  Clears a live source's key property. A deleted source may be passed using its
  last TFile object; its tombstones become live destination aliases. The destination
  must exist. Moving a file to itself does nothing. Does not move or delete content.
  Rejects write failures; callers must await completion before deleting a live source.
  */
  moveKeys: (fromFile: TFile, toFile: TFile) => Promise<void>;
  /**
  Resolves a live key; unknown or deleted files return `null`.
  */
  resolve: (key: string) => null | TFile;
}
