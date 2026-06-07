import type {
  App,
  TFile,
  WorkspaceLeaf
} from 'obsidian';

import { Notice } from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { isMarkdownFile } from 'obsidian-dev-utils/obsidian/file-system';
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

import { MergeComposer } from '../composers/merge-composer.ts';
import { InsertMode } from '../insert-mode.ts';
import { prepareForMergeFile } from '../modals/merge-file-modal.ts';
import { FrontmatterMergeStrategy } from '../plugin-settings.ts';
import { MergeFileCommandHandler } from './merge-file-command-handler.ts';

interface TestableHandler {
  canExecuteFile(file: TFile): boolean;
  executeFile(file: TFile): Promise<void>;
  params: unknown;
  shouldAddCommandToSubmenu(): boolean;
  shouldAddToFileMenu(file: TFile, source: string): boolean;
  shouldAddToFilesMenu(files: TFile[], source: string, leaf?: WorkspaceLeaf): boolean;
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

    protected canExecuteFile(_file: unknown): boolean {
      return false;
    }

    protected shouldAddCommandToSubmenu(): boolean | undefined {
      return undefined;
    }

    protected shouldAddToFileMenu(_file: unknown, _source: unknown): boolean {
      return false;
    }

    protected shouldAddToFilesMenu(_files: unknown, _source: unknown, _leaf?: unknown): boolean {
      return false;
    }
  }
  return { FileCommandHandler };
});

vi.mock('obsidian-dev-utils/obsidian/file-system', () => ({
  isMarkdownFile: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn()
}));

vi.mock('../composers/merge-composer.ts', () => {
  const MockMergeComposer = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- vi.fn() prototype is untyped in mock factories.
  MockMergeComposer.prototype.mergeFile = vi.fn().mockResolvedValue(undefined);
  return { MergeComposer: MockMergeComposer };
});

vi.mock('../modals/merge-file-modal.ts', () => ({
  prepareForMergeFile: vi.fn()
}));

const mockCreateFragmentAsync = vi.mocked(createFragmentAsync);
const mockRenderInternalLink = vi.mocked(renderInternalLink);
const mockPrepareForMergeFile = vi.mocked(prepareForMergeFile);
const MockMergeComposer = vi.mocked(MergeComposer);
const MockNotice = vi.mocked(Notice);
const mockIsMarkdownFile = vi.mocked(isMarkdownFile);

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

function toTestable(handler: MergeFileCommandHandler): TestableHandler {
  return castTo<TestableHandler>(handler);
}

describe('MergeFileCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should construct with correct params', () => {
    const plugin = createMockPlugin();
    const handler = toTestable(new MergeFileCommandHandler(plugin));
    expect(handler.params).toStrictEqual({
      fileMenuItemName: 'Merge entire file with...',
      fileMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-git-merge',
      id: 'merge-file',
      name: 'Merge current file with another file...'
    });
  });

  it('should return true from canExecuteFile when isMarkdownFile returns true', () => {
    const plugin = createMockPlugin();
    const handler = toTestable(new MergeFileCommandHandler(plugin));
    const file = createMockFile();

    mockIsMarkdownFile.mockReturnValue(true);

    expect(handler.canExecuteFile(file)).toBe(true);
  });

  it('should return false from canExecuteFile when isMarkdownFile returns false', () => {
    const plugin = createMockPlugin();
    const handler = toTestable(new MergeFileCommandHandler(plugin));
    const file = createMockFile();

    mockIsMarkdownFile.mockReturnValue(false);

    expect(handler.canExecuteFile(file)).toBe(false);
  });

  it('should show notice and return when path is ignored', async () => {
    const plugin = createMockPlugin(true);
    const handler = toTestable(new MergeFileCommandHandler(plugin));
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
    expect(mockPrepareForMergeFile).not.toHaveBeenCalled();
  });

  it('should return when prepareForMergeFile returns null', async () => {
    const plugin = createMockPlugin(false);
    const handler = toTestable(new MergeFileCommandHandler(plugin));
    const file = createMockFile();

    mockPrepareForMergeFile.mockResolvedValue(null);

    await handler.executeFile(file);

    expect(MockMergeComposer).not.toHaveBeenCalled();
  });

  it('should create MergeComposer and call mergeFile on happy path', async () => {
    const plugin = createMockPlugin(false);
    const handler = toTestable(new MergeFileCommandHandler(plugin));
    const file = createMockFile();
    const targetFile = createMockFile();

    const mergeResult = {
      frontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues,
      insertMode: InsertMode.Append,
      isNewTargetFile: true,
      shouldAllowOnlyCurrentFolder: false,
      shouldAllowSplitIntoUnresolvedPath: true,
      shouldFixFootnotes: true,
      shouldMergeHeadings: false,
      targetFile
    };
    mockPrepareForMergeFile.mockResolvedValue(mergeResult);

    const mockMergeFile = vi.fn().mockResolvedValue(undefined);
    MockMergeComposer.prototype.mergeFile = mockMergeFile;

    await handler.executeFile(file);

    expect(MockMergeComposer).toHaveBeenCalledWith({
      frontmatterMergeStrategy: 'MergeAndPreferNewValues',
      insertMode: 'append',
      isNewTargetFile: true,
      plugin,
      shouldAllowOnlyCurrentFolder: false,
      shouldAllowSplitIntoUnresolvedPath: true,
      shouldFixFootnotes: true,
      shouldMergeHeadings: false,
      sourceFile: file,
      targetFile
    });
    expect(mockMergeFile).toHaveBeenCalled();
  });

  it('should return shouldAddCommandsToSubmenu setting when super returns undefined', () => {
    const plugin = createMockPlugin(false, true);
    const handler = toTestable(new MergeFileCommandHandler(plugin));
    expect(handler.shouldAddCommandToSubmenu()).toBe(true);
  });

  it('should return false from shouldAddCommandToSubmenu when setting is false', () => {
    const plugin = createMockPlugin(false, false);
    const handler = toTestable(new MergeFileCommandHandler(plugin));
    expect(handler.shouldAddCommandToSubmenu()).toBe(false);
  });

  it('should return false for link-context-menu source in shouldAddToFileMenu', () => {
    const plugin = createMockPlugin();
    const handler = toTestable(new MergeFileCommandHandler(plugin));
    const file = createMockFile();

    expect(handler.shouldAddToFileMenu(file, 'link-context-menu')).toBe(false);
  });

  it('should return true for non-link-context-menu source in shouldAddToFileMenu', () => {
    const plugin = createMockPlugin();
    const handler = toTestable(new MergeFileCommandHandler(plugin));
    const file = createMockFile();

    expect(handler.shouldAddToFileMenu(file, 'file-explorer-context-menu')).toBe(true);
  });

  it('should return false from shouldAddToFilesMenu', () => {
    const plugin = createMockPlugin();
    const handler = toTestable(new MergeFileCommandHandler(plugin));
    const files = [createMockFile()];

    expect(handler.shouldAddToFilesMenu(files, 'source')).toBe(false);
  });
});
