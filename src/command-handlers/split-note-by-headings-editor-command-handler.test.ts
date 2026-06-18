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

import { Notice } from 'obsidian';
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
import type { PrepareForSplitFileResult } from '../modals/split-file-modal.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';

import { getSelectionUnderHeading } from '../composers/composer-base.ts';
import { SplitComposer } from '../composers/split-composer.ts';
import { prepareForSplitFile } from '../modals/split-file-modal.ts';
import { SplitNoteByHeadingsEditorCommandHandler } from './split-note-by-headings-editor-command-handler.ts';

interface TestableHandler {
  canExecuteEditor(editor: Editor, ctx: MarkdownFileInfo): boolean;
  executeEditor(editor: Editor, ctx: MarkdownFileInfo): Promise<void>;
  params: unknown;
  shouldAddCommandToSubmenu(): boolean;
  shouldAddToEditorMenu(editor: Editor, ctx: MarkdownFileInfo): boolean;
}

vi.mock('obsidian', () => ({
  Notice: vi.fn()
}));

vi.mock('obsidian-dev-utils/html-element', () => ({
  createFragmentAsync: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/command-handlers/editor-command-handler', () => {
  class EditorCommandHandler {
    public readonly params: unknown;
    public constructor(params: unknown) {
      this.params = params;
    }

    protected canExecuteEditor(_editor: unknown, _ctx: unknown): boolean {
      return true;
    }

    protected shouldAddCommandToSubmenu(): boolean | undefined {
      return undefined;
    }

    protected shouldAddToEditorMenu(_editor: unknown, _ctx: unknown): boolean {
      return false;
    }
  }
  return { EditorCommandHandler };
});

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
const MockNotice = vi.mocked(Notice);
const mockGetCacheSafe = vi.mocked(getCacheSafe);
const mockGetSelectionUnderHeading = vi.mocked(getSelectionUnderHeading);

interface SplitNoteByHeadingsEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly headingLevel: Level;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

function createHeading(level: number, line: number): HeadingCache {
  return strictProxy<HeadingCache>({
    heading: `Heading ${String(line)}`,
    level,
    position: {
      end: { col: 10, line, offset: 0 },
      start: { col: 0, line, offset: 0 }
    }
  });
}

function createMockCtx(file: null | TFile): MarkdownFileInfo {
  return strictProxy<MarkdownFileInfo>({ file });
}

function createMockEditor(): Editor {
  return strictProxy<Editor>({
    setSelection: vi.fn()
  });
}

function createMockFile(): TFile {
  return strictProxy<TFile>({ path: 'test/note.md' });
}

function createMockParams(headingLevel: Level, isPathIgnored = false, shouldAddCommandsToSubmenu = true): SplitNoteByHeadingsEditorCommandHandlerConstructorParams {
  return {
    app: strictProxy<App>({
      metadataCache: strictProxy<MetadataCache>({
        getFileCache: vi.fn()
      })
    }),
    consoleDebugComponent: strictProxy<ConsoleDebugComponent>({}),
    headingLevel,
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        isPathIgnored: vi.fn().mockReturnValue(isPathIgnored),
        shouldAddCommandsToSubmenu
      })
    })
  };
}

function toTestable(handler: SplitNoteByHeadingsEditorCommandHandler): TestableHandler {
  return castTo<TestableHandler>(handler);
}

describe('SplitNoteByHeadingsEditorCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should construct with correct params for H2', () => {
    const params = createMockParams(2);
    const handler = toTestable(new SplitNoteByHeadingsEditorCommandHandler(params));
    expect(handler.params).toStrictEqual({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-scissors-line-dashed',
      id: 'split-note-by-headings-h2',
      name: 'Split note by headings - H2'
    });
  });

  it('should return false from canExecuteEditor when file is null', () => {
    const params = createMockParams(2);
    const handler = toTestable(new SplitNoteByHeadingsEditorCommandHandler(params));
    const editor = createMockEditor();
    const ctx = createMockCtx(null);

    expect(handler.canExecuteEditor(editor, ctx)).toBe(false);
  });

  it('should return false from canExecuteEditor when cache is null', () => {
    const params = createMockParams(2);
    const handler = toTestable(new SplitNoteByHeadingsEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const ctx = createMockCtx(file);

    vi.mocked(params.app.metadataCache.getFileCache).mockReturnValue(null);

    expect(handler.canExecuteEditor(editor, ctx)).toBe(false);
  });

  it('should return false from canExecuteEditor when no headings match the level', () => {
    const params = createMockParams(2);
    const handler = toTestable(new SplitNoteByHeadingsEditorCommandHandler(params));
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
    const handler = toTestable(new SplitNoteByHeadingsEditorCommandHandler(params));
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
    const handler = toTestable(new SplitNoteByHeadingsEditorCommandHandler(params));
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
    const handler = toTestable(new SplitNoteByHeadingsEditorCommandHandler(params));
    const editor = createMockEditor();
    const ctx = createMockCtx(null);

    await handler.executeEditor(editor, ctx);

    expect(mockGetCacheSafe).not.toHaveBeenCalled();
  });

  it('should show notice and return when path is ignored', async () => {
    const params = createMockParams(2, true);
    const handler = toTestable(new SplitNoteByHeadingsEditorCommandHandler(params));
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

    expect(MockNotice).toHaveBeenCalled();
    expect(mockGetCacheSafe).not.toHaveBeenCalled();
  });

  it('should break loop when getCacheSafe returns null', async () => {
    const params = createMockParams(2, false);
    const handler = toTestable(new SplitNoteByHeadingsEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const ctx = createMockCtx(file);

    mockGetCacheSafe.mockResolvedValue(null);

    await handler.executeEditor(editor, ctx);

    expect(MockSplitComposer).not.toHaveBeenCalled();
  });

  it('should break loop when no matching heading found in cache', async () => {
    const params = createMockParams(2, false);
    const handler = toTestable(new SplitNoteByHeadingsEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const ctx = createMockCtx(file);

    mockGetCacheSafe.mockResolvedValue(strictProxy<CachedMetadata>({ headings: [createHeading(1, 0)] }));

    await handler.executeEditor(editor, ctx);

    expect(MockSplitComposer).not.toHaveBeenCalled();
  });

  it('should break loop when cache has no headings', async () => {
    const params = createMockParams(2, false);
    const handler = toTestable(new SplitNoteByHeadingsEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const ctx = createMockCtx(file);

    mockGetCacheSafe.mockResolvedValue({});

    await handler.executeEditor(editor, ctx);

    expect(MockSplitComposer).not.toHaveBeenCalled();
  });

  it('should show notice when getSelectionUnderHeading returns null', async () => {
    const params = createMockParams(2, false);
    const handler = toTestable(new SplitNoteByHeadingsEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const ctx = createMockCtx(file);

    mockGetCacheSafe.mockResolvedValue(
      strictProxy<CachedMetadata>({ headings: [createHeading(2, 0)] })
    );
    mockGetSelectionUnderHeading.mockReturnValue(null);

    await handler.executeEditor(editor, ctx);

    expect(MockNotice).toHaveBeenCalledWith('Failed to find heading');
  });

  it('should return when prepareForSplitFile returns null', async () => {
    const params = createMockParams(2, false);
    const handler = toTestable(new SplitNoteByHeadingsEditorCommandHandler(params));
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

  it('should create SplitComposer and loop until no more headings', async () => {
    const params = createMockParams(2, false);
    const handler = toTestable(new SplitNoteByHeadingsEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const ctx = createMockCtx(file);
    const targetFile = createMockFile();

    let callCount = 0;
    mockGetCacheSafe.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(strictProxy<CachedMetadata>({ headings: [createHeading(2, 0)] }));
      }
      return Promise.resolve(strictProxy<CachedMetadata>({ headings: [] }));
    });

    mockGetSelectionUnderHeading.mockReturnValue({
      end: { ch: 0, line: 5 },
      heading: 'My Heading',
      start: { ch: 0, line: 0 }
    });

    const splitResult = strictProxy<PrepareForSplitFileResult>({
      isNewTargetFile: true,
      targetFile
    });
    mockPrepareForSplitFile.mockResolvedValue(splitResult);

    const mockSplitFile = vi.fn().mockResolvedValue(undefined);
    MockSplitComposer.prototype.splitFile = mockSplitFile;

    await handler.executeEditor(editor, ctx);

    expect(MockSplitComposer).toHaveBeenCalledTimes(1);
    expect(mockSplitFile).toHaveBeenCalledTimes(1);
    expect(MockSplitComposer).toHaveBeenCalledWith({
      app: params.app,
      consoleDebugComponent: params.consoleDebugComponent,
      editor,
      heading: 'My Heading',
      isMultipleSplit: true,
      isNewTargetFile: true,
      pluginSettingsComponent: params.pluginSettingsComponent,
      sourceFile: file,
      targetFile
    });
  });

  it('should return shouldAddCommandsToSubmenu setting when super returns undefined', () => {
    const params = createMockParams(2, false, true);
    const handler = toTestable(new SplitNoteByHeadingsEditorCommandHandler(params));
    expect(handler.shouldAddCommandToSubmenu()).toBe(true);
  });

  it('should return false from shouldAddCommandToSubmenu when setting is false', () => {
    const params = createMockParams(2, false, false);
    const handler = toTestable(new SplitNoteByHeadingsEditorCommandHandler(params));
    expect(handler.shouldAddCommandToSubmenu()).toBe(false);
  });

  it('should return true from shouldAddToEditorMenu', () => {
    const params = createMockParams(2);
    const handler = toTestable(new SplitNoteByHeadingsEditorCommandHandler(params));
    const editor = createMockEditor();
    const ctx = createMockCtx(createMockFile());
    expect(handler.shouldAddToEditorMenu(editor, ctx)).toBe(true);
  });
});
