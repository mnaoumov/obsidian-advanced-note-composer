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

import { SplitComposer } from '../composers/split-composer.ts';
import { getSelectionBetweenHorizontalRules } from '../horizontal-rules.ts';
import { InsertMode } from '../insert-mode.ts';
import { prepareForSplitFile } from '../modals/split-file-modal.ts';
import { MoveSelectionBuffer } from '../move-selection-buffer.ts';
import { FrontmatterMergeStrategy } from '../plugin-settings.ts';
import { ExtractBetweenHorizontalRulesEditorCommandHandler } from './extract-between-horizontal-rules-editor-command-handler.ts';

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

vi.mock('../horizontal-rules.ts', () => ({
  getSelectionBetweenHorizontalRules: vi.fn()
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
const mockGetSelectionBetweenHorizontalRules = vi.mocked(getSelectionBetweenHorizontalRules);

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

const RANGE = {
  end: { ch: 3, line: 4 },
  start: { ch: 0, line: 2 }
};

function createMockCtx(file: null | TFile): MarkdownFileInfo {
  return strictProxy<MarkdownFileInfo>({ file });
}

function createMockEditor(): Editor {
  return strictProxy<Editor>({
    getCursor: vi.fn().mockReturnValue({ ch: 0, line: 3 }),
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
    moveNoticeComponent: strictProxy<MoveNoticeComponent>({}),
    moveSelectionBuffer: new MoveSelectionBuffer(),
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice: vi.fn().mockReturnValue({ hide: vi.fn() }) }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        isPathIgnored: vi.fn().mockReturnValue(isPathIgnored),
        shouldAddCommandsToSubmenu
      })
    }),
    resourceLockComponent: strictProxy<ResourceLockComponent>({}),
    selectionHighlightComponent: strictProxy<SelectionHighlightComponent>({})
  };
}

function toTestable(handler: ExtractBetweenHorizontalRulesEditorCommandHandler): TestableHandler {
  return castTo<TestableHandler>(handler);
}

describe('ExtractBetweenHorizontalRulesEditorCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should construct with correct params', () => {
    const handler = toTestable(new ExtractBetweenHorizontalRulesEditorCommandHandler(createMockParams()));
    expect(handler.id).toBe('extract-between-horizontal-rules');
    expect(handler.name).toBe('Extract between horizontal rules...');
    expect(handler.icon).toBe('lucide-separator-horizontal');
  });

  it('should return false from canExecuteEditor when ctx.file is null', () => {
    const handler = toTestable(new ExtractBetweenHorizontalRulesEditorCommandHandler(createMockParams()));
    expect(handler.canExecuteEditor(createMockEditor(), createMockCtx(null))).toBe(false);
  });

  it('should return false from canExecuteEditor when there is no rule-bounded section', () => {
    const handler = toTestable(new ExtractBetweenHorizontalRulesEditorCommandHandler(createMockParams()));
    mockGetSelectionBetweenHorizontalRules.mockReturnValue(null);
    expect(handler.canExecuteEditor(createMockEditor(), createMockCtx(createMockFile()))).toBe(false);
  });

  it('should return true from canExecuteEditor when a rule-bounded section is found', () => {
    const handler = toTestable(new ExtractBetweenHorizontalRulesEditorCommandHandler(createMockParams()));
    mockGetSelectionBetweenHorizontalRules.mockReturnValue(RANGE);
    expect(handler.canExecuteEditor(createMockEditor(), createMockCtx(createMockFile()))).toBe(true);
  });

  it('should return early when ctx.file is null in executeEditor', async () => {
    const handler = toTestable(new ExtractBetweenHorizontalRulesEditorCommandHandler(createMockParams()));
    await handler.executeEditor(createMockEditor(), createMockCtx(null));
    expect(mockPrepareForSplitFile).not.toHaveBeenCalled();
  });

  it('should show notice and return when path is ignored', async () => {
    const params = createMockParams(true);
    const handler = toTestable(new ExtractBetweenHorizontalRulesEditorCommandHandler(params));

    const mockFragment = strictProxy<DocumentFragment>({
      appendChild: vi.fn(),
      appendText: vi.fn()
    });
    mockCreateFragmentAsync.mockImplementation(async (cb) => {
      await (cb as (f: DocumentFragment) => Promise<void>)(mockFragment);
      return mockFragment;
    });
    mockRenderInternalLink.mockResolvedValue(createEl('a'));

    await handler.executeEditor(createMockEditor(), createMockCtx(createMockFile()));

    expect(params.pluginNoticeComponent.showNotice).toHaveBeenCalled();
    expect(mockPrepareForSplitFile).not.toHaveBeenCalled();
  });

  it('should return early when the range is undefined', async () => {
    const handler = toTestable(new ExtractBetweenHorizontalRulesEditorCommandHandler(createMockParams(false)));
    await handler.executeEditor(createMockEditor(), createMockCtx(createMockFile()));
    expect(mockPrepareForSplitFile).not.toHaveBeenCalled();
  });

  it('should return when prepareForSplitFile returns null', async () => {
    const handler = toTestable(new ExtractBetweenHorizontalRulesEditorCommandHandler(createMockParams(false)));
    const editor = createMockEditor();
    const ctx = createMockCtx(createMockFile());

    mockGetSelectionBetweenHorizontalRules.mockReturnValue(RANGE);
    handler.canExecuteEditor(editor, ctx);

    mockPrepareForSplitFile.mockResolvedValue(null);

    await handler.executeEditor(editor, ctx);

    expect(vi.mocked(editor.setSelection)).toHaveBeenCalledWith(RANGE.start, RANGE.end);
    expect(MockSplitComposer).not.toHaveBeenCalled();
  });

  it('should create SplitComposer and call splitFile on happy path', async () => {
    const handler = toTestable(new ExtractBetweenHorizontalRulesEditorCommandHandler(createMockParams(false)));
    const editor = createMockEditor();
    const ctx = createMockCtx(createMockFile());
    const targetFile = createMockFile();

    mockGetSelectionBetweenHorizontalRules.mockReturnValue(RANGE);
    handler.canExecuteEditor(editor, ctx);

    mockPrepareForSplitFile.mockResolvedValue({
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
    });

    const mockSplitFile = vi.fn().mockResolvedValue(undefined);
    MockSplitComposer.prototype.splitFile = mockSplitFile;

    await handler.executeEditor(editor, ctx);

    expect(vi.mocked(editor.setSelection)).toHaveBeenCalledWith(RANGE.start, RANGE.end);
    expect(MockSplitComposer).toHaveBeenCalled();
    expect(mockSplitFile).toHaveBeenCalled();
  });

  it('should return true from shouldAddToEditorMenu', () => {
    const handler = toTestable(new ExtractBetweenHorizontalRulesEditorCommandHandler(createMockParams()));
    expect(handler.shouldAddToEditorMenu(createMockEditor(), createMockCtx(createMockFile()))).toBe(true);
  });

  it('should return shouldAddCommandsToSubmenu setting value', () => {
    const handler = toTestable(new ExtractBetweenHorizontalRulesEditorCommandHandler(createMockParams(false, true)));
    expect(handler.shouldAddCommandToSubmenu()).toBe(true);
  });

  it('should return false from shouldAddCommandToSubmenu when setting is false', () => {
    const handler = toTestable(new ExtractBetweenHorizontalRulesEditorCommandHandler(createMockParams(false, false)));
    expect(handler.shouldAddCommandToSubmenu()).toBe(false);
  });
});
