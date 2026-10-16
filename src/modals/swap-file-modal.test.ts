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

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { selectFileForSwap } from './swap-file-modal.ts';

vi.mock('@mnaoumov/obsidian-lib/html-element', () => ({
  appendCodeBlock: vi.fn()
}));

vi.mock('@mnaoumov/obsidian-lib/markdown', () => ({
  renderInternalLink: vi.fn().mockResolvedValue(createSpan())
}));

vi.mock('@mnaoumov/obsidian-lib/vault', () => ({
  isChildOrSelf: vi.fn().mockReturnValue(false)
}));

interface MockPluginSettingsComponentOptions {
  readonly shouldAskBeforeSwapping?: boolean;
}

function createMockApp(): App {
  return strictProxy<App>({
    vault: strictProxy<Vault>({
      getFileByPath: vi.fn().mockReturnValue(null),
      getMarkdownFiles: vi.fn().mockReturnValue([])
    }),
    workspace: strictProxy<Workspace>({
      getRecentFiles: vi.fn().mockReturnValue([])
    })
  });
}

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

function createMockPluginSettingsComponent(options?: MockPluginSettingsComponentOptions): PluginSettingsComponent {
  return strictProxy<PluginSettingsComponent>({
    editAndSave: vi.fn().mockResolvedValue(undefined),
    settings: strictProxy({
      isPathIgnored: vi.fn().mockReturnValue(false),
      shouldAskBeforeSwapping: options?.shouldAskBeforeSwapping ?? true
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
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent();

    const promise = selectFileForSwap({ app, pluginSettingsComponent, sourceFile });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('should return null when shouldAskBeforeSwapping is false and modal cancelled', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent({ shouldAskBeforeSwapping: false });

    const promise = selectFileForSwap({ app, pluginSettingsComponent, sourceFile });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    // Modal auto-closes without selection → null (tests the onClose path)
    expect(result).toBeNull();
  });

  it('should return null when shouldAskBeforeSwapping is true and modal cancelled', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent({ shouldAskBeforeSwapping: true });

    const promise = selectFileForSwap({ app, pluginSettingsComponent, sourceFile });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
  });
});
