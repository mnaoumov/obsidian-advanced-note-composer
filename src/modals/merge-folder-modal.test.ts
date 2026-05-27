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

import type { Plugin } from '../plugin.ts';

import { selectTargetFolderForMergeFolder } from './merge-folder-modal.ts';

vi.mock('obsidian-dev-utils/async', () => ({
  invokeAsyncSafely: vi.fn((fn: () => Promise<void>) => fn())
}));

vi.mock('obsidian-dev-utils/html-element', () => ({
  appendCodeBlock: vi.fn(),
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

vi.mock('./suggest-modal-command-builder.ts', () => {
  class MockSuggestModalCommandBuilder {
    public addCheckbox(): this {
      return this;
    }

    public addDropDown(): this {
      return this;
    }

    public addKeyboardCommand(): this {
      return this;
    }

    public build(): void {/* Noop */}
  }
  return { SuggestModalCommandBuilder: MockSuggestModalCommandBuilder };
});

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

function createMockPlugin(options?: MockPluginOptions): Plugin {
  const shouldAskBeforeMerging = options?.shouldAskBeforeMerging ?? false;
  const folders = autoSelectFolder ? [autoSelectFolder] : [];

  return strictProxy<Plugin>({
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
    pluginSettingsComponent: strictProxy({
      editAndSave: vi.fn().mockResolvedValue(undefined),
      settings: strictProxy({
        isPathIgnored: vi.fn().mockReturnValue(false),
        shouldAskBeforeMerging,
        shouldIncludeChildFoldersWhenMergingByDefault: true,
        shouldIncludeParentFoldersWhenMergingByDefault: true
      })
    })
  });
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

    const promise = selectTargetFolderForMergeFolder(plugin, sourceFolder);
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('should return null when shouldAskBeforeMerging is false and modal cancelled', async () => {
    const sourceFolder = createMockFolder('source');
    const plugin = createMockPlugin({ shouldAskBeforeMerging: false });

    const promise = selectTargetFolderForMergeFolder(plugin, sourceFolder);
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('should return null when shouldAskBeforeMerging is true and modal cancelled', async () => {
    const sourceFolder = createMockFolder('source');
    const plugin = createMockPlugin({ shouldAskBeforeMerging: true });

    const promise = selectTargetFolderForMergeFolder(plugin, sourceFolder);
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
  });
});
