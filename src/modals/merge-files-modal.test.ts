import type {
  App,
  TFile,
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

import { PickerRecencyOrder } from '../plugin-settings.ts';
import { selectTargetFileForMergeFiles } from './merge-files-modal.ts';

vi.mock('obsidian-dev-utils/obsidian/html-element', () => ({
  appendCodeBlock: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn().mockResolvedValue(createSpan())
}));

interface MockPlugin {
  app: App;
  pluginSettingsComponent: PluginSettingsComponent;
}

interface MockPluginOptions {
  readonly shouldAskBeforeMerging?: boolean;
}

function createMockPlugin(options?: MockPluginOptions): MockPlugin {
  return {
    app: strictProxy<App>({
      vault: strictProxy<Vault>({
        getMarkdownFiles: vi.fn().mockReturnValue([])
      }),
      workspace: strictProxy<Workspace>({
        getRecentFiles: vi.fn().mockReturnValue([])
      })
    }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      editAndSave: vi.fn().mockResolvedValue(undefined),
      settings: strictProxy({
        isPathIgnored: vi.fn().mockReturnValue(false),
        pickerRecencyOrder: PickerRecencyOrder.RecentTargetsFirst,
        shouldAskBeforeMerging: options?.shouldAskBeforeMerging ?? false,
        shouldShowModalInstructions: true
      })
    })
  };
}

describe('selectTargetFileForMergeFiles', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return null when the picker is cancelled', async () => {
    const plugin = createMockPlugin();
    const sourceFiles: TFile[] = [strictProxy<TFile>({ path: 'a.md' })];

    const promise = selectTargetFileForMergeFiles({ app: plugin.app, pluginSettingsComponent: plugin.pluginSettingsComponent, sourceFiles });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('should return null when the picker is cancelled and shouldAskBeforeMerging is on', async () => {
    const plugin = createMockPlugin({ shouldAskBeforeMerging: true });
    const sourceFiles: TFile[] = [strictProxy<TFile>({ path: 'a.md' })];

    const promise = selectTargetFileForMergeFiles({ app: plugin.app, pluginSettingsComponent: plugin.pluginSettingsComponent, sourceFiles });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
  });
});
