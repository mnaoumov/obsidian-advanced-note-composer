import type {
  App,
  TFile,
  WorkspaceLeaf
} from 'obsidian';

import { Notice } from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
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
import type { Plugin } from '../plugin.ts';

import { selectFileForSwap } from '../modals/swap-file-modal.ts';
import { swap } from '../swapper.ts';
import { SwapFileCommandHandler } from './swap-file-command-handler.ts';

interface TestableHandler {
  executeFile(file: TFile): Promise<void>;
  params: unknown;
  shouldAddCommandToSubmenu(): boolean;
  shouldAddToFileMenu(file: TFile, source: string, leaf?: WorkspaceLeaf): boolean;
}

vi.mock('obsidian', () => ({
  Notice: vi.fn()
}));

vi.mock('obsidian-dev-utils/html-element', () => ({
  createFragmentAsync: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/command-handlers/file-command-handler', () => {
  class FileCommandHandler {
    public readonly params: unknown;
    public constructor(params: unknown) {
      this.params = params;
    }

    protected shouldAddCommandToSubmenu(): boolean | undefined {
      return undefined;
    }

    protected shouldAddToFileMenu(_file: unknown, _source: unknown, _leaf?: unknown): boolean {
      return false;
    }
  }
  return { FileCommandHandler };
});

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn()
}));

vi.mock('../modals/swap-file-modal.ts', () => ({
  selectFileForSwap: vi.fn()
}));

vi.mock('../swapper.ts', () => ({
  swap: vi.fn()
}));

const mockCreateFragmentAsync = vi.mocked(createFragmentAsync);
const mockRenderInternalLink = vi.mocked(renderInternalLink);
const MockNotice = vi.mocked(Notice);
const mockSelectFileForSwap = vi.mocked(selectFileForSwap);
const mockSwap = vi.mocked(swap);

function createMockFile(): TFile {
  return strictProxy<TFile>({ path: 'test/note.md' });
}

function createMockPlugin(isPathIgnored = false, shouldAddCommandsToSubmenu = true): Plugin {
  return strictProxy<Plugin>({
    app: strictProxy<App>({}),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        isPathIgnored: vi.fn().mockReturnValue(isPathIgnored),
        shouldAddCommandsToSubmenu
      })
    })
  });
}

function toTestable(handler: SwapFileCommandHandler): TestableHandler {
  return handler as never;
}

describe('SwapFileCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should construct with correct params', () => {
    const plugin = createMockPlugin();
    const handler = toTestable(new SwapFileCommandHandler(plugin));
    expect(handler.params).toStrictEqual({
      fileMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'switch-camera',
      id: 'swap-file',
      name: 'Swap file with...'
    });
  });

  it('should show notice and return when path is ignored', async () => {
    const plugin = createMockPlugin(true);
    const handler = toTestable(new SwapFileCommandHandler(plugin));
    const file = createMockFile();

    const mockFragment = strictProxy<DocumentFragment>({
      appendChild: vi.fn(),
      appendText: vi.fn()
    });
    mockCreateFragmentAsync.mockImplementation(async (cb) => {
      await (cb as (f: DocumentFragment) => Promise<void>)(mockFragment);
      return mockFragment;
    });
    mockRenderInternalLink.mockResolvedValue(activeDocument.createElement('a'));

    await handler.executeFile(file);

    expect(MockNotice).toHaveBeenCalled();
    expect(mockSelectFileForSwap).not.toHaveBeenCalled();
  });

  it('should return when selectFileForSwap returns null', async () => {
    const plugin = createMockPlugin(false);
    const handler = toTestable(new SwapFileCommandHandler(plugin));
    const file = createMockFile();

    mockSelectFileForSwap.mockResolvedValue(null);

    await handler.executeFile(file);

    expect(mockSwap).not.toHaveBeenCalled();
  });

  it('should call swap on happy path', async () => {
    const plugin = createMockPlugin(false);
    const handler = toTestable(new SwapFileCommandHandler(plugin));
    const file = createMockFile();
    const targetFile = createMockFile();

    mockSelectFileForSwap.mockResolvedValue(targetFile);
    mockSwap.mockResolvedValue(undefined);

    await handler.executeFile(file);

    expect(mockSwap).toHaveBeenCalledWith(plugin.app, file, targetFile, true);
  });

  it('should return shouldAddCommandsToSubmenu setting when super returns undefined', () => {
    const plugin = createMockPlugin(false, true);
    const handler = toTestable(new SwapFileCommandHandler(plugin));
    expect(handler.shouldAddCommandToSubmenu()).toBe(true);
  });

  it('should return false from shouldAddCommandToSubmenu when setting is false', () => {
    const plugin = createMockPlugin(false, false);
    const handler = toTestable(new SwapFileCommandHandler(plugin));
    expect(handler.shouldAddCommandToSubmenu()).toBe(false);
  });

  it('should return true from shouldAddToFileMenu', () => {
    const plugin = createMockPlugin();
    const handler = toTestable(new SwapFileCommandHandler(plugin));
    const file = createMockFile();
    expect(handler.shouldAddToFileMenu(file, 'source')).toBe(true);
  });
});
