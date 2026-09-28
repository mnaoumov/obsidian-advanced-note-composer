import type {
  App as AppOriginal,
  TFolder,
  Vault,
  Workspace
} from 'obsidian';

import { FuzzySuggestModal } from 'obsidian';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';

import {
  openMinimizableModal,
  openModal
} from '../open-minimizable-modal.ts';
import { PickerRecencyOrder } from '../plugin-settings.ts';
import {
  selectFolder,
  selectFolderForNewNote
} from './select-folder-modal.ts';

vi.mock('../open-minimizable-modal.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../open-minimizable-modal.ts')>();
  return {
    ...actual,
    openMinimizableModal: vi.fn(actual.openMinimizableModal),
    openModal: vi.fn(actual.openModal)
  };
});

function createMockApp(): AppOriginal {
  return strictProxy<AppOriginal>({
    vault: strictProxy<Vault>({
      getAllFolders: vi.fn().mockReturnValue([]),
      getFileByPath: vi.fn().mockReturnValue(null)
    }),
    workspace: strictProxy<Workspace>({
      getRecentFiles: vi.fn().mockReturnValue([])
    })
  });
}

function createSettingsComponent(): PluginSettingsComponent {
  return strictProxy<PluginSettingsComponent>({
    settings: strictProxy<PluginSettings>({ pickerRecencyOrder: PickerRecencyOrder.RecentTargetsFirst, shouldShowModalInstructions: true })
  });
}

describe('selectFolder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return null when the picker is dismissed', async () => {
    // A dismissed "Change target" detour is not a cancelled operation: every caller reads this `null` as
    // "never mind" and goes back to its confirmation dialog with the destination it already had.
    const promise = selectFolder({
      app: createMockApp(),
      isAllowedFolder: (): boolean => true,
      placeholder: 'Select folder...',
      pluginSettingsComponent: createSettingsComponent()
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(await promise).toBeNull();
  });
});

describe('selectFolderForNewNote', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return null when the prompt is dismissed', async () => {
    // The split flow reads this `null` as an abandoned split (issue #261), distinct from the switch being
    // flipped to `Merge` (issue #297), which answers `switch-to-merge` instead.
    const promise = selectFolderForNewNote({
      app: createMockApp(),
      canMergeIntoExistingNote: true,
      isAllowedFolder: (): boolean => true,
      placeholder: 'Select folder to create the new note in...',
      pluginSettingsComponent: createSettingsComponent()
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(await promise).toBeNull();
  });
});

describe('which opener each entry point uses', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(openMinimizableModal).mockClear();
    vi.mocked(openModal).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should open the folder-then-name prompt minimizable and every other folder picker plainly (issue #303)', async () => {
    // The folder-then-name prompt stands in for the split picker, which is minimizable (issue #130), so a flip
    // between the two must not make the minimize button come and go. The other pickers keep issue #125's rule.
    const params = {
      app: createMockApp(),
      isAllowedFolder: (): boolean => true,
      placeholder: 'Select folder...',
      pluginSettingsComponent: createSettingsComponent()
    };

    const plainPromise = selectFolder(params);
    await vi.advanceTimersByTimeAsync(0);
    await plainPromise;
    expect(openModal).toHaveBeenCalledTimes(1);
    expect(openMinimizableModal).not.toHaveBeenCalled();

    const newNotePromise = selectFolderForNewNote({ ...params, canMergeIntoExistingNote: true });
    await vi.advanceTimersByTimeAsync(0);
    await newNotePromise;
    expect(openMinimizableModal).toHaveBeenCalledTimes(1);
    expect(openModal).toHaveBeenCalledTimes(1);
  });
});

describe('choosing a folder', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return the chosen folder from both entry points', async () => {
    // `SelectFolderModal` is v8-ignored UI, so the pick is emulated at `open()`: the modal chooses a folder
    // the moment it is shown, which is exactly what `onChooseItem` receives from a real click.
    const chosenFolder = castTo<TFolder>({ path: 'chosen' });
    vi.spyOn(FuzzySuggestModal.prototype, 'open').mockImplementation(function open(this: FuzzySuggestModal<TFolder>): void {
      this.onChooseItem(chosenFolder, new MouseEvent('click'));
    });
    const params = {
      app: createMockApp(),
      isAllowedFolder: (): boolean => true,
      placeholder: 'Select folder...',
      pluginSettingsComponent: createSettingsComponent()
    };

    expect(await selectFolder(params)).toBe(chosenFolder);
    expect(await selectFolderForNewNote({ ...params, canMergeIntoExistingNote: true })).toEqual({ folder: chosenFolder, kind: 'folder' });
  });
});
