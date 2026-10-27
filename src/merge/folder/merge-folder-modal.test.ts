import type {
  App,
  TFile,
  TFolder,
  Vault,
  Workspace
} from 'obsidian';

import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../../settings/plugin-settings-component.ts';

import { PickerRecencyOrder } from '../../settings/plugin-settings.ts';
import { selectTargetFolderForMergeFolder } from './merge-folder-modal.ts';

vi.mock('@mnaoumov/obsidian-lib/html-element', () => ({
  appendCodeBlock: vi.fn()
}));

vi.mock('@mnaoumov/typescript-lib/html-element', () => ({
  createFragmentAsync: vi.fn().mockImplementation((callback: (f: DocumentFragment) => Promise<void>) => {
    const fragment = createFragment();
    return callback(fragment).then(() => fragment);
  })
}));

vi.mock('@mnaoumov/obsidian-lib/markdown', () => ({
  renderInternalLink: vi.fn().mockResolvedValue(createSpan())
}));

vi.mock('@mnaoumov/obsidian-lib/vault', () => ({
  isChildOrSelf: vi.fn().mockReturnValue(false)
}));

let shouldAutoSelect = false;
let autoSelectFolder: null | TFolder = null;

interface MockPlugin {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

interface MockPluginOptions {
  readonly shouldAskBeforeMerging?: boolean;
}

function createMockFolder(path: string): TFolder {
  const name = path.split('/').pop() ?? path;
  return strictProxy<TFolder>({
    children: [],
    name,
    path
  });
}

function createMockPlugin(options?: MockPluginOptions): MockPlugin {
  const shouldAskBeforeMerging = options?.shouldAskBeforeMerging ?? false;
  const folders = autoSelectFolder ? [autoSelectFolder] : [];

  return {
    app: strictProxy<App>({
      vault: strictProxy<Vault>({
        getAllFolders: vi.fn().mockReturnValue(folders),
        getFileByPath: vi.fn().mockImplementation((filePath: string) => {
          return autoSelectFolder ? strictProxy<TFile>({ parent: autoSelectFolder, path: filePath }) : null;
        })
      }),
      workspace: strictProxy<Workspace>({
        getRecentFiles: vi.fn().mockReturnValue(shouldAutoSelect && autoSelectFolder ? ['dummy.md'] : [])
      })
    }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      editAndSave: vi.fn().mockResolvedValue(undefined),
      settings: strictProxy({
        isPathIgnored: vi.fn().mockReturnValue(false),
        pickerRecencyOrder: PickerRecencyOrder.RecentTargetsFirst,
        shouldAskBeforeMerging,
        shouldIncludeChildFoldersWhenMergingByDefault: true,
        shouldIncludeParentFoldersWhenMergingByDefault: true,
        shouldShowModalInstructions: true
      })
    })
  };
}

describe('selectTargetFolderForMergeFolder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    shouldAutoSelect = false;
    autoSelectFolder = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return null when folder modal is cancelled', async () => {
    const sourceFolder = createMockFolder('source');
    const plugin = createMockPlugin();

    const promise = selectTargetFolderForMergeFolder({ app: plugin.app, pluginSettingsComponent: plugin.pluginSettingsComponent, sourceFolder });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('should return null when shouldAskBeforeMerging is false and modal cancelled', async () => {
    const sourceFolder = createMockFolder('source');
    const plugin = createMockPlugin({ shouldAskBeforeMerging: false });

    const promise = selectTargetFolderForMergeFolder({ app: plugin.app, pluginSettingsComponent: plugin.pluginSettingsComponent, sourceFolder });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('should return null when shouldAskBeforeMerging is true and modal cancelled', async () => {
    const sourceFolder = createMockFolder('source');
    const plugin = createMockPlugin({ shouldAskBeforeMerging: true });

    const promise = selectTargetFolderForMergeFolder({ app: plugin.app, pluginSettingsComponent: plugin.pluginSettingsComponent, sourceFolder });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
  });
});
