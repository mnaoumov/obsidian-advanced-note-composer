import type { ConsoleDebugComponent } from '@mnaoumov/obsidian-lib/components/console-debug-component';
import type {
  PluginNoticeComponent,
  PluginNoticeComponentShowNoticeAfterDelayParams
} from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type { CachedMetadataEx } from '@mnaoumov/obsidian-lib/metadata-cache';
import type { ResourceLockComponent } from '@mnaoumov/obsidian-lib/resource-lock';
import type {
  App,
  CachedMetadata,
  Editor,
  MarkdownFileInfo,
  MarkdownView,
  MetadataCache,
  SectionCache,
  TFile
} from 'obsidian';

import { renderInternalLink } from '@mnaoumov/obsidian-lib/markdown';
import { getCacheSafe } from '@mnaoumov/obsidian-lib/metadata-cache';
import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';
import { createFragmentAsync } from '@mnaoumov/typescript-lib/html-element';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../../settings/plugin-settings-component.ts';
import type { PluginSettings } from '../../settings/plugin-settings.ts';

import { CommandMenuPlacement } from '../../settings/plugin-settings.ts';
import { prepareForSplitFile } from '../picker/split-file-modal.ts';
import { SplitComposer } from '../split-composer.ts';
import { SplitNoteByHorizontalRulesEditorCommandHandler } from './split-note-by-horizontal-rules-editor-command-handler.ts';

interface TestableHandler {
  readonly canExecuteEditor: (editor: Editor, context: MarkdownFileInfo) => boolean;
  readonly executeEditor: (editor: Editor, context: MarkdownFileInfo) => Promise<void>;
  readonly id: string;
  readonly name: string;
  readonly shouldAddCommandToSubmenu: () => boolean;
  readonly shouldAddToEditorMenu: (editor: Editor, context: MarkdownFileInfo) => boolean;
  readonly shouldAddToViewportMenu: (view: MarkdownView, mode: string, source: string) => boolean;
}

vi.mock('@mnaoumov/typescript-lib/html-element', () => ({
  createFragmentAsync: vi.fn()
}));

vi.mock('@mnaoumov/obsidian-lib/markdown', () => ({
  renderInternalLink: vi.fn()
}));

vi.mock('@mnaoumov/obsidian-lib/metadata-cache', () => ({
  getCacheSafe: vi.fn()
}));

vi.mock('../split-composer.ts', () => {
  const MockSplitComposer = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- vi.fn() prototype is untyped in mock factories.
  MockSplitComposer.prototype.splitFile = vi.fn().mockResolvedValue(undefined);
  return { SplitComposer: MockSplitComposer };
});

vi.mock('../picker/split-file-modal.ts', () => ({
  prepareForSplitFile: vi.fn()
}));

const mockCreateFragmentAsync = vi.mocked(createFragmentAsync);
const mockRenderInternalLink = vi.mocked(renderInternalLink);
const mockPrepareForSplitFile = vi.mocked(prepareForSplitFile);
const MockSplitComposer = vi.mocked(SplitComposer);
const mockGetCacheSafe = vi.mocked(getCacheSafe);

const LINES = ['# Alpha', 'a', '---', 'beta line', '---', ''];
const CACHE: CachedMetadata = {
  headings: [{ heading: 'Alpha', level: 1, position: { end: { col: 7, line: 0, offset: 7 }, start: { col: 0, line: 0, offset: 0 } } }],
  sections: [rule(2), rule(4)]
};

function createMockEditor(lines: string[] = LINES): Editor {
  return strictProxy<Editor>({
    getLine: vi.fn((n: number) => lines[n] ?? ''),
    lineCount: vi.fn(() => lines.length),
    setSelection: vi.fn()
  });
}

function createMockFile(path = 'test/note.md'): TFile {
  return strictProxy<TFile>({ basename: 'note', path });
}

function createMockParams(shouldAddCommandsToSubmenu = true, shouldBlockCommandOnPath = false): ConstructorParameters<typeof SplitNoteByHorizontalRulesEditorCommandHandler>[0] {
  return {
    app: strictProxy<App>({
      metadataCache: strictProxy<MetadataCache>({
        getFileCache: vi.fn()
      })
    }),
    consoleDebugComponent: strictProxy<ConsoleDebugComponent>({}),
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({
      showNotice: vi.fn().mockReturnValue({ hide: vi.fn() }),
      showNoticeAfterDelay: createShowNoticeAfterDelayStub()
    }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        commandMenuPlacement: vi.fn().mockReturnValue(CommandMenuPlacement.EditorMenu),
        shouldAddCommandsToSubmenu,
        shouldBlockCommandOnPath: vi.fn().mockReturnValue(shouldBlockCommandOnPath),
        shouldBlockVaultDuringOperations: false,
        shouldShowOperationNotices: true
      })
    }),
    resourceLockComponent: strictProxy<ResourceLockComponent>({})
  };
}

