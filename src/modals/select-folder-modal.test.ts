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

import { PickerRecencyOrder } from '../plugin-settings.ts';
import {
  selectFolder,
  selectFolderForNewNote
} from './select-folder-modal.ts';

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
