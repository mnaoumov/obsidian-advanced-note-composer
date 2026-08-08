import type {
  App as AppOriginal,
  TFolder,
  Vault,
  Workspace
} from 'obsidian';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
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
  isAllowedParentFolder,
  selectParentFolderForCreate
} from './create-folder-parent-modal.ts';

function createSettingsComponent(isPathIgnored: (path: string) => boolean = () => false): PluginSettingsComponent {
  return strictProxy<PluginSettingsComponent>({
    settings: strictProxy<PluginSettings>({ isPathIgnored })
  });
}

describe('isAllowedParentFolder', () => {
  let app: AppOriginal;

  function getFolder(path: string): TFolder {
    return ensureNonNullable(app.vault.getFolderByPath(path));
  }

  beforeEach(() => {
    app = App.createConfigured__({
      files: {
        'other/x.md': 'x',
        'parent/a/note.md': 'note'
      }
    }).asOriginalType__();
  });

  it('should allow an ordinary folder', () => {
    expect(isAllowedParentFolder({ pluginSettingsComponent: createSettingsComponent(), targetFolder: getFolder('parent') })).toBe(true);
  });

  it('should allow a nested folder', () => {
    expect(isAllowedParentFolder({ pluginSettingsComponent: createSettingsComponent(), targetFolder: getFolder('parent/a') })).toBe(true);
  });

  it('should allow the vault root, since a top-level folder is ordinary', () => {
    // Unlike the move picker, there is no source folder here — none of its "not into itself" constraints
    // Exist, so the only rule left is the ignored-paths one.
    expect(isAllowedParentFolder({ pluginSettingsComponent: createSettingsComponent(), targetFolder: app.vault.getRoot() })).toBe(true);
  });

  it('should reject an ignored folder', () => {
    const pluginSettingsComponent = createSettingsComponent((path) => path === 'other');
    expect(isAllowedParentFolder({ pluginSettingsComponent, targetFolder: getFolder('other') })).toBe(false);
  });
});

describe('selectParentFolderForCreate', () => {
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

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return null when the modal is cancelled', async () => {
    const app = createMockApp();
    const pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({ shouldShowModalInstructions: true })
    });

    const promise = selectParentFolderForCreate({ app, pluginSettingsComponent });
    await vi.advanceTimersByTimeAsync(0);
    expect(await promise).toBeNull();
  });
});