function createShowNoticeAfterDelayStub(): PluginNoticeComponent['showNoticeAfterDelay'] {
  return vi.fn().mockImplementation((delayedNoticeParams: PluginNoticeComponentShowNoticeAfterDelayParams) => {
    invokeAsyncSafely(async () => {
      await castTo<() => Promise<unknown>>(delayedNoticeParams.content)();
    });
    return { setContent: vi.fn(), [Symbol.dispose]: vi.fn() };
  });
}

function getShownNoticeText(pluginNoticeComponent: PluginNoticeComponent): string {
  const [content] = vi.mocked(pluginNoticeComponent.showNotice).mock.lastCall ?? [];
  return typeof content === 'string' ? content : castTo<DocumentFragment>(content).textContent;
}

function rule(line: number): SectionCache {
  return {
    position: { end: { col: 3, line, offset: 0 }, start: { col: 0, line, offset: 0 } },
    type: 'thematicBreak'
  };
}

function toTestable(handler: SplitNoteByHorizontalRulesEditorCommandHandler): TestableHandler {
  return castTo<TestableHandler>(handler);
}

describe('SplitNoteByHorizontalRulesEditorCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateFragmentAsync.mockImplementation(async (callback) => {
      const fragment = createFragment();
      await (callback as (f: DocumentFragment) => Promise<void>)(fragment);
      return fragment;
    });
    mockRenderInternalLink.mockImplementation((linkParams) => {
      const path = typeof linkParams.pathOrAbstractFile === 'string' ? linkParams.pathOrAbstractFile : linkParams.pathOrAbstractFile.path;
      return Promise.resolve(createEl('a', { text: `[${path}]` }));
    });
  });

  it('should construct with its id and name', () => {
    const handler = toTestable(new SplitNoteByHorizontalRulesEditorCommandHandler(createMockParams()));
    expect(handler.id).toBe('split-note-by-horizontal-rules');
    expect(handler.name).toBe('Split note by horizontal rules');
  });

  it('should be offered only on a note with content between horizontal rules', () => {
    const params = createMockParams();
    const handler = toTestable(new SplitNoteByHorizontalRulesEditorCommandHandler(params));
    const editor = createMockEditor();
    const context = strictProxy<MarkdownFileInfo>({ file: createMockFile() });

    expect(handler.canExecuteEditor(editor, strictProxy<MarkdownFileInfo>({ file: null }))).toBe(false);

    vi.mocked(params.app.metadataCache.getFileCache).mockReturnValue(null);
    expect(handler.canExecuteEditor(editor, context)).toBe(false);

    vi.mocked(params.app.metadataCache.getFileCache).mockReturnValue({});
    expect(handler.canExecuteEditor(editor, context)).toBe(false);

    vi.mocked(params.app.metadataCache.getFileCache).mockReturnValue(CACHE);
    expect(handler.canExecuteEditor(editor, context)).toBe(true);
  });

  it('should not be offered where the command is blocked', () => {
    const params = createMockParams(true, true);
    const handler = toTestable(new SplitNoteByHorizontalRulesEditorCommandHandler(params));
    vi.mocked(params.app.metadataCache.getFileCache).mockReturnValue(CACHE);
    expect(handler.canExecuteEditor(createMockEditor(), strictProxy<MarkdownFileInfo>({ file: createMockFile() }))).toBe(false);
  });

  it('should do nothing without a file or a cache', async () => {
    const params = createMockParams();
    const handler = toTestable(new SplitNoteByHorizontalRulesEditorCommandHandler(params));

    await handler.executeEditor(createMockEditor(), strictProxy<MarkdownFileInfo>({ file: null }));
    expect(mockGetCacheSafe).not.toHaveBeenCalled();

    mockGetCacheSafe.mockResolvedValue(null);
    await handler.executeEditor(createMockEditor(), strictProxy<MarkdownFileInfo>({ file: createMockFile() }));
    expect(MockSplitComposer).not.toHaveBeenCalled();
  });

  it('should refuse a note with no horizontal rule', async () => {
    const params = createMockParams();
    const handler = toTestable(new SplitNoteByHorizontalRulesEditorCommandHandler(params));
    mockGetCacheSafe.mockResolvedValue(castTo<CachedMetadataEx>({}));

    await handler.executeEditor(createMockEditor(), strictProxy<MarkdownFileInfo>({ file: createMockFile() }));

    expect(MockSplitComposer).not.toHaveBeenCalled();
    expect(getShownNoticeText(params.pluginNoticeComponent)).toBe('The note has no content between horizontal rules');
  });

  it('should split every block from the last one up, naming each and reporting them in note order', async () => {
    type PrepareForSplitFileResult = NonNullable<Awaited<ReturnType<typeof prepareForSplitFile>>>;
    const params = createMockParams();
    const handler = toTestable(new SplitNoteByHorizontalRulesEditorCommandHandler(params));
    const editor = createMockEditor();
    const file = createMockFile();
    mockGetCacheSafe.mockResolvedValue(castTo<CachedMetadataEx>(CACHE));
    const alphaFile = createMockFile('Alpha.md');
    const betaFile = createMockFile('beta line.md');
    mockPrepareForSplitFile.mockImplementation((splitParams) =>
      Promise.resolve(strictProxy<PrepareForSplitFileResult>({
        capturedSelections: [],
        isNewTargetFile: true,
        selectedText: '',
        targetFile: splitParams.heading === 'Alpha' ? alphaFile : betaFile
      }))
    );

    await handler.executeEditor(editor, strictProxy<MarkdownFileInfo>({ file }));

    expect(vi.mocked(editor.setSelection).mock.calls).toEqual([
      [{ ch: 0, line: 3 }, { ch: 9, line: 3 }],
      [{ ch: 0, line: 0 }, { ch: 1, line: 1 }]
    ]);
    expect(mockPrepareForSplitFile.mock.calls.map(([splitParams]) => [splitParams.heading, splitParams.shouldSkipModal])).toEqual([
      ['beta line', true],
      ['Alpha', true]
    ]);
    expect(MockSplitComposer).toHaveBeenCalledTimes(2);
    expect(MockSplitComposer).toHaveBeenLastCalledWith(expect.objectContaining({ heading: 'Alpha', isMultipleSplit: true, sourceFile: file }));
    expect(getShownNoticeText(params.pluginNoticeComponent)).toBe('Split note [test/note.md] into 2 note(s): [Alpha.md], [beta line.md].');
    const noticeParams = vi.mocked(params.pluginNoticeComponent.showNoticeAfterDelay).mock.calls[0]?.[0];
    expect(noticeParams?.abortController).toBeUndefined();
  });

  it('should name a block with no text after the note and its position', async () => {
    const params = createMockParams();
    const handler = toTestable(new SplitNoteByHorizontalRulesEditorCommandHandler(params));
    mockGetCacheSafe.mockResolvedValue(castTo<CachedMetadataEx>({ sections: [rule(1)] }));
    mockPrepareForSplitFile.mockResolvedValue(null);

    await handler.executeEditor(createMockEditor(['**', '---', 'x']), strictProxy<MarkdownFileInfo>({ file: createMockFile() }));

    expect(mockPrepareForSplitFile).toHaveBeenCalledTimes(1);
    expect(mockPrepareForSplitFile).toHaveBeenCalledWith(expect.objectContaining({ heading: 'x' }));
    expect(MockSplitComposer).not.toHaveBeenCalled();

    mockPrepareForSplitFile.mockClear();
    mockPrepareForSplitFile.mockResolvedValue(null);
    await handler.executeEditor(createMockEditor(['x', '---', '**']), strictProxy<MarkdownFileInfo>({ file: createMockFile() }));
    expect(mockPrepareForSplitFile).toHaveBeenCalledWith(expect.objectContaining({ heading: 'note 2' }));
  });

  it('should follow the submenu and menu placement settings', () => {
    const handler = toTestable(new SplitNoteByHorizontalRulesEditorCommandHandler(createMockParams(true)));
    expect(handler.shouldAddCommandToSubmenu()).toBe(true);
    expect(toTestable(new SplitNoteByHorizontalRulesEditorCommandHandler(createMockParams(false))).shouldAddCommandToSubmenu()).toBe(false);
    expect(handler.shouldAddToEditorMenu(createMockEditor(), strictProxy<MarkdownFileInfo>({ file: createMockFile() }))).toBe(true);
    expect(handler.shouldAddToViewportMenu(strictProxy<MarkdownView>({}), 'source', 'gutter')).toBe(false);
  });
});
