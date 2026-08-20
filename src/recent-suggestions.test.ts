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
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { PickerRecencyOrder } from './plugin-settings.ts';
import {
  getRecentPaths,
  reorderSuggestionsByRecentFiles,
  reorderSuggestionsByRecentFolders
} from './recent-suggestions.ts';
import {
  clearRecentTargets,
  recordRecentTarget
} from './recent-targets.ts';

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

const FOLDER_MAP: Record<string, TFolder> = {
  [FOLDER_A.path]: FOLDER_A,
  [FOLDER_B.path]: FOLDER_B,
  [FOLDER_C.path]: FOLDER_C,
  [FOLDER_D.path]: FOLDER_D
};

const EXPECTED_MAX_COUNT = 50;

function createApp(recentPaths: string[], activeFile: null | TFile = null): App {
  return strictProxy<App>({
    vault: strictProxy<Vault>({
      getFileByPath: vi.fn((path: string) => FILE_MAP[path] ?? null),
      getFolderByPath: vi.fn((path: string) => FOLDER_MAP[path] ?? null)
    }),
    workspace: strictProxy<Workspace>({
      getActiveFile: vi.fn().mockReturnValue(activeFile),
      getRecentFiles: vi.fn().mockReturnValue(recentPaths)
    })
  });
}

// The recorded targets are module state shared by every test in this file, so a leak from one would
// Silently reorder the next one's expectations.
beforeEach(() => {
  clearRecentTargets();
});

function items<Item extends TAbstractFile>(suggestions: FuzzyMatch<Item>[]): Item[] {
  return suggestions.map((fuzzyMatch) => fuzzyMatch.item);
}

function suggestion<Item extends TAbstractFile>(item: Item): FuzzyMatch<Item> {
  return { item, match: { matches: [], score: -1 } };
}

