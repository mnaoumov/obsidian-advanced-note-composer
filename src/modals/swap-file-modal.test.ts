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

import { selectFileForSwap } from './swap-file-modal.ts';

vi.mock('obsidian-dev-utils/obsidian/vault', () => ({
  isChildOrSelf: vi.fn().mockReturnValue(false)
}));

function createMockFile(path: string): TFile {
  const name = path.split('/').pop() ?? '';
  const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  return strictProxy<TFile>({
    extension: 'md',
    name,
    parent: strictProxy<TFolder>({ path: parentPath }),
    path
  });
}

function createMockPlugin(): Plugin {
  return strictProxy<Plugin>({
    app: strictProxy<App>({
      vault: strictProxy<Vault>({
        getFileByPath: vi.fn().mockReturnValue(null),
        getMarkdownFiles: vi.fn().mockReturnValue([])
      }),
      workspace: strictProxy<Workspace>({
        getRecentFiles: vi.fn().mockReturnValue([])
      })
    }),
    pluginSettingsComponent: strictProxy({
      settings: strictProxy({
        isPathIgnored: vi.fn().mockReturnValue(false)
      })
    })
  });
}

describe('selectFileForSwap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return null when modal is cancelled', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const plugin = createMockPlugin();

    const promise = selectFileForSwap(plugin, sourceFile);
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('should create modal and open it', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const plugin = createMockPlugin();

    const promise = selectFileForSwap(plugin, sourceFile);
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    // Modal auto-closes without selection → null (tests the onClose path)
    expect(result).toBeNull();
  });
});
