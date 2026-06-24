import type {
  App,
  TFolder,
  WorkspaceLeaf
} from 'obsidian';

import { Notice } from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';

import { selectTargetFolderForSwap } from '../modals/swap-folder-modal.ts';
import { swap } from '../swapper.ts';
import { SwapFolderCommandHandler } from './swap-folder-command-handler.ts';

interface TestableHandler {
  canExecuteFolder(folder: TFolder): boolean;
  executeFolder(folder: TFolder): Promise<void>;
  readonly icon: string;
  readonly id: string;
  readonly name: string;
  shouldAddCommandToSubmenu(): boolean;
  shouldAddToFolderMenu(folder: TFolder, source: string, leaf?: WorkspaceLeaf): boolean;
}

vi.mock('obsidian', async (importOriginal) => ({
  ...await importOriginal<typeof import('obsidian')>(),
  Notice: vi.fn()
}));

vi.mock('obsidian-dev-utils/html-element', () => ({
  createFragmentAsync: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn()
}));

vi.mock('../modals/swap-folder-modal.ts', () => ({
  selectTargetFolderForSwap: vi.fn()
}));

vi.mock('../swapper.ts', () => ({
  swap: vi.fn()
}));

const mockCreateFragmentAsync = vi.mocked(createFragmentAsync);
const mockRenderInternalLink = vi.mocked(renderInternalLink);
const MockNotice = vi.mocked(Notice);
const mockSelectTargetFolderForSwap = vi.mocked(selectTargetFolderForSwap);
const mockSwap = vi.mocked(swap);

interface SwapFolderCommandHandlerConstructorParams {
  readonly app: App;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

function createMockFolder(path: string, isRoot = false): TFolder {
  return strictProxy<TFolder>({
    isRoot: vi.fn().mockReturnValue(isRoot),
    path
  });
}

function createMockParams(isPathIgnored = false, shouldAddCommandsToSubmenu = true): SwapFolderCommandHandlerConstructorParams {
  return {
    app: strictProxy<App>({}),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        isPathIgnored: vi.fn().mockReturnValue(isPathIgnored),
        shouldAddCommandsToSubmenu
      })
    })
  };
}

function toTestable(handler: SwapFolderCommandHandler): TestableHandler {
  return castTo<TestableHandler>(handler);
}

describe('SwapFolderCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should construct with correct params', () => {
    const params = createMockParams();
    const handler = toTestable(new SwapFolderCommandHandler(params));
    expect(handler.id).toBe('swap-folder');
    expect(handler.name).toBe('Swap folder with...');
    expect(handler.icon).toBe('switch-camera');
  });

  it('should return false from canExecuteFolder when folder is root', () => {
    const params = createMockParams();
    const handler = toTestable(new SwapFolderCommandHandler(params));
    const folder = createMockFolder('/', true);
    expect(handler.canExecuteFolder(folder)).toBe(false);
  });

  it('should return true from canExecuteFolder when folder is not root', () => {
    const params = createMockParams();
    const handler = toTestable(new SwapFolderCommandHandler(params));
    const folder = createMockFolder('some/folder', false);
    expect(handler.canExecuteFolder(folder)).toBe(true);
  });

  it('should show notice and return when path is ignored', async () => {
    const params = createMockParams(true);
    const handler = toTestable(new SwapFolderCommandHandler(params));
    const folder = createMockFolder('test/folder');

    const mockFragment = strictProxy<DocumentFragment>({
      appendChild: vi.fn(),
      appendText: vi.fn()
    });
    mockCreateFragmentAsync.mockImplementation(async (cb) => {
      await (cb as (f: DocumentFragment) => Promise<void>)(mockFragment);
      return mockFragment;
    });
    mockRenderInternalLink.mockResolvedValue(activeDocument.createElement('a'));

    await handler.executeFolder(folder);

    expect(MockNotice).toHaveBeenCalled();
    expect(mockSelectTargetFolderForSwap).not.toHaveBeenCalled();
  });

  it('should return when selectTargetFolderForSwap returns null', async () => {
    const params = createMockParams(false);
    const handler = toTestable(new SwapFolderCommandHandler(params));
    const folder = createMockFolder('test/folder');

    mockSelectTargetFolderForSwap.mockResolvedValue(null);

    await handler.executeFolder(folder);

    expect(mockSwap).not.toHaveBeenCalled();
  });

  it('should call swap on happy path', async () => {
    const params = createMockParams(false);
    const handler = toTestable(new SwapFolderCommandHandler(params));
    const folder = createMockFolder('test/folder');
    const targetFolder = createMockFolder('target/folder');

    mockSelectTargetFolderForSwap.mockResolvedValue({
      shouldSwapEntireFolderStructure: true,
      targetFolder
    });
    mockSwap.mockResolvedValue(undefined);

    await handler.executeFolder(folder);

    expect(mockSwap).toHaveBeenCalledWith(params.app, folder, targetFolder, true);
  });

  it('should pass shouldSwapEntireFolderStructure from result', async () => {
    const params = createMockParams(false);
    const handler = toTestable(new SwapFolderCommandHandler(params));
    const folder = createMockFolder('test/folder');
    const targetFolder = createMockFolder('target/folder');

    mockSelectTargetFolderForSwap.mockResolvedValue({
      shouldSwapEntireFolderStructure: false,
      targetFolder
    });
    mockSwap.mockResolvedValue(undefined);

    await handler.executeFolder(folder);

    expect(mockSwap).toHaveBeenCalledWith(params.app, folder, targetFolder, false);
  });

  it('should return shouldAddCommandsToSubmenu setting when super returns undefined', () => {
    const params = createMockParams(false, true);
    const handler = toTestable(new SwapFolderCommandHandler(params));
    expect(handler.shouldAddCommandToSubmenu()).toBe(true);
  });

  it('should return false from shouldAddCommandToSubmenu when setting is false', () => {
    const params = createMockParams(false, false);
    const handler = toTestable(new SwapFolderCommandHandler(params));
    expect(handler.shouldAddCommandToSubmenu()).toBe(false);
  });

  it('should return true from shouldAddToFolderMenu', () => {
    const params = createMockParams();
    const handler = toTestable(new SwapFolderCommandHandler(params));
    const folder = createMockFolder('test/folder');
    expect(handler.shouldAddToFolderMenu(folder, 'source')).toBe(true);
  });
});
