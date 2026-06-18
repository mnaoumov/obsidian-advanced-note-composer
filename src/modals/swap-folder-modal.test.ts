import type {
  App,
  TFolder,
  Vault,
  Workspace
} from 'obsidian';

import { noop } from 'obsidian-dev-utils/function';
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

import { selectTargetFolderForSwap } from './swap-folder-modal.ts';

vi.mock('obsidian-dev-utils/obsidian/vault', () => ({
  isChildOrSelf: vi.fn().mockReturnValue(false)
}));

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

    public build(): void {
      noop();
    }
  }
  return { SuggestModalCommandBuilder: MockSuggestModalCommandBuilder };
});

function createMockApp(): App {
  return strictProxy<App>({
    vault: strictProxy<Vault>({
      getAllFolders: vi.fn().mockReturnValue([]),
      getFileByPath: vi.fn().mockReturnValue(null)
    }),
    workspace: strictProxy<Workspace>({
      getRecentFiles: vi.fn().mockReturnValue([])
    })
  });
}

function createMockFolder(path: string): TFolder {
  const name = path.split('/').pop() ?? path;
  return strictProxy<TFolder>({
    children: [],
    name,
    path
  });
}

function createMockPluginSettingsComponent(): PluginSettingsComponent {
  return strictProxy<PluginSettingsComponent>({
    settings: strictProxy({
      isPathIgnored: vi.fn().mockReturnValue(false),
      shouldIncludeChildFoldersWhenSwappingByDefault: true,
      shouldIncludeParentFoldersWhenSwappingByDefault: true,
      shouldSwapEntireFolderStructureByDefault: true
    })
  });
}

describe('selectTargetFolderForSwap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return null when modal is cancelled', async () => {
    const sourceFolder = createMockFolder('source');
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent();

    const promise = selectTargetFolderForSwap({ app, pluginSettingsComponent, sourceFolder });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('should create modal and open it', async () => {
    const sourceFolder = createMockFolder('source');
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent();

    const promise = selectTargetFolderForSwap({ app, pluginSettingsComponent, sourceFolder });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    // Modal auto-closes without selection → onClose → null
    expect(result).toBeNull();
  });
});
