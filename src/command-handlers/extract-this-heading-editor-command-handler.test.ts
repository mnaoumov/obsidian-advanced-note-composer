import type {
  App,
  Editor,
  MarkdownFileInfo,
  TFile
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

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

import type { MoveNoticeComponent } from '../move-notice-component.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';
import type { SelectionHighlightComponent } from '../selection-highlight-component.ts';

import {
  getEnclosingHeadingLine,
  getSelectionUnderHeading
} from '../composers/composer-base.ts';
import { SplitComposer } from '../composers/split-composer.ts';
import { InsertMode } from '../insert-mode.ts';
import { prepareForSplitFile } from '../modals/split-file-modal.ts';
import { MoveSelectionBuffer } from '../move-selection-buffer.ts';
import { FrontmatterMergeStrategy } from '../plugin-settings.ts';
import { ExtractThisHeadingEditorCommandHandler } from './extract-this-heading-editor-command-handler.ts';

interface TestableHandler {
  canExecuteEditor(editor: Editor, context: MarkdownFileInfo): boolean;
  executeEditor(editor: Editor, context: MarkdownFileInfo): Promise<void>;
  readonly icon: string;
  readonly id: string;
  readonly name: string;
  shouldAddCommandToSubmenu(): boolean;
  shouldAddToEditorMenu(editor: Editor, context: MarkdownFileInfo): boolean;
}

vi.mock('obsidian-dev-utils/html-element', () => ({
  createFragmentAsync: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn()
}));

vi.mock('../composers/composer-base.ts', () => ({
  getEnclosingHeadingLine: vi.fn(),
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
const mockGetEnclosingHeadingLine = vi.mocked(getEnclosingHeadingLine);
const mockGetSelectionUnderHeading = vi.mocked(getSelectionUnderHeading);

interface HandlerParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly moveNoticeComponent: MoveNoticeComponent;
  readonly moveSelectionBuffer: MoveSelectionBuffer;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
  readonly selectionHighlightComponent: SelectionHighlightComponent;
}

function createMockContext(file: null | TFile): MarkdownFileInfo {
  return strictProxy<MarkdownFileInfo>({ file });
}

function createMockEditor(isSomethingSelected = false): Editor {
  return strictProxy<Editor>({
    getCursor: vi.fn().mockReturnValue({ ch: 0, line: 2 }),
    getLine: vi.fn().mockReturnValue('## My Heading'),
    setSelection: vi.fn(),
    somethingSelected: vi.fn().mockReturnValue(isSomethingSelected)
  });
}

function createMockFile(): TFile {
  return strictProxy<TFile>({ path: 'test/note.md' });
}

function createMockParams(
  isPathIgnored = false,
  shouldAddCommandsToSubmenu = true,
  shouldBlockCommandOnPath = false,
  shouldSplitHeadingsAutomatically = false
): HandlerParams {
  return {
    app: strictProxy<App>({}),
    consoleDebugComponent: strictProxy<ConsoleDebugComponent>({
      consoleDebug: vi.fn()
    }),
    moveNoticeComponent: strictProxy<MoveNoticeComponent>({}),
    moveSelectionBuffer: new MoveSelectionBuffer(),
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice: vi.fn().mockReturnValue({ hide: vi.fn() }) }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        isPathIgnored: vi.fn().mockReturnValue(isPathIgnored),
        shouldAddCommandsToSubmenu,
        shouldBlockCommandOnPath: vi.fn().mockReturnValue(shouldBlockCommandOnPath),
        shouldSplitHeadingsAutomatically
      })
    }),
    resourceLockComponent: strictProxy<ResourceLockComponent>({}),
    selectionHighlightComponent: strictProxy<SelectionHighlightComponent>({})
  };
}

function toTestable(handler: ExtractThisHeadingEditorCommandHandler): TestableHandler {
  return castTo<TestableHandler>(handler);
}

describe('ExtractThisHeadingEditorCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEnclosingHeadingLine.mockReturnValue(2);
  });

  it('should construct with correct params', () => {
    const params = createMockParams();
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    expect(handler.id).toBe('extract-this-heading');
    expect(handler.name).toBe('Extract this heading...');
    expect(handler.icon).toBe('lucide-scissors');
  });

  it('should return false from canExecuteEditor when context.file is null', () => {
    const params = createMockParams();
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    const editor = createMockEditor();
    const context = createMockContext(null);

    expect(handler.canExecuteEditor(editor, context)).toBe(false);
  });

  it('should return false from canExecuteEditor when cursor is not under any heading', () => {
    const params = createMockParams();
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const context = createMockContext(file);

    mockGetEnclosingHeadingLine.mockReturnValue(null);

    expect(handler.canExecuteEditor(editor, context)).toBe(false);
  });

  it('should return false from canExecuteEditor when getSelectionUnderHeading returns null', () => {
    const params = createMockParams();
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const context = createMockContext(file);

    mockGetEnclosingHeadingLine.mockReturnValue(0);
    mockGetSelectionUnderHeading.mockReturnValue(null);

    expect(handler.canExecuteEditor(editor, context)).toBe(false);
  });

  it('should return true from canExecuteEditor when cursor is inside a heading body', () => {
    const params = createMockParams();
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const context = createMockContext(file);

    // Cursor is on line 2, but the enclosing heading starts on line 0 (the body case).
    mockGetEnclosingHeadingLine.mockReturnValue(0);
    mockGetSelectionUnderHeading.mockReturnValue({
      end: { ch: 0, line: 5 },
      heading: 'My Heading',
      start: { ch: 0, line: 0 }
    });

    expect(handler.canExecuteEditor(editor, context)).toBe(true);
    expect(mockGetSelectionUnderHeading).toHaveBeenCalledWith(expect.objectContaining({ lineNumber: 0 }));
  });

  it('should return false from canExecuteEditor when the command is blocked on the path', () => {
    const params = createMockParams(false, true, true);
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    const editor = createMockEditor();
    const context = createMockContext(createMockFile());

    expect(handler.canExecuteEditor(editor, context)).toBe(false);
  });

  it('should return early when context.file is null in executeEditor', async () => {
    const params = createMockParams();
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    const editor = createMockEditor();
    const context = createMockContext(null);

    await handler.executeEditor(editor, context);

    expect(mockPrepareForSplitFile).not.toHaveBeenCalled();
  });

  it('should show notice and return when path is ignored', async () => {
    const params = createMockParams(true);
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const context = createMockContext(file);

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

    await handler.executeEditor(editor, context);

    expect(params.pluginNoticeComponent.showNotice).toHaveBeenCalled();
    expect(mockPrepareForSplitFile).not.toHaveBeenCalled();
  });

  it('should return early when headingInfo is undefined', async () => {
    const params = createMockParams(false);
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const context = createMockContext(file);

    await handler.executeEditor(editor, context);

    expect(mockPrepareForSplitFile).not.toHaveBeenCalled();
  });

  it('should return when prepareForSplitFile returns null', async () => {
    const params = createMockParams(false);
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const context = createMockContext(file);

    const headingInfo = {
      end: { ch: 0, line: 5 },
      heading: 'My Heading',
      start: { ch: 0, line: 2 }
    };
    mockGetSelectionUnderHeading.mockReturnValue(headingInfo);
    handler.canExecuteEditor(editor, context);

    mockPrepareForSplitFile.mockResolvedValue(null);

    await handler.executeEditor(editor, context);

    expect(vi.mocked(editor.setSelection)).toHaveBeenCalledWith(headingInfo.start, headingInfo.end);
    expect(MockSplitComposer).not.toHaveBeenCalled();
  });

  it('should create SplitComposer and call splitFile on happy path', async () => {
    const params = createMockParams(false);
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const context = createMockContext(file);
    const targetFile = createMockFile();

    const headingInfo = {
      end: { ch: 0, line: 5 },
      heading: 'My Heading',
      start: { ch: 0, line: 2 }
    };
    mockGetSelectionUnderHeading.mockReturnValue(headingInfo);
    handler.canExecuteEditor(editor, context);

    const splitResult = {
      capturedSelections: [{ endOffset: 5, startOffset: 0 }],
      frontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues,
      insertMode: InsertMode.Append,
      isNewTargetFile: true,
      selectedText: 'extracted text',
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

    await handler.executeEditor(editor, context);

    expect(MockSplitComposer).toHaveBeenCalled();
    expect(mockSplitFile).toHaveBeenCalled();
  });

  it('should skip the target picker and name the note after the heading when splitting headings automatically', async () => {
    const params = createMockParams(false, true, false, true);
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    const editor = createMockEditor();
    const context = createMockContext(createMockFile());

    mockGetSelectionUnderHeading.mockReturnValue({
      end: { ch: 0, line: 5 },
      heading: 'My Heading',
      start: { ch: 0, line: 2 }
    });
    handler.canExecuteEditor(editor, context);
    mockPrepareForSplitFile.mockResolvedValue(null);

    await handler.executeEditor(editor, context);

    expect(mockPrepareForSplitFile).toHaveBeenCalledWith(expect.objectContaining({
      heading: 'My Heading',
      shouldSkipModal: true
    }));
  });

  it('should keep the target picker when splitting headings automatically is disabled', async () => {
    const params = createMockParams(false, true, false, false);
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    const editor = createMockEditor();
    const context = createMockContext(createMockFile());

    mockGetSelectionUnderHeading.mockReturnValue({
      end: { ch: 0, line: 5 },
      heading: 'My Heading',
      start: { ch: 0, line: 2 }
    });
    handler.canExecuteEditor(editor, context);
    mockPrepareForSplitFile.mockResolvedValue(null);

    await handler.executeEditor(editor, context);

    expect(mockPrepareForSplitFile).toHaveBeenCalledWith(expect.objectContaining({
      heading: 'My Heading',
      shouldSkipModal: false
    }));
  });

  it('should return true from shouldAddToEditorMenu when nothing is selected', () => {
    const params = createMockParams();
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    const editor = createMockEditor();
    const context = createMockContext(createMockFile());
    expect(handler.shouldAddToEditorMenu(editor, context)).toBe(true);
  });

  it('should return false from shouldAddToEditorMenu when something is selected (issue #188)', () => {
    const params = createMockParams();
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    const editor = createMockEditor(true);
    const context = createMockContext(createMockFile());
    expect(handler.shouldAddToEditorMenu(editor, context)).toBe(false);
  });

  it('should still return true from canExecuteEditor when something is selected, so the palette command stays available (issue #188)', () => {
    const params = createMockParams();
    const handler = toTestable(new ExtractThisHeadingEditorCommandHandler(params));
    const editor = createMockEditor(true);
    const context = createMockContext(createMockFile());

    mockGetSelectionUnderHeading.mockReturnValue({
      end: { ch: 0, line: 5 },
      heading: 'My Heading',
      start: { ch: 0, line: 2 }
    });

    expect(handler.canExecuteEditor(editor, context)).toBe(true);
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