describe('getRecentPaths', () => {
  it('should ask Obsidian for more than its own default of 10 recent files', () => {
    const app = createApp([FILE_A1.path]);
    getRecentPaths({ app, pickerRecencyOrder: PickerRecencyOrder.RecentTargetsFirst, shouldIncludeActiveFile: false });
    expect(vi.mocked(app.workspace.getRecentFiles)).toHaveBeenCalledWith(expect.objectContaining({ maxCount: EXPECTED_MAX_COUNT }));
  });

  it('should return the recent paths untouched when the active file is not wanted', () => {
    const app = createApp([FILE_B1.path, FILE_A1.path], FILE_C1);
    expect(getRecentPaths({ app, pickerRecencyOrder: PickerRecencyOrder.RecentTargetsFirst, shouldIncludeActiveFile: false })).toStrictEqual([FILE_B1.path, FILE_A1.path]);
  });

  // Obsidian's `RecentFileTracker` collects the file you just LEFT — `Workspace`'s active-leaf change
  // Calls `recentFileTracker.onFileOpen(newFile, previousFile)` and the tracker collects the SECOND
  // Argument — so the active file is never at the head of `getRecentFiles()` and has to be prepended
  // (issue #158).
  it('should prepend the active file, which Obsidian never puts at the head of its own recent list', () => {
    const app = createApp([FILE_B1.path, FILE_A1.path], FILE_C1);
    expect(getRecentPaths({ app, pickerRecencyOrder: PickerRecencyOrder.RecentTargetsFirst, shouldIncludeActiveFile: true })).toStrictEqual([FILE_C1.path, FILE_B1.path, FILE_A1.path]);
  });

  it('should return the recent paths untouched when there is no active file', () => {
    const app = createApp([FILE_B1.path, FILE_A1.path]);
    expect(getRecentPaths({ app, pickerRecencyOrder: PickerRecencyOrder.RecentTargetsFirst, shouldIncludeActiveFile: true })).toStrictEqual([FILE_B1.path, FILE_A1.path]);
  });

  // Issue #206: a completed operation's target outranks even the active file. The two only disagree when
  // The user runs a second operation without first navigating into the folder the previous one landed in,
  // Which is precisely the case the request is about.
  it('should put the recorded targets ahead of the active file and of Obsidian\'s own list', () => {
    const app = createApp([FILE_B1.path], FILE_C1);
    recordRecentTarget(FOLDER_A);
    expect(getRecentPaths({ app, pickerRecencyOrder: PickerRecencyOrder.RecentTargetsFirst, shouldIncludeActiveFile: true })).toStrictEqual([FOLDER_A.path, FILE_C1.path, FILE_B1.path]);
  });

  // Issue #248: the same reporter then found that #206's ordering means clicking into another note no
  // Longer moves that note's folder to the top. Both orderings are reasonable, so it is a choice.
  it('should put the active file ahead of the recorded targets when asked to', () => {
    const app = createApp([FILE_B1.path], FILE_C1);
    recordRecentTarget(FOLDER_A);
    expect(getRecentPaths({ app, pickerRecencyOrder: PickerRecencyOrder.ActiveFileFirst, shouldIncludeActiveFile: true }))
      .toStrictEqual([FILE_C1.path, FOLDER_A.path, FILE_B1.path]);
  });

  it('should ignore the order when the picker does not want the active file at all', () => {
    // A file picker excludes the active file as the operation's own source, so there is nothing for the
    // Two orderings to disagree about.
    const app = createApp([FILE_B1.path], FILE_C1);
    recordRecentTarget(FOLDER_A);
    expect(getRecentPaths({ app, pickerRecencyOrder: PickerRecencyOrder.ActiveFileFirst, shouldIncludeActiveFile: false }))
      .toStrictEqual([FOLDER_A.path, FILE_B1.path]);
  });

  it('should ignore the order when there is no active file', () => {
    const app = createApp([FILE_B1.path]);
    recordRecentTarget(FOLDER_A);
    expect(getRecentPaths({ app, pickerRecencyOrder: PickerRecencyOrder.ActiveFileFirst, shouldIncludeActiveFile: true }))
      .toStrictEqual([FOLDER_A.path, FILE_B1.path]);
  });

  it('should put the recorded targets ahead of Obsidian\'s own list when the active file is not wanted', () => {
    const app = createApp([FILE_B1.path], FILE_C1);
    recordRecentTarget(FOLDER_A);
    expect(getRecentPaths({ app, pickerRecencyOrder: PickerRecencyOrder.RecentTargetsFirst, shouldIncludeActiveFile: false })).toStrictEqual([FOLDER_A.path, FILE_B1.path]);
  });

  it('should put the recorded targets first when there is no active file', () => {
    const app = createApp([FILE_B1.path]);
    recordRecentTarget(FOLDER_A);
    expect(getRecentPaths({ app, pickerRecencyOrder: PickerRecencyOrder.RecentTargetsFirst, shouldIncludeActiveFile: true })).toStrictEqual([FOLDER_A.path, FILE_B1.path]);
  });
});

