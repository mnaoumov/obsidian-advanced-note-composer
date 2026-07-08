import type {
  App,
  TFile,
  TFolder,
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

import { selectTargetFolderForMergeFolder } from './merge-folder-modal.ts';

vi.mock('obsidian-dev-utils/obsidian/html-element', () => ({
  appendCodeBlock: vi.fn()
}));

vi.mock('obsidian-dev-utils/html-element', () => ({
  createFragmentAsync: vi.fn().mockImplementation((cb: (f: DocumentFragment) => Promise<void>) => {
    const fragment = createFragment();
    return cb(fragment).then(() => fragment);
  })
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn().mockResolvedValue(createSpan())
}));

vi.mock('obsidian-dev-utils/obsidian/vault', () => ({
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
          if (autoSelectFolder) {
            return strictProxy<TFile>({ parent: autoSelectFolder, path: filePath });
          }
          return null;
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
