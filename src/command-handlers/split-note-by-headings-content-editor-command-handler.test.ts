import type {
  App,
  CachedMetadata,
  Editor,
  HeadingCache,
  MarkdownFileInfo,
  MetadataCache,
  TFile
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { EditorLockComponent } from 'obsidian-dev-utils/obsidian/editor-lock';

import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { getCacheSafe } from 'obsidian-dev-utils/obsidian/metadata-cache';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { Level } from '../markdown-heading-document.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';

import { getSelectionUnderHeading } from '../composers/composer-base.ts';
import { SplitComposer } from '../composers/split-composer.ts';
import { prepareForSplitFile } from '../modals/split-file-modal.ts';
import { SplitNoteByHeadingsContentEditorCommandHandler } from './split-note-by-headings-content-editor-command-handler.ts';

type PrepareForSplitFileResult = NonNullable<Awaited<ReturnType<typeof prepareForSplitFile>>>;

interface TestableHandler {
  canExecuteEditor(editor: Editor, ctx: MarkdownFileInfo): boolean;
  executeEditor(editor: Editor, ctx: MarkdownFileInfo): Promise<void>;
  readonly icon: string;
  readonly id: string;
  readonly name: string;
  shouldAddCommandToSubmenu(): boolean;
  shouldAddToEditorMenu(editor: Editor, ctx: MarkdownFileInfo): boolean;
}

vi.mock('obsidian-dev-utils/html-element', () => ({
  createFragmentAsync: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/metadata-cache', () => ({
  getCacheSafe: vi.fn()
}));

vi.mock('../composers/composer-base.ts', () => ({
  getSelectionUnderHeading: vi.fn()
}));

vi.mock('../composers/split-composer.ts', () => {
  const MockSplitComposer = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- vi.fn() prototype is untyped in mock factories.
  MockSplitComposer.prototype.splitFile = vi.fn().mockResolvedValue(undefined);
  return { SplitComposer: MockSplitComposer };
});

vi.mock('../modals/split-file-modal.ts', () => ({
  prepareForSplitFile: vi.fn()
}));

const mockCreateFragmentAsync = vi.mocked(createFragmentAsync);
const mockRenderInternalLink = vi.mocked(renderInternalLink);
const mockPrepareForSplitFile = vi.mocked(prepareForSplitFile);
const MockSplitComposer = vi.mocked(SplitComposer);
const mockGetCacheSafe = vi.mocked(getCacheSafe);
const mockGetSelectionUnderHeading = vi.mocked(getSelectionUnderHeading);

interface SplitNoteByHeadingsContentEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly editorLockComponent: EditorLockComponent;
  readonly headingLevel: Level;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

function createHeading(level: number, startLine: number, endLine?: number): HeadingCache {
  return strictProxy<HeadingCache>({
    heading: `Heading ${String(startLine)}`,
    level,
    position: {
      end: { col: 10, line: endLine ?? startLine, offset: 0 },
      start: { col: 0, line: startLine, offset: 0 }
    }
  });
}

function createMockCtx(file: null | TFile): MarkdownFileInfo {
  return strictProxy<MarkdownFileInfo>({ file });
}

function createMockEditor(): Editor {
  return strictProxy<Editor>({
    replaceRange: vi.fn(),
    setSelection: vi.fn()
  });
}

function createMockFile(): TFile {
  return strictProxy<TFile>({ path: 'test/note.md' });
}

function createMockParams(
  headingLevel: Level,
  isPathIgnored = false,
  shouldAddCommandsToSubmenu = true,
  shouldKeepHeadingsWhenSplittingContent = true
): SplitNoteByHeadingsContentEditorCommandHandlerConstructorParams {
  return {
    app: strictProxy<App>({
      metadataCache: strictProxy<MetadataCache>({
        getFileCache: vi.fn()
      })
    }),
    consoleDebugComponent: strictProxy<ConsoleDebugComponent>({}),
    editorLockComponent: strictProxy<EditorLockComponent>({}),
    headingLevel,
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice: vi.fn().mockReturnValue({ hide: vi.fn() }) }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        isPathIgnored: vi.fn().mockReturnValue(isPathIgnored),
        shouldAddCommandsToSubmenu,
        shouldKeepHeadingsWhenSplittingContent
      })
    })
  };
}

function toTestable(handler: SplitNoteByHeadingsContentEditorCommandHandler): TestableHandler {
  return castTo<TestableHandler>(handler);
}

describe('SplitNoteByHeadingsContentEditorCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should construct with correct params for H3', () => {
    const params = createMockParams(3);
    const handler = toTestable(new SplitNoteByHeadingsContentEditorCommandHandler(params));
    expect(handler.id).toBe('split-note-by-headings-content-h3');
    expect(handler.name).toBe('Split note by headings content - H3');
    expect(handler.icon).toBe('lucide-scissors-line-dashed');
  });

  it('should return false from canExecuteEditor when file is null', () => {
    const params = createMockParams(2);
    const handler = toTestable(new SplitNoteByHeadingsContentEditorCommandHandler(params));
    const editor = createMockEditor();
    const ctx = createMockCtx(null);

    expect(handler.canExecuteEditor(editor, ctx)).toBe(false);
  });

  it('should return false from canExecuteEditor when cache is null', () => {
    const params = createMockParams(2);
    const handler = toTestable(new SplitNoteByHeadingsContentEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const ctx = createMockCtx(file);

    vi.mocked(params.app.metadataCache.getFileCache).mockReturnValue(null);

    expect(handler.canExecuteEditor(editor, ctx)).toBe(false);
  });

  it('should return false from canExecuteEditor when no headings match level', () => {
    const params = createMockParams(2);
    const handler = toTestable(new SplitNoteByHeadingsContentEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const ctx = createMockCtx(file);

    vi.mocked(params.app.metadataCache.getFileCache).mockReturnValue(
      strictProxy<CachedMetadata>({ headings: [createHeading(1, 0)] })
    );

    expect(handler.canExecuteEditor(editor, ctx)).toBe(false);
  });

  it('should return false from canExecuteEditor when headings is undefined', () => {
    const params = createMockParams(2);
    const handler = toTestable(new SplitNoteByHeadingsContentEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const ctx = createMockCtx(file);

    vi.mocked(params.app.metadataCache.getFileCache).mockReturnValue(
      {}
    );

    expect(handler.canExecuteEditor(editor, ctx)).toBe(false);
  });

  it('should return true from canExecuteEditor when matching headings exist', () => {
    const params = createMockParams(2);
    const handler = toTestable(new SplitNoteByHeadingsContentEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const ctx = createMockCtx(file);

    vi.mocked(params.app.metadataCache.getFileCache).mockReturnValue(
      strictProxy<CachedMetadata>({ headings: [createHeading(2, 0)] })
    );

    expect(handler.canExecuteEditor(editor, ctx)).toBe(true);
  });

  it('should return early when ctx.file is null in executeEditor', async () => {
    const params = createMockParams(2);
    const handler = toTestable(new SplitNoteByHeadingsContentEditorCommandHandler(params));
    const editor = createMockEditor();
    const ctx = createMockCtx(null);

    await handler.executeEditor(editor, ctx);

    expect(mockGetCacheSafe).not.toHaveBeenCalled();
  });

  it('should show notice and return when path is ignored', async () => {
    const params = createMockParams(2, true);
    const handler = toTestable(new SplitNoteByHeadingsContentEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const ctx = createMockCtx(file);

    const mockFragment = strictProxy<DocumentFragment>({
      appendChild: vi.fn(),
      appendText: vi.fn()
    });
    mockCreateFragmentAsync.mockImplementation(async (cb) => {
      await (cb as (f: DocumentFragment) => Promise<void>)(mockFragment);
      return mockFragment;
    });
    mockRenderInternalLink.mockResolvedValue(activeDocument.createElement('a'));

    await handler.executeEditor(editor, ctx);

    expect(params.pluginNoticeComponent.showNotice).toHaveBeenCalled();
    expect(mockGetCacheSafe).not.toHaveBeenCalled();
  });

  it('should break loop when getCacheSafe returns null', async () => {
    const params = createMockParams(2, false);
    const handler = toTestable(new SplitNoteByHeadingsContentEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const ctx = createMockCtx(file);

    mockGetCacheSafe.mockResolvedValue(null);

    await handler.executeEditor(editor, ctx);

    expect(MockSplitComposer).not.toHaveBeenCalled();
  });

  it('should break loop when no matching heading found', async () => {
    const params = createMockParams(2, false);
    const handler = toTestable(new SplitNoteByHeadingsContentEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const ctx = createMockCtx(file);

    mockGetCacheSafe.mockResolvedValue(strictProxy<CachedMetadata>({ headings: [createHeading(1, 0)] }));

    await handler.executeEditor(editor, ctx);

    expect(MockSplitComposer).not.toHaveBeenCalled();
  });

  it('should show notice when getSelectionUnderHeading returns null', async () => {
    const params = createMockParams(2, false);
    const handler = toTestable(new SplitNoteByHeadingsContentEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const ctx = createMockCtx(file);

    mockGetCacheSafe.mockResolvedValue(
      strictProxy<CachedMetadata>({ headings: [createHeading(2, 0)] })
    );
    mockGetSelectionUnderHeading.mockReturnValue(null);

    await handler.executeEditor(editor, ctx);

    expect(params.pluginNoticeComponent.showNotice).toHaveBeenCalledWith('Failed to find heading');
  });

  it('should return when prepareForSplitFile returns null', async () => {
    const params = createMockParams(2, false);
    const handler = toTestable(new SplitNoteByHeadingsContentEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const ctx = createMockCtx(file);

    mockGetCacheSafe.mockResolvedValue(
      strictProxy<CachedMetadata>({ headings: [createHeading(2, 0)] })
    );
    mockGetSelectionUnderHeading.mockReturnValue({
      end: { ch: 0, line: 5 },
      heading: 'My Heading',
      start: { ch: 0, line: 0 }
    });
    mockPrepareForSplitFile.mockResolvedValue(null);

    await handler.executeEditor(editor, ctx);

    expect(MockSplitComposer).not.toHaveBeenCalled();
  });

  it('should increment headingIndex when shouldKeepHeadingsWhenSplittingContent is true', async () => {
    const params = createMockParams(2, false, true, true);
    const handler = toTestable(new SplitNoteByHeadingsContentEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const ctx = createMockCtx(file);
    const targetFile = createMockFile();

    const heading = createHeading(2, 3, 3);

    let callCount = 0;
    mockGetCacheSafe.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(strictProxy<CachedMetadata>({ headings: [heading] }));
      }
      return Promise.resolve(strictProxy<CachedMetadata>({ headings: [heading] }));
    });

    mockGetSelectionUnderHeading.mockReturnValueOnce({
      end: { ch: 0, line: 8 },
      heading: 'My Heading',
      start: { ch: 0, line: 3 }
    });

    const splitResult = strictProxy<PrepareForSplitFileResult>({
      isNewTargetFile: true,
      targetFile
    });
    mockPrepareForSplitFile.mockResolvedValueOnce(splitResult);

    const mockSplitFile = vi.fn().mockResolvedValue(undefined);
    MockSplitComposer.prototype.splitFile = mockSplitFile;

    // Second iteration: no heading at index 1
    mockGetCacheSafe.mockResolvedValueOnce(strictProxy<CachedMetadata>({ headings: [heading] }));

    await handler.executeEditor(editor, ctx);

    expect(vi.mocked(editor.setSelection)).toHaveBeenCalledWith(
      { ch: 0, line: 4 },
      { ch: 0, line: 8 }
    );
    expect(mockSplitFile).toHaveBeenCalled();
    expect(vi.mocked(editor.replaceRange)).not.toHaveBeenCalled();
  });

  it('should call replaceRange when shouldKeepHeadingsWhenSplittingContent is false', async () => {
    const params = createMockParams(2, false, true, false);
    const handler = toTestable(new SplitNoteByHeadingsContentEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const ctx = createMockCtx(file);
    const targetFile = createMockFile();

    const heading = createHeading(2, 3, 3);

    let callCount = 0;
    mockGetCacheSafe.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(strictProxy<CachedMetadata>({ headings: [heading] }));
      }
      return Promise.resolve(strictProxy<CachedMetadata>({ headings: [] }));
    });

    mockGetSelectionUnderHeading.mockReturnValue({
      end: { ch: 0, line: 8 },
      heading: 'My Heading',
      start: { ch: 0, line: 3 }
    });

    const splitResult = strictProxy<PrepareForSplitFileResult>({
      isNewTargetFile: true,
      targetFile
    });
    mockPrepareForSplitFile.mockResolvedValue(splitResult);

    const mockSplitFile = vi.fn().mockResolvedValue(undefined);
    MockSplitComposer.prototype.splitFile = mockSplitFile;

    await handler.executeEditor(editor, ctx);

    expect(vi.mocked(editor.replaceRange)).toHaveBeenCalledWith(
      '',
      { ch: 0, line: 3 },
      { ch: 0, line: 4 }
    );
  });

  it('should return shouldAddCommandsToSubmenu setting when super returns undefined', () => {
    const params = createMockParams(2, false, true);
    const handler = toTestable(new SplitNoteByHeadingsContentEditorCommandHandler(params));
    expect(handler.shouldAddCommandToSubmenu()).toBe(true);
  });

  it('should return false from shouldAddCommandToSubmenu when setting is false', () => {
    const params = createMockParams(2, false, false);
    const handler = toTestable(new SplitNoteByHeadingsContentEditorCommandHandler(params));
    expect(handler.shouldAddCommandToSubmenu()).toBe(false);
  });

  it('should return true from shouldAddToEditorMenu', () => {
    const params = createMockParams(2);
    const handler = toTestable(new SplitNoteByHeadingsContentEditorCommandHandler(params));
    const editor = createMockEditor();
    const ctx = createMockCtx(createMockFile());
    expect(handler.shouldAddToEditorMenu(editor, ctx)).toBe(true);
  });
});
