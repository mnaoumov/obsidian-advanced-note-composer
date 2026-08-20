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

import { PickerRecencyOrder } from '../plugin-settings.ts';
import {
  isAllowedMoveTarget,
  selectTargetFolderForMove
} from './move-folder-modal.ts';
import { selectFolder } from './select-folder-modal.ts';

vi.mock('./select-folder-modal.ts', async (importOriginal) => {
  // Partially mocked: the cancellation test still drives the REAL picker, while the filter test only needs
  // The parameters it was handed.
  const original = await importOriginal<typeof import('./select-folder-modal.ts')>();
  return { selectFolder: vi.fn(original.selectFolder) };
});

const mockSelectFolder = vi.mocked(selectFolder);

function createSettingsComponent(isPathIgnored: (path: string) => boolean = () => false): PluginSettingsComponent {
  return strictProxy<PluginSettingsComponent>({
    settings: strictProxy<PluginSettings>({ isPathIgnored })
  });
}

describe('isAllowedMoveTarget', () => {
  let app: AppOriginal;

  function getFolder(path: string): TFolder {
    return ensureNonNullable(app.vault.getFolderByPath(path));
  }

  beforeEach(() => {
    app = App.createConfigured__({
      files: {
        'other/x.md': 'x',
        'parent/a/note.md': 'note',
        'parent/a/sub/y.md': 'y'
      }
    }).asOriginalType__();
  });

  it('should reject the source folder itself', () => {
    const source = getFolder('parent/a');
    expect(isAllowedMoveTarget({ app, pluginSettingsComponent: createSettingsComponent(), sourceFolder: source, targetFolder: source })).toBe(false);
  });

  it('should reject the source folder current parent (no-op)', () => {
    const source = getFolder('parent/a');
    expect(isAllowedMoveTarget({ app, pluginSettingsComponent: createSettingsComponent(), sourceFolder: source, targetFolder: getFolder('parent') })).toBe(false);
  });

  it('should reject a descendant of the source folder', () => {
    const source = getFolder('parent/a');
    expect(isAllowedMoveTarget({ app, pluginSettingsComponent: createSettingsComponent(), sourceFolder: source, targetFolder: getFolder('parent/a/sub') })).toBe(false);
  });

  it('should reject an ignored target folder', () => {
    const source = getFolder('parent/a');
    const settings = createSettingsComponent((path) => path === 'other');
    expect(isAllowedMoveTarget({ app, pluginSettingsComponent: settings, sourceFolder: source, targetFolder: getFolder('other') })).toBe(false);
  });

  it('should allow an unrelated non-ignored folder', () => {
    const source = getFolder('parent/a');
    expect(isAllowedMoveTarget({ app, pluginSettingsComponent: createSettingsComponent(), sourceFolder: source, targetFolder: getFolder('other') })).toBe(true);
  });

  it('should allow the vault root when it is not the source parent', () => {
    const source = getFolder('parent/a');
    expect(isAllowedMoveTarget({ app, pluginSettingsComponent: createSettingsComponent(), sourceFolder: source, targetFolder: app.vault.getRoot() })).toBe(true);
  });
});

describe('selectTargetFolderForMove', () => {
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

  function createMockFolder(path: string): TFolder {
    const name = path.split('/').pop() ?? path;
    return strictProxy<TFolder>({
      children: [],
      name,
      path
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return null when the modal is cancelled', async () => {
    const sourceFolder = createMockFolder('source');
    const app = createMockApp();
    const pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({ pickerRecencyOrder: PickerRecencyOrder.RecentTargetsFirst, shouldShowModalInstructions: true })
    });

    const promise = selectTargetFolderForMove({ app, pluginSettingsComponent, sourceFolder });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('should filter the shared picker by the move rules', async () => {
    // Since the picker itself was extracted to `select-folder-modal.ts` (issue #205), the move-specific part
    // Is exactly this callback — so it is asserted here rather than left to the suggester's internals.
    const app = App.createConfigured__({
      files: {
        'other/x.md': 'x',
        'parent/a/note.md': 'note'
      }
    }).asOriginalType__();
    const sourceFolder = ensureNonNullable(app.vault.getFolderByPath('parent/a'));
    const pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        isPathIgnored: () => false,
        pickerRecencyOrder: PickerRecencyOrder.RecentTargetsFirst,
        shouldShowModalInstructions: true
      })
    });

    const promise = selectTargetFolderForMove({ app, pluginSettingsComponent, sourceFolder });
    await vi.advanceTimersByTimeAsync(0);
    await promise;

    // `lastCall`, not `calls[0]`: this describe block does not clear mocks between its tests.
    const isAllowedFolder = mockSelectFolder.mock.lastCall?.[0].isAllowedFolder;
    expect(isAllowedFolder?.(ensureNonNullable(app.vault.getFolderByPath('other')))).toBe(true);
    // The current parent is a no-op destination for a MOVE (unlike a flatten, where it is the default).
    expect(isAllowedFolder?.(ensureNonNullable(app.vault.getFolderByPath('parent')))).toBe(false);
  });
});
