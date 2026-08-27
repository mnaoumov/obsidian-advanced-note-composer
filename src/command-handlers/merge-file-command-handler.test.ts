import type {
  App,
  TFile
} from 'obsidian';
import type {
  FileCommandHandlerShouldAddToFileMenuParams,
  FileCommandHandlerShouldAddToFilesMenuParams
} from 'obsidian-dev-utils/obsidian/command-handlers/file-command-handler';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

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

import { MergeComposer } from '../composers/merge-composer.ts';
import { InsertMode } from '../insert-mode.ts';
import { mergeFilesIntoSingleFile } from '../merge-into-single-file-runner.ts';
import { prepareForMergeFile } from '../modals/merge-file-modal.ts';
import { selectTargetFileForMergeFiles } from '../modals/merge-files-modal.ts';
import { FrontmatterMergeStrategy } from '../plugin-settings.ts';
import { MergeFileCommandHandler } from './merge-file-command-handler.ts';

interface TestableHandler {
  canExecuteFile(file: TFile): boolean;
  canExecuteFiles(files: TFile[]): boolean;
  executeFile(file: TFile): Promise<void>;
  executeFiles(files: TFile[]): Promise<void>;
  readonly icon: string;
  readonly id: string;
  readonly name: string;
  shouldAddCommandToSubmenu(): boolean;
  shouldAddToFileMenu(params: FileCommandHandlerShouldAddToFileMenuParams): boolean;
  shouldAddToFilesMenu(params: FileCommandHandlerShouldAddToFilesMenuParams): boolean;
}

vi.mock('obsidian-dev-utils/html-element', () => ({
  createFragmentAsync: vi.fn()
}));

// Partial rather than a bare factory: `plugin-settings.ts` reaches dev-utils' folder-note module, which
// Imports `MARKDOWN_FILE_EXTENSION` from here — a factory listing only the mocked function makes that import
// `undefined` and the whole suite fails to load.
vi.mock(import('obsidian-dev-utils/obsidian/file-system'), async (importOriginal) => ({
  ...await importOriginal(),
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

vi.mock('../modals/merge-files-modal.ts', () => ({
  selectTargetFileForMergeFiles: vi.fn()
}));

vi.mock('../merge-into-single-file-runner.ts', () => ({
  mergeFilesIntoSingleFile: vi.fn().mockResolvedValue({ aborted: false, ignoredSourceFiles: [], mergedCount: 0 })
}));

const mockCreateFragmentAsync = vi.mocked(createFragmentAsync);
const mockRenderInternalLink = vi.mocked(renderInternalLink);
const mockPrepareForMergeFile = vi.mocked(prepareForMergeFile);
const MockMergeComposer = vi.mocked(MergeComposer);
const mockIsMarkdownFile = vi.mocked(isMarkdownFile);
const mockSelectTargetFileForMergeFiles = vi.mocked(selectTargetFileForMergeFiles);
const mockMergeFilesIntoSingleFile = vi.mocked(mergeFilesIntoSingleFile);

interface MergeFileCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

function createMockFile(path = 'test/note.md'): TFile {
  return strictProxy<TFile>({ path });
}

function createMockParams(
  isPathIgnored = false,
  shouldAddCommandsToSubmenu = true,
  shouldBlockCommandOnPath = false,
  shouldOfferExcludedPathsAsMergeDestinations = false
): MergeFileCommandHandlerConstructorParams {
  return {
    app: strictProxy<App>({}),
    consoleDebugComponent: strictProxy<ConsoleDebugComponent>({}),
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice: vi.fn().mockReturnValue({ hide: vi.fn() }) }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        isPathIgnored: vi.fn().mockReturnValue(isPathIgnored),
        shouldAddCommandsToSubmenu,
        shouldBlockCommandOnPath: vi.fn().mockReturnValue(shouldBlockCommandOnPath),
        shouldMoveAttachmentsWhenMergingFile: true,
        shouldOfferExcludedPathsAsMergeDestinations
      })
    }),
    resourceLockComponent: strictProxy<ResourceLockComponent>({})
  };
}

function toTestable(handler: MergeFileCommandHandler): TestableHandler {
  return castTo<TestableHandler>(handler);
}

