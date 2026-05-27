import type {
  App,
  Editor,
  MarkdownFileInfo,
  TFile
} from 'obsidian';

import { Notice } from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
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

import { SplitComposer } from '../composers/split-composer.ts';
import { prepareForSplitFile } from '../modals/split-file-modal.ts';
import { ExtractCurrentSelectionEditorCommandHandler } from './extract-current-selection-editor-command-handler.ts';

interface TestableHandler {
  canExecuteEditor(editor: Editor): boolean;
  executeEditor(editor: Editor, ctx: MarkdownFileInfo): Promise<void>;
  params: unknown;
  shouldAddCommandToSubmenu(): boolean;
  shouldAddToEditorMenu(): boolean;
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
  }
  return { EditorCommandHandler };
});

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
const MockNotice = vi.mocked(Notice);

function createMockCtx(file: null | TFile): MarkdownFileInfo {
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

function toTestable(handler: ExtractCurrentSelectionEditorCommandHandler): TestableHandler {
  return handler as never;
}

describe('ExtractCurrentSelectionEditorCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should construct with correct params', () => {
    const plugin = createMockPlugin();
    const handler = toTestable(new ExtractCurrentSelectionEditorCommandHandler(plugin));
    expect(handler.params).toStrictEqual({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-scissors',
      id: 'extract-current-selection',
      name: 'Extract current selection...'
    });
  });

  it('should return true from canExecuteEditor when something is selected', () => {
    const plugin = createMockPlugin();
    const handler = toTestable(new ExtractCurrentSelectionEditorCommandHandler(plugin));
    const editor = createMockEditor(true);
    expect(handler.canExecuteEditor(editor)).toBe(true);
  });

  it('should return false from canExecuteEditor when nothing is selected', () => {
    const plugin = createMockPlugin();
    const handler = toTestable(new ExtractCurrentSelectionEditorCommandHandler(plugin));
    const editor = createMockEditor(false);
    expect(handler.canExecuteEditor(editor)).toBe(false);
  });

  it('should return early when ctx.file is null', async () => {
    const plugin = createMockPlugin();
    const handler = toTestable(new ExtractCurrentSelectionEditorCommandHandler(plugin));
    const editor = createMockEditor();
    const ctx = createMockCtx(null);

    await handler.executeEditor(editor, ctx);

    expect(mockPrepareForSplitFile).not.toHaveBeenCalled();
  });

  it('should show notice and return when path is ignored', async () => {
    const plugin = createMockPlugin(true);
    const handler = toTestable(new ExtractCurrentSelectionEditorCommandHandler(plugin));
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

  it('should return when prepareForSplitFile returns null', async () => {
    const plugin = createMockPlugin(false);
    const handler = toTestable(new ExtractCurrentSelectionEditorCommandHandler(plugin));
    const editor = createMockEditor();
    const file = createMockFile();
    const ctx = createMockCtx(file);

    mockPrepareForSplitFile.mockResolvedValue(null);

    await handler.executeEditor(editor, ctx);

    expect(MockSplitComposer).not.toHaveBeenCalled();
  });

  it('should create SplitComposer and call splitFile on happy path', async () => {
    const plugin = createMockPlugin(false);
    const handler = toTestable(new ExtractCurrentSelectionEditorCommandHandler(plugin));
    const editor = createMockEditor();
    const file = createMockFile();
    const ctx = createMockCtx(file);
    const targetFile = createMockFile();

    const splitResult = {
      frontmatterMergeStrategy: 'MergeAndPreferNewValues',
      insertMode: 'append',
      isNewTargetFile: true,
      shouldAllowOnlyCurrentFolder: false,
      shouldAllowSplitIntoUnresolvedPath: true,
      shouldFixFootnotes: true,
      shouldIncludeFrontmatter: false,
      shouldMergeHeadings: false,
      targetFile
    };
    mockPrepareForSplitFile.mockResolvedValue(splitResult as never);

    const mockSplitFile = vi.fn().mockResolvedValue(undefined);
    MockSplitComposer.prototype.splitFile = mockSplitFile;

    await handler.executeEditor(editor, ctx);

    expect(MockSplitComposer).toHaveBeenCalledWith({
      editor,
      frontmatterMergeStrategy: 'MergeAndPreferNewValues',
      insertMode: 'append',
      isMultipleSplit: false,
      isNewTargetFile: true,
      plugin,
      shouldAllowOnlyCurrentFolder: false,
      shouldAllowSplitIntoUnresolvedPath: true,
      shouldFixFootnotes: true,
      shouldIncludeFrontmatter: false,
      shouldMergeHeadings: false,
      sourceFile: file,
      targetFile
    });
    expect(mockSplitFile).toHaveBeenCalled();
  });

  it('should return true from shouldAddToEditorMenu', () => {
    const plugin = createMockPlugin();
    const handler = toTestable(new ExtractCurrentSelectionEditorCommandHandler(plugin));
    expect(handler.shouldAddToEditorMenu()).toBe(true);
  });

  it('should return shouldAddCommandsToSubmenu setting value', () => {
    const plugin = createMockPlugin(false, true);
    const handler = toTestable(new ExtractCurrentSelectionEditorCommandHandler(plugin));
    expect(handler.shouldAddCommandToSubmenu()).toBe(true);
  });

  it('should return false from shouldAddCommandToSubmenu when setting is false', () => {
    const plugin = createMockPlugin(false, false);
    const handler = toTestable(new ExtractCurrentSelectionEditorCommandHandler(plugin));
    expect(handler.shouldAddCommandToSubmenu()).toBe(false);
  });
});
