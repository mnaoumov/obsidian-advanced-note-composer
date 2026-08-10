import type { TFolder } from 'obsidian';

import { castTo } from 'obsidian-dev-utils/object-utils';
import {
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import {
  clearRecentTargets,
  getRecentTargetPaths,
  recordRecentTarget
} from './recent-targets.ts';

const FOLDER_A = castTo<TFolder>({ path: 'A' });
const FOLDER_B = castTo<TFolder>({ path: 'B' });

const MAX_COUNT = 50;

beforeEach(() => {
  clearRecentTargets();
});

describe('recordRecentTarget', () => {
  it('should record nothing until an operation completes', () => {
    expect(getRecentTargetPaths()).toStrictEqual([]);
  });

  it('should record the targets most-recent-first', () => {
    recordRecentTarget(FOLDER_A);
    recordRecentTarget(FOLDER_B);
    expect(getRecentTargetPaths()).toStrictEqual([FOLDER_B.path, FOLDER_A.path]);
  });

  it('should accept a path, which is what a swap or a move has to pass', () => {
    // A swap/move mutates `TAbstractFile.path`, so those flows record the path they captured before the
    // Rename rather than the object.
    recordRecentTarget('Some/Folder');
    expect(getRecentTargetPaths()).toStrictEqual(['Some/Folder']);
  });

  // Targeting the same folder again has to re-head it: a second operation into it is the strongest signal
  // There is that it should be offered first (issue #206).
  it('should re-head a target that is recorded again', () => {
    recordRecentTarget(FOLDER_A);
    recordRecentTarget(FOLDER_B);
    recordRecentTarget(FOLDER_A);
    expect(getRecentTargetPaths()).toStrictEqual([FOLDER_A.path, FOLDER_B.path]);
  });

  it('should keep at most the most recent targets', () => {
    const overflow = MAX_COUNT + 1;
    for (let index = 0; index < overflow; index++) {
      recordRecentTarget(`Folder ${String(index)}`);
    }
    const recentTargetPaths = getRecentTargetPaths();
    expect(recentTargetPaths).toHaveLength(MAX_COUNT);
    expect(recentTargetPaths[0]).toBe(`Folder ${String(overflow - 1)}`);
    expect(recentTargetPaths).not.toContain('Folder 0');
  });
});

describe('clearRecentTargets', () => {
  it('should forget every recorded target', () => {
    recordRecentTarget(FOLDER_A);
    clearRecentTargets();
    expect(getRecentTargetPaths()).toStrictEqual([]);
  });
});
