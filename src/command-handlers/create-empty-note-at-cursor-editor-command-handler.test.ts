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
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';

import { SplitComposer } from '../composers/split-composer.ts';
import { InsertMode } from '../insert-mode.ts';
import { prepareForSplitFile } from '../modals/split-file-modal.ts';
import { FrontmatterMergeStrategy } from '../plugin-settings.ts';
import { CreateEmptyNoteAtCursorEditorCommandHandler } from './create-empty-note-at-cursor-editor-command-handler.ts';

interface TestableHandler {
  canExecuteEditor(editor: Editor, context: MarkdownFileInfo): boolean;
  executeEditor(editor: Editor, context: MarkdownFileInfo): Promise<void>;
  readonly icon: string;
  readonly id: string;
  readonly name: string;
  shouldAddCommandToSubmenu(): boolean;
  shouldAddToEditorMenu(): boolean;
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
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

const CURSOR = { ch: 5, line: 3 };

function createMockContext(file: null | TFile): MarkdownFileInfo {
  return strictProxy<MarkdownFileInfo>({ file });
}

function createMockEditor(): Editor {
  return strictProxy<Editor>({
    getCursor: vi.fn().mockReturnValue(CURSOR),
    setSelection: vi.fn()
  });
}

function createMockFile(): TFile {
  return strictProxy<TFile>({ path: 'test/note.md' });
}

function createMockParams(
  isPathIgnored = false,
  shouldAddCommandsToSubmenu = true,
  shouldBlockCommandOnPath = false,
  splitTemplate = ''
): HandlerParams {
  return {
    app: strictProxy<App>({}),
    consoleDebugComponent: strictProxy<ConsoleDebugComponent>({
      consoleDebug: vi.fn()
    }),
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice: vi.fn().mockReturnValue({ hide: vi.fn() }) }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        isPathIgnored: vi.fn().mockReturnValue(isPathIgnored),
        shouldAddCommandsToSubmenu,
        shouldBlockCommandOnPath: vi.fn().mockReturnValue(shouldBlockCommandOnPath),
        splitTemplate
      })
    }),
    resourceLockComponent: strictProxy<ResourceLockComponent>({})
  };
}

function toTestable(handler: CreateEmptyNoteAtCursorEditorCommandHandler): TestableHandler {
  return castTo<TestableHandler>(handler);
}

describe('CreateEmptyNoteAtCursorEditorCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should construct with correct params', () => {
    const params = createMockParams();
    const handler = toTestable(new CreateEmptyNoteAtCursorEditorCommandHandler(params));
    expect(handler.id).toBe('create-empty-note-at-cursor');
    expect(handler.name).toBe('Create empty note at cursor...');
    expect(handler.icon).toBe('lucide-file-plus');
  });

  it('should return early when context.file is null', async () => {
    const params = createMockParams();
    const handler = toTestable(new CreateEmptyNoteAtCursorEditorCommandHandler(params));
    const editor = createMockEditor();

    await handler.executeEditor(editor, createMockContext(null));

    expect(mockPrepareForSplitFile).not.toHaveBeenCalled();
  });

  it('should show notice and return when path is ignored', async () => {
    const params = createMockParams(true);
    const handler = toTestable(new CreateEmptyNoteAtCursorEditorCommandHandler(params));
    const editor = createMockEditor();

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

    await handler.executeEditor(editor, createMockContext(createMockFile()));

    expect(params.pluginNoticeComponent.showNotice).toHaveBeenCalled();
    expect(vi.mocked(editor.setSelection)).not.toHaveBeenCalled();
    expect(mockPrepareForSplitFile).not.toHaveBeenCalled();
  });

  it('should collapse the selection to the cursor before preparing, and refuse merging', async () => {
    const params = createMockParams(false);
    const handler = toTestable(new CreateEmptyNoteAtCursorEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();

    mockPrepareForSplitFile.mockResolvedValue(null);

    await handler.executeEditor(editor, createMockContext(file));

    // The collapse is what keeps a live selection from being overwritten by the residual link.
    expect(vi.mocked(editor.setSelection)).toHaveBeenCalledWith(CURSOR);
    expect(mockPrepareForSplitFile).toHaveBeenCalledWith({
      app: params.app,
      canMergeIntoExistingNote: false,
      editor,
      pluginNoticeComponent: params.pluginNoticeComponent,
      pluginSettingsComponent: params.pluginSettingsComponent,
      resourceLockComponent: params.resourceLockComponent,
      sourceFile: file
    });
    expect(MockSplitComposer).not.toHaveBeenCalled();
  });

  it('should create SplitComposer and call splitFile on happy path', async () => {
    const params = createMockParams(false);
    const handler = toTestable(new CreateEmptyNoteAtCursorEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    const targetFile = createMockFile();

    mockPrepareForSplitFile.mockResolvedValue({
      capturedSelections: [{ endOffset: 12, startOffset: 12 }],
      frontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues,
      insertMode: InsertMode.Append,
      isNewTargetFile: true,
      selectedText: '',
      shouldAllowOnlyCurrentFolder: false,
      shouldAllowSplitIntoUnresolvedPath: true,
      shouldFixFootnotes: true,
      shouldIncludeFrontmatter: false,
      shouldMergeHeadings: false,
      targetFile
    });

    const mockSplitFile = vi.fn().mockResolvedValue(undefined);
    MockSplitComposer.prototype.splitFile = mockSplitFile;

    await handler.executeEditor(editor, createMockContext(file));

    expect(MockSplitComposer).toHaveBeenCalledWith({
      app: params.app,
      // A zero-length selection at the cursor is what makes the created note empty.
      capturedSelections: [{ endOffset: 12, startOffset: 12 }],
      consoleDebugComponent: params.consoleDebugComponent,
      editor,
      frontmatterMergeStrategy: 'MergeAndPreferNewValues',
      insertMode: 'append',
      isMultipleSplit: false,
      isNewTargetFile: true,
      pluginNoticeComponent: params.pluginNoticeComponent,
      pluginSettingsComponent: params.pluginSettingsComponent,
      resourceLockComponent: params.resourceLockComponent,
      selectedText: '',
      shouldFixFootnotes: true,
      shouldIncludeFrontmatter: false,
      shouldMergeHeadings: false,
      sourceFile: file,
      targetFile,
      // No `Split template` configured, so the identity template is named — which the composer reads as
      // "nothing to add" and leaves the created note genuinely empty (issue #244).
      templateOverride: '{{content}}'
    });
    expect(mockSplitFile).toHaveBeenCalled();
  });

  it('should name the configured split template as the created note\'s template (issue #244)', async () => {
    const params = createMockParams(false, true, false, '# {{newTitle}}\n\n{{content}}');
    const handler = toTestable(new CreateEmptyNoteAtCursorEditorCommandHandler(params));
    const targetFile = createMockFile();

    mockPrepareForSplitFile.mockResolvedValue({
      capturedSelections: [{ endOffset: 12, startOffset: 12 }],
      frontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues,
      insertMode: InsertMode.Append,
      isNewTargetFile: true,
      selectedText: '',
      shouldAllowOnlyCurrentFolder: false,
      shouldAllowSplitIntoUnresolvedPath: true,
      shouldFixFootnotes: true,
      shouldIncludeFrontmatter: false,
      shouldMergeHeadings: false,
      targetFile
    });
    MockSplitComposer.prototype.splitFile = vi.fn().mockResolvedValue(undefined);

    await handler.executeEditor(createMockEditor(), createMockContext(createMockFile()));

    const composerParams = ensureNonNullable(MockSplitComposer.mock.lastCall)[0];
    expect(composerParams.templateOverride).toBe('# {{newTitle}}\n\n{{content}}');
  });

  it('should return true from shouldAddToEditorMenu', () => {
    const handler = toTestable(new CreateEmptyNoteAtCursorEditorCommandHandler(createMockParams()));
    expect(handler.shouldAddToEditorMenu()).toBe(true);
  });

  it('should return shouldAddCommandsToSubmenu setting value', () => {
    const handler = toTestable(new CreateEmptyNoteAtCursorEditorCommandHandler(createMockParams(false, true)));
    expect(handler.shouldAddCommandToSubmenu()).toBe(true);
  });

  it('should return false from shouldAddCommandToSubmenu when setting is false', () => {
    const handler = toTestable(new CreateEmptyNoteAtCursorEditorCommandHandler(createMockParams(false, false)));
    expect(handler.shouldAddCommandToSubmenu()).toBe(false);
  });

  it('should block canExecuteEditor when the command is blocked on the path', () => {
    const handler = toTestable(new CreateEmptyNoteAtCursorEditorCommandHandler(createMockParams(false, true, true)));
    expect(handler.canExecuteEditor(createMockEditor(), createMockContext(createMockFile()))).toBe(false);
  });

  it('should allow canExecuteEditor with no selection, which is the whole point', () => {
    const handler = toTestable(new CreateEmptyNoteAtCursorEditorCommandHandler(createMockParams(false, true, false)));
    expect(handler.canExecuteEditor(createMockEditor(), createMockContext(createMockFile()))).toBe(true);
  });
});