describe('reorderSuggestionsByRecentFolders', () => {
  it('should return the suggestions unchanged when there is a query', () => {
    const app = createApp([FILE_A1.path]);
    const suggestions = [suggestion(FOLDER_A), suggestion(FOLDER_B)];
    const result = reorderSuggestionsByRecentFolders({
      app,
      isAllowedFolder: () => true,
      pickerRecencyOrder: PickerRecencyOrder.RecentTargetsFirst,
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
      pickerRecencyOrder: PickerRecencyOrder.RecentTargetsFirst,
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
      pickerRecencyOrder: PickerRecencyOrder.RecentTargetsFirst,
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
      pickerRecencyOrder: PickerRecencyOrder.RecentTargetsFirst,
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
      pickerRecencyOrder: PickerRecencyOrder.RecentTargetsFirst,
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
      pickerRecencyOrder: PickerRecencyOrder.RecentTargetsFirst,
      query: '',
      suggestions
    });
    expect(items(result)).toStrictEqual([FOLDER_A, FOLDER_D]);
  });

  // Issue #206: the folder a completed operation targeted leads the list — ahead of the folder of the note
  // The user is on, which is issue #158's own first pick. This ordering is the owner's call, so it is
  // Pinned here rather than left to fall out of the implementation.
  it('should offer a recorded target folder ahead of the folder of the active file', () => {
    const app = createApp([FILE_A1.path], FILE_C1);
    const suggestions = [suggestion(FOLDER_A), suggestion(FOLDER_C), suggestion(FOLDER_D)];
    recordRecentTarget(FOLDER_D);
    const result = reorderSuggestionsByRecentFolders({
      app,
      isAllowedFolder: () => true,
      pickerRecencyOrder: PickerRecencyOrder.RecentTargetsFirst,
      query: '',
      suggestions
    });
    expect(items(result)).toStrictEqual([FOLDER_D, FOLDER_C, FOLDER_A]);
  });

  // The other half of issue #206: merging a note INTO another note makes that note's folder a destination
  // Too, which falls out of the same resolution that turns a recently-opened file into its folder.
  it('should offer the parent folder of a recorded target file', () => {
    const app = createApp([], FILE_C1);
    const suggestions = [suggestion(FOLDER_B), suggestion(FOLDER_C)];
    recordRecentTarget(FILE_B1);
    const result = reorderSuggestionsByRecentFolders({
      app,
      isAllowedFolder: () => true,
      pickerRecencyOrder: PickerRecencyOrder.RecentTargetsFirst,
      query: '',
      suggestions
    });
    expect(items(result)).toStrictEqual([FOLDER_B, FOLDER_C]);
  });

  it('should skip a recorded target the caller disallows', () => {
    const app = createApp([]);
    const suggestions = [suggestion(FOLDER_A), suggestion(FOLDER_D)];
    recordRecentTarget(FOLDER_D);
    const result = reorderSuggestionsByRecentFolders({
      app,
      isAllowedFolder: (folder) => folder !== FOLDER_D,
      pickerRecencyOrder: PickerRecencyOrder.RecentTargetsFirst,
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
      pickerRecencyOrder: PickerRecencyOrder.RecentTargetsFirst,
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
      pickerRecencyOrder: PickerRecencyOrder.RecentTargetsFirst,
      query: '',
      suggestions
    });
    expect(items(result)).toStrictEqual([FILE_B1, FILE_A1, FILE_A2, FILE_C1]);
  });

  // Issue #206: a recorded target FILE leads a file picker, while a recorded target FOLDER resolves to
  // Nothing here and is skipped — which is what keeps the folder half of the one recorded list out of the
  // File pickers.
  it('should offer a recorded target file first and skip a recorded target folder', () => {
    const app = createApp([FILE_A1.path]);
    const suggestions = [suggestion(FILE_A1), suggestion(FILE_B1)];
    recordRecentTarget(FILE_B1);
    recordRecentTarget(FOLDER_C);
    const result = reorderSuggestionsByRecentFiles({
      app,
      isAllowedFile: () => true,
      pickerRecencyOrder: PickerRecencyOrder.RecentTargetsFirst,
      query: '',
      suggestions
    });
    expect(items(result)).toStrictEqual([FILE_B1, FILE_A1]);
  });

  // A file picker's source IS the active file, and every file picker already excludes it, so the active
  // File is deliberately NOT prepended there.
  it('should not prepend the active file', () => {
    const app = createApp([FILE_B1.path], FILE_A1);
    const suggestions = [suggestion(FILE_A1), suggestion(FILE_B1)];
    const result = reorderSuggestionsByRecentFiles({
      app,
      isAllowedFile: () => true,
      pickerRecencyOrder: PickerRecencyOrder.RecentTargetsFirst,
      query: '',
      suggestions
    });
    expect(items(result)).toStrictEqual([FILE_B1, FILE_A1]);
    expect(vi.mocked(app.workspace.getActiveFile)).not.toHaveBeenCalled();
  });
});
