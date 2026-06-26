import type {
  App,
  TFile
} from 'obsidian';
import type { FileCommandHandlerShouldAddToFileMenuParams } from 'obsidian-dev-utils/obsidian/command-handlers/file-command-handler';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

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

import { selectFileForSwap } from '../modals/swap-file-modal.ts';
import { swap } from '../swapper.ts';
import { SwapFileCommandHandler } from './swap-file-command-handler.ts';

interface TestableHandler {
  executeFile(file: TFile): Promise<void>;
  readonly icon: string;
  readonly id: string;
  readonly name: string;
  shouldAddCommandToSubmenu(): boolean;
  shouldAddToFileMenu(params: FileCommandHandlerShouldAddToFileMenuParams): boolean;
}

vi.mock('obsidian-dev-utils/html-element', () => ({
  createFragmentAsync: vi.fn()
}));

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
const mockSelectFileForSwap = vi.mocked(selectFileForSwap);
const mockSwap = vi.mocked(swap);

interface SwapFileCommandHandlerConstructorParams {
  readonly app: App;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

function createMockFile(): TFile {
  return strictProxy<TFile>({ path: 'test/note.md' });
}

function createMockParams(isPathIgnored = false, shouldAddCommandsToSubmenu = true): SwapFileCommandHandlerConstructorParams {
  return {
    app: strictProxy<App>({}),
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice: vi.fn().mockReturnValue({ hide: vi.fn() }) }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        isPathIgnored: vi.fn().mockReturnValue(isPathIgnored),
        shouldAddCommandsToSubmenu
      })
    })
  };
}

function toTestable(handler: SwapFileCommandHandler): TestableHandler {
  return castTo<TestableHandler>(handler);
}

describe('SwapFileCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should construct with correct params', () => {
    const params = createMockParams();
    const handler = toTestable(new SwapFileCommandHandler(params));
    expect(handler.id).toBe('swap-file');
    expect(handler.name).toBe('Swap file with...');
    expect(handler.icon).toBe('switch-camera');
  });

  it('should show notice and return when path is ignored', async () => {
    const params = createMockParams(true);
    const handler = toTestable(new SwapFileCommandHandler(params));
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

    expect(params.pluginNoticeComponent.showNotice).toHaveBeenCalled();
    expect(mockSelectFileForSwap).not.toHaveBeenCalled();
  });

  it('should return when selectFileForSwap returns null', async () => {
    const params = createMockParams(false);
    const handler = toTestable(new SwapFileCommandHandler(params));
    const file = createMockFile();

    mockSelectFileForSwap.mockResolvedValue(null);

    await handler.executeFile(file);

    expect(mockSwap).not.toHaveBeenCalled();
  });

  it('should call swap on happy path', async () => {
    const params = createMockParams(false);
    const handler = toTestable(new SwapFileCommandHandler(params));
    const file = createMockFile();
    const targetFile = createMockFile();

    mockSelectFileForSwap.mockResolvedValue(targetFile);
    mockSwap.mockResolvedValue(undefined);

    await handler.executeFile(file);

    expect(mockSwap).toHaveBeenCalledWith(params.app, file, targetFile, true);
  });

  it('should return shouldAddCommandsToSubmenu setting when super returns undefined', () => {
    const params = createMockParams(false, true);
    const handler = toTestable(new SwapFileCommandHandler(params));
    expect(handler.shouldAddCommandToSubmenu()).toBe(true);
  });

  it('should return false from shouldAddCommandToSubmenu when setting is false', () => {
    const params = createMockParams(false, false);
    const handler = toTestable(new SwapFileCommandHandler(params));
    expect(handler.shouldAddCommandToSubmenu()).toBe(false);
  });

  it('should return true from shouldAddToFileMenu', () => {
    const params = createMockParams();
    const handler = toTestable(new SwapFileCommandHandler(params));
    const file = createMockFile();
    expect(handler.shouldAddToFileMenu({ file, source: 'source' })).toBe(true);
  });
});