describe('MergeFileCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should construct with correct params', () => {
    const params = createMockParams();
    const handler = toTestable(new MergeFileCommandHandler(params));
    expect(handler.id).toBe('merge-file');
    expect(handler.name).toBe('Merge current file with another file...');
    expect(handler.icon).toBe('lucide-git-merge');
  });

  it('should return true from canExecuteFile when isMarkdownFile returns true', () => {
    const params = createMockParams();
    const handler = toTestable(new MergeFileCommandHandler(params));
    const file = createMockFile();

    mockIsMarkdownFile.mockReturnValue(true);

    expect(handler.canExecuteFile(file)).toBe(true);
  });

  it('should return false from canExecuteFile when isMarkdownFile returns false', () => {
    const params = createMockParams();
    const handler = toTestable(new MergeFileCommandHandler(params));
    const file = createMockFile();

    mockIsMarkdownFile.mockReturnValue(false);

    expect(handler.canExecuteFile(file)).toBe(false);
  });

  it('should return false from canExecuteFile when the command is blocked on the path', () => {
    const params = createMockParams(false, true, true);
    const handler = toTestable(new MergeFileCommandHandler(params));
    const file = createMockFile();

    mockIsMarkdownFile.mockReturnValue(true);

    expect(handler.canExecuteFile(file)).toBe(false);
  });

  it('should show notice and return when path is ignored', async () => {
    const params = createMockParams(true);
    const handler = toTestable(new MergeFileCommandHandler(params));
    const file = createMockFile();

    const mockFragment = strictProxy<DocumentFragment>({
      append: vi.fn(),
      appendChild: vi.fn(),
      appendText: vi.fn()
    });
    mockCreateFragmentAsync.mockImplementation(async (callback) => {
      await (callback as (f: DocumentFragment) => Promise<void>)(mockFragment);
      return mockFragment;
    });
    mockRenderInternalLink.mockResolvedValue(createEl('a'));

    await handler.executeFile(file);

    expect(params.pluginNoticeComponent.showNotice).toHaveBeenCalled();
    expect(mockPrepareForMergeFile).not.toHaveBeenCalled();
  });

  it('should return when prepareForMergeFile returns null', async () => {
    const params = createMockParams(false);
    const handler = toTestable(new MergeFileCommandHandler(params));
    const file = createMockFile();

    mockPrepareForMergeFile.mockResolvedValue(null);

    await handler.executeFile(file);

    expect(MockMergeComposer).not.toHaveBeenCalled();
  });

  it('should create MergeComposer and call mergeFile on happy path', async () => {
    const params = createMockParams(false);
    const handler = toTestable(new MergeFileCommandHandler(params));
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
      app: params.app,
      consoleDebugComponent: params.consoleDebugComponent,
      frontmatterMergeStrategy: 'MergeAndPreferNewValues',
      insertMode: 'append',
      isNewTargetFile: true,
      pluginNoticeComponent: params.pluginNoticeComponent,
      pluginSettingsComponent: params.pluginSettingsComponent,
      resourceLockComponent: params.resourceLockComponent,
      shouldFixFootnotes: true,
      shouldMergeHeadings: false,
      shouldMergeIgnoredTarget: false,
      sourceFile: file,
      targetFile
    });
    expect(mockMergeFile).toHaveBeenCalled();
  });

  // Issue #240 made an excluded destination reachable at all; issue #253 moved the decision onto its own
  // Setting, so what the picker was allowed to OFFER is exactly what the composer is allowed to write
  // Into. The composer defaults the flag to `false`, which is why NOT passing it looked like working code.
  it('should let the merge into an excluded target through when excluded destinations are offered', async () => {
    const params = createMockParams(false, true, false, true);
    const handler = toTestable(new MergeFileCommandHandler(params));
    const file = createMockFile();
    const targetFile = createMockFile();

    mockPrepareForMergeFile.mockResolvedValue({
      frontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues,
      insertMode: InsertMode.Append,
      isNewTargetFile: true,
      shouldAllowOnlyCurrentFolder: false,
      shouldAllowSplitIntoUnresolvedPath: true,
      shouldFixFootnotes: true,
      shouldMergeHeadings: false,
      targetFile
    });
    MockMergeComposer.prototype.mergeFile = vi.fn().mockResolvedValue(undefined);

    await handler.executeFile(file);

    expect(MockMergeComposer.mock.calls[0]?.[0]).toMatchObject({ shouldMergeIgnoredTarget: true });
  });

  it('should return shouldAddCommandsToSubmenu setting when super returns undefined', () => {
    const params = createMockParams(false, true);
    const handler = toTestable(new MergeFileCommandHandler(params));
    expect(handler.shouldAddCommandToSubmenu()).toBe(true);
  });

  it('should return false from shouldAddCommandToSubmenu when setting is false', () => {
    const params = createMockParams(false, false);
    const handler = toTestable(new MergeFileCommandHandler(params));
    expect(handler.shouldAddCommandToSubmenu()).toBe(false);
  });

  it('should return false for link-context-menu source in shouldAddToFileMenu', () => {
    const params = createMockParams();
    const handler = toTestable(new MergeFileCommandHandler(params));
    const file = createMockFile();

    expect(handler.shouldAddToFileMenu({ file, source: 'link-context-menu' })).toBe(false);
  });

  it('should return true for non-link-context-menu source in shouldAddToFileMenu', () => {
    const params = createMockParams();
    const handler = toTestable(new MergeFileCommandHandler(params));
    const file = createMockFile();

    expect(handler.shouldAddToFileMenu({ file, source: 'file-explorer-context-menu' })).toBe(true);
  });

  it('should return true from shouldAddToFilesMenu', () => {
    const params = createMockParams();
    const handler = toTestable(new MergeFileCommandHandler(params));
    const files = [createMockFile()];

    expect(handler.shouldAddToFilesMenu({ files, source: 'source' })).toBe(true);
  });

  it('should allow canExecuteFiles when there are at least two mergeable markdown files', () => {
    const params = createMockParams();
    const handler = toTestable(new MergeFileCommandHandler(params));
    mockIsMarkdownFile.mockReturnValue(true);

    expect(handler.canExecuteFiles([createMockFile('a.md'), createMockFile('b.md')])).toBe(true);
  });

  it('should refuse canExecuteFiles with fewer than two mergeable files', () => {
    const params = createMockParams();
    const handler = toTestable(new MergeFileCommandHandler(params));
    mockIsMarkdownFile.mockReturnValue(true);

    expect(handler.canExecuteFiles([createMockFile('a.md')])).toBe(false);
  });

  it('should refuse canExecuteFiles when the files are not markdown', () => {
    const params = createMockParams();
    const handler = toTestable(new MergeFileCommandHandler(params));
    mockIsMarkdownFile.mockReturnValue(false);

    expect(handler.canExecuteFiles([createMockFile('a.png'), createMockFile('b.png')])).toBe(false);
  });

  it('should refuse canExecuteFiles when the command is blocked on a path', () => {
    const params = createMockParams(false, true, true);
    const handler = toTestable(new MergeFileCommandHandler(params));
    mockIsMarkdownFile.mockReturnValue(true);

    expect(handler.canExecuteFiles([createMockFile('a.md'), createMockFile('b.md')])).toBe(false);
  });

  it('should merge the selected files into the picked target in executeFiles', async () => {
    const params = createMockParams(false);
    const handler = toTestable(new MergeFileCommandHandler(params));
    mockIsMarkdownFile.mockReturnValue(true);
    const sourceFiles = [createMockFile('a.md'), createMockFile('b.md')];
    const targetFile = createMockFile('target.md');
    mockSelectTargetFileForMergeFiles.mockResolvedValue(targetFile);

    await handler.executeFiles(sourceFiles);

    expect(mockSelectTargetFileForMergeFiles).toHaveBeenCalledWith({
      app: params.app,
      pluginSettingsComponent: params.pluginSettingsComponent,
      sourceFiles
    });
    expect(mockMergeFilesIntoSingleFile).toHaveBeenCalledWith({
      app: params.app,
      consoleDebugComponent: params.consoleDebugComponent,
      isNewTargetFile: false,
      pluginNoticeComponent: params.pluginNoticeComponent,
      pluginSettingsComponent: params.pluginSettingsComponent,
      progressLabel: 'Merging files',
      resourceLockComponent: params.resourceLockComponent,
      shouldRelocateOwnedAttachments: true,
      sourceFiles,
      targetFile
    });
  });

  it('should do nothing in executeFiles when fewer than two files are mergeable', async () => {
    const params = createMockParams(false);
    const handler = toTestable(new MergeFileCommandHandler(params));
    mockIsMarkdownFile.mockReturnValue(true);

    await handler.executeFiles([createMockFile('a.md')]);

    expect(mockSelectTargetFileForMergeFiles).not.toHaveBeenCalled();
    expect(mockMergeFilesIntoSingleFile).not.toHaveBeenCalled();
  });

  it('should do nothing in executeFiles when no target is picked', async () => {
    const params = createMockParams(false);
    const handler = toTestable(new MergeFileCommandHandler(params));
    mockIsMarkdownFile.mockReturnValue(true);
    mockSelectTargetFileForMergeFiles.mockResolvedValue(null);

    await handler.executeFiles([createMockFile('a.md'), createMockFile('b.md')]);

    expect(mockMergeFilesIntoSingleFile).not.toHaveBeenCalled();
  });
});
