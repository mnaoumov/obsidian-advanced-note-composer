import type {
  App,
  Editor,
  MarkdownFileInfo,
  TFile
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';

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

import { getSelectionUnderHeading } from '../composers/composer-base.ts';
import { SplitComposer } from '../composers/split-composer.ts';
import { extractHeadingFromLine } from '../headings.ts';
import { InsertMode } from '../insert-mode.ts';
import { prepareForSplitFile } from '../modals/split-file-modal.ts';
import { FrontmatterMergeStrategy } from '../plugin-settings.ts';
import { ExtractThisHeadingEditorCommandHandler } from './extract-this-heading-editor-command-handler.ts';

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

    protected shouldAddToEditorMenu(_editor: unknown, _ctx: unknown): boolean {
      return false;
    }
  }
  return { EditorCommandHandler };
});

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn()
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

vi.mock('../headings.ts', () => ({
  extractHeadingFromLine: vi.fn()
}));

vi.mock('../modals/split-file-modal.ts', () => ({
  prepareForSplitFile: vi.fn()
}));

const mockCreateFragmentAsync = vi.mocked(createFragmentAsync);
const mockRenderInternalLink = vi.mocked(renderInternalLink);
const mockPrepareForSplitFile = vi.mocked(prepareForSplitFile);
const MockSplitComposer = vi.mocked(SplitComposer);
const MockNotice = vi.mocked(Notice);
const mockExtractHeadingFromLine = vi.mocked(extractHeadingFromLine);
const mockGetSelectionUnderHeading = vi.mocked(getSelectionUnderHeading);

interface HandlerParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

function createMockCtx(file: null | TFile): MarkdownFileInfo {
  return strictProxy<MarkdownFileInfo>({ file });
}

function createMockEditor(): Editor {
  return strictProxy<Editor>({
    getCursor: vi.fn().mockReturnValue({ ch: 0, line: 2 }),
    getLine: vi.fn().mockReturnValue('## My Heading'),
    setSelection: vi.fn()
  });
}

function createMockFile(): TFile {
  return strictProxy<TFile>({ path: 'test/note.md' });
}

function createMockParams(isPathIgnored = false, shouldAddCommandsToSubmenu = true): HandlerParams {
  return {
    app: strictProxy<App>({}),
    consoleDebugComponent: strictProxy<ConsoleDebugComponent>({
      consoleDebug: vi.fn()
    }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        isPathIgnored: vi.fn().mockReturnValue(isPathIgnored),
        shouldAddCommandsToSubmenu
      })
    })
  };
}

function toTestable(handler: ExtractThisHeadingEditorCommandHandler): TestableHandler {
  return castTo<TestableHandler>(handler);
}

describe('ExtractThisHeadingEditorCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should construct with correct params', () => {
    const params = createMockParams();
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    expect(handler.params).toStrictEqual({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-scissors',
      id: 'extract-this-heading',
      name: 'Extract this heading...'
    });
  });

  it('should return false from canExecuteEditor when ctx.file is null', () => {
    const params = createMockParams();
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    const editor = createMockEditor();
    const ctx = createMockCtx(null);

    expect(handler.canExecuteEditor(editor, ctx)).toBe(false);
  });

  it('should return false from canExecuteEditor when line has no heading', () => {
    const params = createMockParams();
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const ctx = createMockCtx(file);

    mockExtractHeadingFromLine.mockReturnValue(null);

    expect(handler.canExecuteEditor(editor, ctx)).toBe(false);
  });

  it('should return false from canExecuteEditor when getSelectionUnderHeading returns null', () => {
    const params = createMockParams();
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const ctx = createMockCtx(file);

    mockExtractHeadingFromLine.mockReturnValue('My Heading');
    mockGetSelectionUnderHeading.mockReturnValue(null);

    expect(handler.canExecuteEditor(editor, ctx)).toBe(false);
  });

  it('should return true from canExecuteEditor when heading is found', () => {
    const params = createMockParams();
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const ctx = createMockCtx(file);

    mockExtractHeadingFromLine.mockReturnValue('My Heading');
    mockGetSelectionUnderHeading.mockReturnValue({
      end: { ch: 0, line: 5 },
      heading: 'My Heading',
      start: { ch: 0, line: 2 }
    });

    expect(handler.canExecuteEditor(editor, ctx)).toBe(true);
  });

  it('should return early when ctx.file is null in executeEditor', async () => {
    const params = createMockParams();
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    const editor = createMockEditor();
    const ctx = createMockCtx(null);

    await handler.executeEditor(editor, ctx);

    expect(mockPrepareForSplitFile).not.toHaveBeenCalled();
  });

  it('should show notice and return when path is ignored', async () => {
    const params = createMockParams(true);
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
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
    expect(mockPrepareForSplitFile).not.toHaveBeenCalled();
  });

  it('should return early when headingInfo is undefined', async () => {
    const params = createMockParams(false);
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const ctx = createMockCtx(file);

    await handler.executeEditor(editor, ctx);

    expect(mockPrepareForSplitFile).not.toHaveBeenCalled();
  });

  it('should return when prepareForSplitFile returns null', async () => {
    const params = createMockParams(false);
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const ctx = createMockCtx(file);

    mockExtractHeadingFromLine.mockReturnValue('My Heading');
    const headingInfo = {
      end: { ch: 0, line: 5 },
      heading: 'My Heading',
      start: { ch: 0, line: 2 }
    };
    mockGetSelectionUnderHeading.mockReturnValue(headingInfo);
    handler.canExecuteEditor(editor, ctx);

    mockPrepareForSplitFile.mockResolvedValue(null);

    await handler.executeEditor(editor, ctx);

    expect(vi.mocked(editor.setSelection)).toHaveBeenCalledWith(headingInfo.start, headingInfo.end);
    expect(MockSplitComposer).not.toHaveBeenCalled();
  });

  it('should create SplitComposer and call splitFile on happy path', async () => {
    const params = createMockParams(false);
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const ctx = createMockCtx(file);
    const targetFile = createMockFile();

    mockExtractHeadingFromLine.mockReturnValue('My Heading');
    const headingInfo = {
      end: { ch: 0, line: 5 },
      heading: 'My Heading',
      start: { ch: 0, line: 2 }
    };
    mockGetSelectionUnderHeading.mockReturnValue(headingInfo);
    handler.canExecuteEditor(editor, ctx);

    const splitResult = {
      frontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues,
      insertMode: InsertMode.Append,
      isNewTargetFile: true,
      shouldAllowOnlyCurrentFolder: false,
      shouldAllowSplitIntoUnresolvedPath: true,
      shouldFixFootnotes: true,
      shouldIncludeFrontmatter: false,
      shouldMergeHeadings: false,
      targetFile
    };
    mockPrepareForSplitFile.mockResolvedValue(splitResult);

    const mockSplitFile = vi.fn().mockResolvedValue(undefined);
    MockSplitComposer.prototype.splitFile = mockSplitFile;

    await handler.executeEditor(editor, ctx);

    expect(MockSplitComposer).toHaveBeenCalled();
    expect(mockSplitFile).toHaveBeenCalled();
  });

  it('should return true from shouldAddToEditorMenu', () => {
    const params = createMockParams();
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    const editor = createMockEditor();
    const ctx = createMockCtx(createMockFile());
    expect(handler.shouldAddToEditorMenu(editor, ctx)).toBe(true);
  });

  it('should return shouldAddCommandsToSubmenu setting value', () => {
    const params = createMockParams(false, true);
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    expect(handler.shouldAddCommandToSubmenu()).toBe(true);
  });

  it('should return false from shouldAddCommandToSubmenu when setting is false', () => {
    const params = createMockParams(false, false);
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    expect(handler.shouldAddCommandToSubmenu()).toBe(false);
  });
});
