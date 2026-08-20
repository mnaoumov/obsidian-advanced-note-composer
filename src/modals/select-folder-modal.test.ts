import type {
  App as AppOriginal,
  Vault,
  Workspace
} from 'obsidian';

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
import { selectFolder } from './select-folder-modal.ts';

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
