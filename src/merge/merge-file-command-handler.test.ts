import type {
  FileCommandHandlerShouldAddToFileMenuParams,
  FileCommandHandlerShouldAddToFilesMenuParams
} from '@mnaoumov/obsidian-lib/command-handlers/file-command-handler';
import type { ConsoleDebugComponent } from '@mnaoumov/obsidian-lib/components/console-debug-component';
import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type { ResourceLockComponent } from '@mnaoumov/obsidian-lib/resource-lock';
import type {
  App,
  TFile
} from 'obsidian';

import { isMarkdownFile } from '@mnaoumov/obsidian-lib/file-system';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';
import type { PluginSettings } from '../settings/plugin-settings.ts';

import { InsertMode } from '../composers/insert-mode.ts';
import { FrontmatterMergeStrategy } from '../settings/plugin-settings.ts';
import { MergeComposer } from './merge-composer.ts';
import { MergeFileCommandHandler } from './merge-file-command-handler.ts';
import { prepareForMergeFile } from './merge-file-modal.ts';
import { selectTargetFileForMergeFiles } from './merge-files-modal.ts';
import { mergeFilesIntoSingleFile } from './merge-into-single-file-runner.ts';

interface TestableHandler {
  readonly canExecuteFile: (file: TFile) => boolean;
  readonly canExecuteFiles: (files: TFile[]) => boolean;
  readonly executeFile: (file: TFile) => Promise<void>;
  readonly executeFiles: (files: TFile[]) => Promise<void>;
  readonly icon: string;
  readonly id: string;
  readonly name: string;
  readonly shouldAddCommandToSubmenu: () => boolean;
  readonly shouldAddToFileMenu: (params: FileCommandHandlerShouldAddToFileMenuParams) => boolean;
  readonly shouldAddToFilesMenu: (params: FileCommandHandlerShouldAddToFilesMenuParams) => boolean;
}

// Partial rather than a bare factory: `plugin-settings.ts` reaches obsidian-lib's folder-note module, which
// imports `MARKDOWN_FILE_EXTENSION` from here — a factory listing only the mocked function makes that import
// `undefined` and the whole suite fails to load.
vi.mock(import('@mnaoumov/obsidian-lib/file-system'), async (importOriginal) => ({
  ...await importOriginal(),
  isMarkdownFile: vi.fn()
}));

vi.mock('./merge-composer.ts', () => {
  const MockMergeComposer = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- vi.fn() prototype is untyped in mock factories.
  MockMergeComposer.prototype.mergeFile = vi.fn().mockResolvedValue(undefined);
  return { MergeComposer: MockMergeComposer };
});

vi.mock('./merge-file-modal.ts', () => ({
  prepareForMergeFile: vi.fn()
}));

vi.mock('./merge-files-modal.ts', () => ({
  selectTargetFileForMergeFiles: vi.fn()
}));

vi.mock('./merge-into-single-file-runner.ts', () => ({
  mergeFilesIntoSingleFile: vi.fn().mockResolvedValue({ aborted: false, ignoredSourceFiles: [], mergedCount: 0 })
}));

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

  it('should run on a source path the content filter ignores, which only the command filter refuses (issue #288)', async () => {
    const params = createMockParams(true);
    const handler = toTestable(new MergeFileCommandHandler(params));
    const file = createMockFile();

    await handler.executeFile(file);

    expect(mockPrepareForMergeFile).toHaveBeenCalled();
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
  // setting, so what the picker was allowed to OFFER is exactly what the composer is allowed to write
  // into. The composer defaults the flag to `false`, which is why NOT passing it looked like working code.
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
