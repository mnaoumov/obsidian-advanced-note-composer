import type {
  App,
  FuzzyMatch,
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

import { reorderSuggestionsByRecentFolders } from './recent-folder-suggestions.ts';

const FOLDER_A = castTo<TFolder>({ path: 'A' });
const FOLDER_B = castTo<TFolder>({ path: 'B' });
const FOLDER_C = castTo<TFolder>({ path: 'C' });
const FOLDER_D = castTo<TFolder>({ path: 'D' });

const FILE_MAP: Record<string, TFile> = {
  'A/1.md': castTo<TFile>({ parent: FOLDER_A, path: 'A/1.md' }),
  'A/2.md': castTo<TFile>({ parent: FOLDER_A, path: 'A/2.md' }),
  'B/1.md': castTo<TFile>({ parent: FOLDER_B, path: 'B/1.md' }),
  'C/1.md': castTo<TFile>({ parent: FOLDER_C, path: 'C/1.md' }),
  'orphan.md': castTo<TFile>({ parent: null, path: 'orphan.md' })
};

function createApp(recentPaths: string[]): App {
  return strictProxy<App>({
    vault: strictProxy<Vault>({
      getFileByPath: vi.fn((path: string) => FILE_MAP[path] ?? null)
    }),
    workspace: strictProxy<Workspace>({
      getRecentFiles: vi.fn().mockReturnValue(recentPaths)
    })
  });
}

function suggestion(folder: TFolder): FuzzyMatch<TFolder> {
  return { item: folder, match: { matches: [], score: -1 } };
}

describe('reorderSuggestionsByRecentFolders', () => {
  it('should return the suggestions unchanged when there is a query', () => {
    const app = createApp(['A/1.md']);
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
    expect(result.map((s) => s.item)).toStrictEqual([FOLDER_A, FOLDER_B]);
  });

  it('should surface recent folders first, deduped and filtered, followed by the rest', () => {
    const app = createApp(['A/1.md', 'missing.md', 'orphan.md', 'A/2.md', 'C/1.md', 'B/1.md']);
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
    expect(result.map((s) => s.item)).toStrictEqual([FOLDER_A, FOLDER_B, FOLDER_C, FOLDER_D]);
    // The two recent folders are emitted with a synthetic zero-score match, ahead of the fuzzy ones.
    expect(result[0]?.match).toStrictEqual({ matches: [], score: 0 });
    expect(result[1]?.match).toStrictEqual({ matches: [], score: 0 });
    expect(result[2]?.match.score).toBe(-1);
  });
});
