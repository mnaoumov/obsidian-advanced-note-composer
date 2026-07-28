import type {
  App,
  FuzzyMatch,
  TAbstractFile,
  TFile,
  TFolder,
  Vault,
  Workspace
} from 'obsidian';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  getRecentFilePaths,
  reorderSuggestionsByRecentFiles,
  reorderSuggestionsByRecentFolders
} from './recent-suggestions.ts';

const FOLDER_A = castTo<TFolder>({ path: 'A' });
const FOLDER_B = castTo<TFolder>({ path: 'B' });
const FOLDER_C = castTo<TFolder>({ path: 'C' });
const FOLDER_D = castTo<TFolder>({ path: 'D' });

const FILE_A1 = castTo<TFile>({ parent: FOLDER_A, path: 'A/1.md' });
const FILE_A2 = castTo<TFile>({ parent: FOLDER_A, path: 'A/2.md' });
const FILE_B1 = castTo<TFile>({ parent: FOLDER_B, path: 'B/1.md' });
const FILE_C1 = castTo<TFile>({ parent: FOLDER_C, path: 'C/1.md' });
const FILE_ORPHAN = castTo<TFile>({ parent: null, path: 'orphan.md' });

const FILE_MAP: Record<string, TFile> = {
  [FILE_A1.path]: FILE_A1,
  [FILE_A2.path]: FILE_A2,
  [FILE_B1.path]: FILE_B1,
  [FILE_C1.path]: FILE_C1,
  [FILE_ORPHAN.path]: FILE_ORPHAN
};

const EXPECTED_MAX_COUNT = 50;

function createApp(recentPaths: string[], activeFile: null | TFile = null): App {
  return strictProxy<App>({
    vault: strictProxy<Vault>({
      getFileByPath: vi.fn((path: string) => FILE_MAP[path] ?? null)
    }),
    workspace: strictProxy<Workspace>({
      getActiveFile: vi.fn().mockReturnValue(activeFile),
      getRecentFiles: vi.fn().mockReturnValue(recentPaths)
    })
  });
}

function items<Item extends TAbstractFile>(suggestions: FuzzyMatch<Item>[]): Item[] {
  return suggestions.map((fuzzyMatch) => fuzzyMatch.item);
}

function suggestion<Item extends TAbstractFile>(item: Item): FuzzyMatch<Item> {
  return { item, match: { matches: [], score: -1 } };
}

describe('getRecentFilePaths', () => {
  it('should ask Obsidian for more than its own default of 10 recent files', () => {
    const app = createApp([FILE_A1.path]);
    getRecentFilePaths({ app, shouldIncludeActiveFile: false });
    expect(vi.mocked(app.workspace.getRecentFiles)).toHaveBeenCalledWith(expect.objectContaining({ maxCount: EXPECTED_MAX_COUNT }));
  });

  it('should return the recent paths untouched when the active file is not wanted', () => {
    const app = createApp([FILE_B1.path, FILE_A1.path], FILE_C1);
    expect(getRecentFilePaths({ app, shouldIncludeActiveFile: false })).toStrictEqual([FILE_B1.path, FILE_A1.path]);
  });

  // Obsidian's `RecentFileTracker` collects the file you just LEFT — `Workspace`'s active-leaf change
  // Calls `recentFileTracker.onFileOpen(newFile, previousFile)` and the tracker collects the SECOND
  // Argument — so the active file is never at the head of `getRecentFiles()` and has to be prepended
  // (issue #158).
  it('should prepend the active file, which Obsidian never puts at the head of its own recent list', () => {
    const app = createApp([FILE_B1.path, FILE_A1.path], FILE_C1);
    expect(getRecentFilePaths({ app, shouldIncludeActiveFile: true })).toStrictEqual([FILE_C1.path, FILE_B1.path, FILE_A1.path]);
  });

  it('should return the recent paths untouched when there is no active file', () => {
    const app = createApp([FILE_B1.path, FILE_A1.path]);
    expect(getRecentFilePaths({ app, shouldIncludeActiveFile: true })).toStrictEqual([FILE_B1.path, FILE_A1.path]);
  });
});

