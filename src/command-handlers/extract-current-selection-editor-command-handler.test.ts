import type {
  App,
  Editor,
  MarkdownFileInfo,
  MarkdownView,
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
import { InsertMode } from '../insert-mode.ts';
import { prepareForSplitFile } from '../modals/split-file-modal.ts';
import { MoveSelectionBuffer } from '../move-selection-buffer.ts';
import {
  CommandMenuPlacement,
  FrontmatterMergeStrategy
} from '../plugin-settings.ts';
import { ExtractCurrentSelectionEditorCommandHandler } from './extract-current-selection-editor-command-handler.ts';

interface TestableHandler {
  canExecuteEditor(editor: Editor, context: MarkdownFileInfo): boolean;
  executeEditor(editor: Editor, context: MarkdownFileInfo): Promise<void>;
  readonly icon: string;
  readonly id: string;
  readonly name: string;
  shouldAddCommandToSubmenu(): boolean;
  shouldAddToEditorMenu(): boolean;
  shouldAddToViewportMenu(view: MarkdownView, mode: string, source: string): boolean;
}

vi.mock('obsidian-dev-utils/html-element', () => ({
  createFragmentAsync: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn()
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

function createMockEditor(hasSomethingSelected = true): Editor {
  return strictProxy<Editor>({
    somethingSelected: vi.fn().mockReturnValue(hasSomethingSelected)
  });
}

function createMockFile(): TFile {
  return strictProxy<TFile>({ path: 'test/note.md' });
}

function createMockParams(isPathIgnored = false, shouldAddCommandsToSubmenu = true, shouldBlockCommandOnPath = false): HandlerParams {
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
        commandMenuPlacement: vi.fn().mockReturnValue(CommandMenuPlacement.EditorMenu),
        isPathIgnored: vi.fn().mockReturnValue(isPathIgnored),
        shouldAddCommandsToSubmenu,
        shouldBlockCommandOnPath: vi.fn().mockReturnValue(shouldBlockCommandOnPath)
      })
    }),
    resourceLockComponent: strictProxy<ResourceLockComponent>({}),
    selectionHighlightComponent: strictProxy<SelectionHighlightComponent>({})
  };
}

function toTestable(handler: ExtractCurrentSelectionEditorCommandHandler): TestableHandler {
  return castTo<TestableHandler>(handler);
}

describe('ExtractCurrentSelectionEditorCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should construct with correct params', () => {
    const params = createMockParams();
    const handler = toTestable(new ExtractCurrentSelectionEditorCommandHandler(params));
    expect(handler.id).toBe('extract-current-selection');
    expect(handler.name).toBe('Extract current selection...');
    expect(handler.icon).toBe('lucide-scissors');
  });

  it('should return true from canExecuteEditor when something is selected', () => {
    const params = createMockParams();
    const handler = toTestable(new ExtractCurrentSelectionEditorCommandHandler(params));
    const editor = createMockEditor(true);
    expect(handler.canExecuteEditor(editor, createMockContext(createMockFile()))).toBe(true);
  });

  it('should return false from canExecuteEditor when nothing is selected', () => {
    const params = createMockParams();
    const handler = toTestable(new ExtractCurrentSelectionEditorCommandHandler(params));
    const editor = createMockEditor(false);
    expect(handler.canExecuteEditor(editor, createMockContext(createMockFile()))).toBe(false);
  });

  it('should block canExecuteEditor when the command is blocked on the path', () => {
    const params = createMockParams(false, true, true);
    const handler = toTestable(new ExtractCurrentSelectionEditorCommandHandler(params));
    expect(handler.canExecuteEditor(createMockEditor(), createMockContext(createMockFile()))).toBe(false);
  });

  it('should allow canExecuteEditor when the command is not blocked on the path', () => {
    const params = createMockParams(false, true, false);
    const handler = toTestable(new ExtractCurrentSelectionEditorCommandHandler(params));
    expect(handler.canExecuteEditor(createMockEditor(), createMockContext(createMockFile()))).toBe(true);
  });

  it('should return early when context.file is null', async () => {
    const params = createMockParams();
    const handler = toTestable(new ExtractCurrentSelectionEditorCommandHandler(params));
    const editor = createMockEditor();
    const context = createMockContext(null);

    await handler.executeEditor(editor, context);

    expect(mockPrepareForSplitFile).not.toHaveBeenCalled();
  });

  it('should show notice and return when path is ignored', async () => {
    const params = createMockParams(true);
    const handler = toTestable(new ExtractCurrentSelectionEditorCommandHandler(params));
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

  it('should return when prepareForSplitFile returns null', async () => {
    const params = createMockParams(false);
    const handler = toTestable(new ExtractCurrentSelectionEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const context = createMockContext(file);

    mockPrepareForSplitFile.mockResolvedValue(null);

    await handler.executeEditor(editor, context);

    expect(MockSplitComposer).not.toHaveBeenCalled();
  });

  it('should create SplitComposer and call splitFile on happy path', async () => {
    const params = createMockParams(false);
    const handler = toTestable(new ExtractCurrentSelectionEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const context = createMockContext(file);
    const targetFile = createMockFile();

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

    expect(MockSplitComposer).toHaveBeenCalledWith({
      app: params.app,
      capturedSelections: [{ endOffset: 5, startOffset: 0 }],
      consoleDebugComponent: params.consoleDebugComponent,
      editor,
      frontmatterMergeStrategy: 'MergeAndPreferNewValues',
      insertMode: 'append',
      isMultipleSplit: false,
      isNewTargetFile: true,
      pluginNoticeComponent: params.pluginNoticeComponent,
      pluginSettingsComponent: params.pluginSettingsComponent,
      resourceLockComponent: params.resourceLockComponent,
      selectedText: 'extracted text',
      shouldFixFootnotes: true,
      shouldIncludeFrontmatter: false,
      shouldMergeHeadings: false,
      sourceFile: file,
      targetFile
    });
    expect(mockSplitFile).toHaveBeenCalled();
  });

  it('should return true from shouldAddToEditorMenu', () => {
    const params = createMockParams();
    const handler = toTestable(new ExtractCurrentSelectionEditorCommandHandler(params));
    expect(handler.shouldAddToEditorMenu()).toBe(true);
  });

  it('should return shouldAddCommandsToSubmenu setting value', () => {
    const params = createMockParams(false, true);
    const handler = toTestable(new ExtractCurrentSelectionEditorCommandHandler(params));
    expect(handler.shouldAddCommandToSubmenu()).toBe(true);
  });

  it('should return false from shouldAddCommandToSubmenu when setting is false', () => {
    const params = createMockParams(false, false);
    const handler = toTestable(new ExtractCurrentSelectionEditorCommandHandler(params));
    expect(handler.shouldAddCommandToSubmenu()).toBe(false);
  });
});

/**
 * The `mode` and `source` Obsidian passes with `markdown-viewport-menu` for a right-click on the empty
 * margin beside the text, or on the line-number gutter, of a note being edited (issue #252).
 */
const VIEWPORT_MENU_MODE = 'source';
const VIEWPORT_MENU_SOURCE = 'gutter';

function createMockMarkdownView(editor: Editor): MarkdownView {
  return strictProxy<MarkdownView>({ editor });
}

describe('ExtractCurrentSelectionEditorCommandHandler viewport menu placement', () => {
  it('should stay off the readable-line-length margin while the category is placed in the editor menu', () => {
    const handler = toTestable(new ExtractCurrentSelectionEditorCommandHandler(createMockParams()));
    expect(handler.shouldAddToViewportMenu(createMockMarkdownView(createMockEditor()), VIEWPORT_MENU_MODE, VIEWPORT_MENU_SOURCE)).toBe(false);
  });

  it('should appear on the readable-line-length margin once the category is placed there (issue #252)', () => {
    const params = createMockParams();
    vi.mocked(params.pluginSettingsComponent.settings.commandMenuPlacement).mockReturnValue(CommandMenuPlacement.ViewportMenu);
    const handler = toTestable(new ExtractCurrentSelectionEditorCommandHandler(params));
    expect(handler.shouldAddToViewportMenu(createMockMarkdownView(createMockEditor()), VIEWPORT_MENU_MODE, VIEWPORT_MENU_SOURCE)).toBe(true);
  });
});