describe('reorderSuggestionsByRecentFolders', () => {
  it('should return the suggestions unchanged when there is a query', () => {
    const app = createApp([FILE_A1.path]);
    const suggestions = [suggestion(FOLDER_A), suggestion(FOLDER_B)];
    const result = reorderSuggestionsByRecentFolders({
      app,
      isAllowedFolder: () => true,
      query: 'a',
      suggestions
    });
    expect(result).toBe(suggestions);
    expect(vi.mocked(app.workspace.getRecentFiles)).not.toHaveBeenCalled();
  });

  it('should return the suggestions unchanged when there are no recent files', () => {
    const app = createApp([]);
    const suggestions = [suggestion(FOLDER_A), suggestion(FOLDER_B)];
    const result = reorderSuggestionsByRecentFolders({
      app,
      isAllowedFolder: () => true,
      query: '',
      suggestions
    });
    expect(items(result)).toStrictEqual([FOLDER_A, FOLDER_B]);
  });

  it('should surface recent folders first, deduped and filtered, followed by the rest', () => {
    const app = createApp([FILE_A1.path, 'missing.md', FILE_ORPHAN.path, FILE_A2.path, FILE_C1.path, FILE_B1.path]);
    const suggestions = [suggestion(FOLDER_A), suggestion(FOLDER_B), suggestion(FOLDER_C), suggestion(FOLDER_D)];
    const result = reorderSuggestionsByRecentFolders({
      app,
      // Disallow folder C so a recent folder that fails the caller's constraint is skipped.
      isAllowedFolder: (folder) => folder !== FOLDER_C,
      query: '',
      suggestions
    });

    // Recent order: A (from A/1.md), then B (from B/1.md); missing.md / orphan.md / C are skipped and
    // A/2.md is a duplicate.
    expect(items(result)).toStrictEqual([FOLDER_A, FOLDER_B, FOLDER_C, FOLDER_D]);
    // The two recent folders are emitted with a synthetic zero-score match, ahead of the fuzzy ones.
    expect(result[0]?.match).toStrictEqual({ matches: [], score: 0 });
    expect(result[1]?.match).toStrictEqual({ matches: [], score: 0 });
    expect(result[2]?.match.score).toBe(-1);
  });

  // Issue #158: visiting A then B then C leaves Obsidian's recent list as [B, A, ...] with C active, so
  // Without the active file the folder the user is ON (C) is not offered first — B's folder is the
  // Operation's source and filtered out, which is exactly how the reporter's first suggestion became A.
  it('should offer the folder of the active file first', () => {
    const app = createApp([FILE_B1.path, FILE_A1.path], FILE_C1);
    const suggestions = [suggestion(FOLDER_A), suggestion(FOLDER_C), suggestion(FOLDER_D)];
    const result = reorderSuggestionsByRecentFolders({
      app,
      // Folder B is the operation's source folder, as when the command is triggered on it.
      isAllowedFolder: (folder) => folder !== FOLDER_B,
      query: '',
      suggestions
    });
    expect(items(result)).toStrictEqual([FOLDER_C, FOLDER_A, FOLDER_D]);
  });

  // The active file can still sit somewhere further down Obsidian's list (a vault `create` collects it
  // Too), so the de-duplication has to keep the prepended copy rather than the later one.
  it('should keep the folder of the active file first when it is also further down the recent list', () => {
    const app = createApp([FILE_B1.path, FILE_C1.path], FILE_C1);
    const suggestions = [suggestion(FOLDER_B), suggestion(FOLDER_C)];
    const result = reorderSuggestionsByRecentFolders({
      app,
      isAllowedFolder: () => true,
      query: '',
      suggestions
    });
    expect(items(result)).toStrictEqual([FOLDER_C, FOLDER_B]);
  });

  it('should not offer the folder of the active file when the caller disallows it', () => {
    const app = createApp([FILE_A1.path], FILE_C1);
    const suggestions = [suggestion(FOLDER_A), suggestion(FOLDER_D)];
    const result = reorderSuggestionsByRecentFolders({
      app,
      isAllowedFolder: (folder) => folder !== FOLDER_C,
      query: '',
      suggestions
    });
    expect(items(result)).toStrictEqual([FOLDER_A, FOLDER_D]);
  });
});

describe('reorderSuggestionsByRecentFiles', () => {
  it('should return the suggestions unchanged when there is a query', () => {
    const app = createApp([FILE_A1.path]);
    const suggestions = [suggestion(FILE_A1), suggestion(FILE_B1)];
    const result = reorderSuggestionsByRecentFiles({
      app,
      isAllowedFile: () => true,
      query: 'a',
      suggestions
    });
    expect(result).toBe(suggestions);
    expect(vi.mocked(app.workspace.getRecentFiles)).not.toHaveBeenCalled();
  });

  it('should surface recent files first, deduped and filtered, followed by the rest', () => {
    const app = createApp([FILE_B1.path, 'missing.md', FILE_B1.path, FILE_C1.path, FILE_A1.path]);
    const suggestions = [suggestion(FILE_A1), suggestion(FILE_A2), suggestion(FILE_B1), suggestion(FILE_C1)];
    const result = reorderSuggestionsByRecentFiles({
      app,
      // Disallow C/1.md so a recent file that fails the caller's constraint is skipped.
      isAllowedFile: (file) => file !== FILE_C1,
      query: '',
      suggestions
    });
    expect(items(result)).toStrictEqual([FILE_B1, FILE_A1, FILE_A2, FILE_C1]);
  });

  // A file picker's source IS the active file, and every file picker already excludes it, so the active
  // File is deliberately NOT prepended there.
  it('should not prepend the active file', () => {
    const app = createApp([FILE_B1.path], FILE_A1);
    const suggestions = [suggestion(FILE_A1), suggestion(FILE_B1)];
    const result = reorderSuggestionsByRecentFiles({
      app,
      isAllowedFile: () => true,
      query: '',
      suggestions
    });
    expect(items(result)).toStrictEqual([FILE_B1, FILE_A1]);
    expect(vi.mocked(app.workspace.getActiveFile)).not.toHaveBeenCalled();
  });
});
