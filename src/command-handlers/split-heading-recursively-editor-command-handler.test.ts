import type {
  App,
  Editor,
  FileManager,
  HeadingCache,
  MarkdownFileInfo,
  MarkdownView,
  MetadataCache,
  TFile,
  TFolder,
  Workspace,
  WorkspaceLeaf
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type {
  PluginNoticeComponent,
  PluginNoticeComponentShowNoticeAfterDelayParams
} from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { CachedMetadataEx } from 'obsidian-dev-utils/obsidian/metadata-cache';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
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

import type { ConfirmDialogModalResult } from '../modals/confirm-dialog-modal.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';

import {
  getEnclosingHeadingLine,
  getSelectionUnderHeading
} from '../composers/composer-base.ts';
import { SplitComposer } from '../composers/split-composer.ts';
import { InsertMode } from '../insert-mode.ts';
import { prepareForSplitFile } from '../modals/split-file-modal.ts';
import { openConfirmDialogModal } from '../open-minimizable-modal.ts';
import { SplitHeadingRecursivelyEditorCommandHandler } from './split-heading-recursively-editor-command-handler.ts';

/**
 * The subset of the confirmation dialog's constructor params this test drives.
 */
interface CapturedConfirmParams {
  buildContent(this: void, fragment: DocumentFragment): Promise<void>;
  promiseResolve(result: ConfirmDialogModalResult): void;
  readonly title: string;
}

interface MockParamsOptions {
  readonly isPathIgnored?: boolean;
  readonly shouldAskBeforeSplitting?: boolean;
  readonly shouldBlockCommandOnPath?: boolean;
}

type PrepareForSplitFileResult = NonNullable<Awaited<ReturnType<typeof prepareForSplitFile>>>;

interface SplitHeadingRecursivelyEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

interface TestableHandler {
  canExecuteEditor(editor: Editor, context: MarkdownFileInfo): boolean;
  executeEditor(editor: Editor, context: MarkdownFileInfo): Promise<void>;
  readonly icon: string;
  readonly id: string;
  readonly name: string;
  shouldAddToEditorMenu(editor: Editor, context: MarkdownFileInfo): boolean;
}

let capturedConfirmParams: CapturedConfirmParams | null = null;
let confirmResult: ConfirmDialogModalResult = createConfirmResult(false);

vi.mock('obsidian-dev-utils/html-element', () => ({
  createFragmentAsync: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/html-element', () => ({
  appendCodeBlock: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/metadata-cache', () => ({
  getCacheSafe: vi.fn()
}));

vi.mock('../composers/composer-base.ts', () => ({
  getEnclosingHeadingLine: vi.fn(),
  getSelectionUnderHeading: vi.fn()
}));

vi.mock('../apply-split-template.ts', () => ({
  applySplitTemplateToNotes: vi.fn().mockResolvedValue(undefined),
  CONTENT_ONLY_TEMPLATE: '{{content}}'
}));

vi.mock('../composers/split-composer.ts', () => {
  const MockSplitComposer = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- vi.fn() prototype is untyped in mock factories.
  MockSplitComposer.prototype.splitFile = vi.fn().mockResolvedValue(undefined);
  return {
    resolveSplitTemplateForNewTargetFile: vi.fn(),
    SplitComposer: MockSplitComposer
  };
});

vi.mock('../modals/confirm-dialog-modal.ts', () => ({
  ConfirmDialogModal: class {
    public readonly params: CapturedConfirmParams;

    public constructor(params: CapturedConfirmParams) {
      this.params = params;
      capturedConfirmParams = params;
    }
  }
}));

vi.mock('../modals/split-file-modal.ts', () => ({
  prepareForSplitFile: vi.fn()
}));

vi.mock('../modals/select-folder-modal.ts', () => ({
  selectFolder: vi.fn()
}));

vi.mock('../open-minimizable-modal.ts', () => ({
  openConfirmDialogModal: vi.fn(() => {
    capturedConfirmParams?.promiseResolve(confirmResult);
  })
}));

const mockCreateFragmentAsync = vi.mocked(createFragmentAsync);
const mockGetCacheSafe = vi.mocked(getCacheSafe);
const mockGetEnclosingHeadingLine = vi.mocked(getEnclosingHeadingLine);
const mockGetSelectionUnderHeading = vi.mocked(getSelectionUnderHeading);
const mockOpenConfirmDialogModal = vi.mocked(openConfirmDialogModal);
const mockPrepareForSplitFile = vi.mocked(prepareForSplitFile);
const mockRenderInternalLink = vi.mocked(renderInternalLink);
const MockSplitComposer = vi.mocked(SplitComposer);

function createCache(headings: HeadingCache[]): CachedMetadataEx {
  return strictProxy<CachedMetadataEx>({ headings });
}

function createConfirmResult(isConfirmed: boolean, shouldAskAgain = true): ConfirmDialogModalResult {
  return {
    insertMode: InsertMode.Append,
    isConfirmed,
    shouldAskAgain,
    shouldReselectTarget: false,
    shouldSwitchToSmartCut: false
  };
}

function createHeading(level: number, line: number, headingText = `Heading ${String(line)}`): HeadingCache {
  return strictProxy<HeadingCache>({
    heading: headingText,
    level,
    position: {
      end: { col: 10, line, offset: 0 },
      start: { col: 0, line, offset: 0 }
    }
  });
}

function createMockContext(file: null | TFile): MarkdownFileInfo {
  return strictProxy<MarkdownFileInfo>({ file });
}

function createMockEditor(isSomethingSelected = false, cursorLine = 4): Editor {
  return strictProxy<Editor>({
    getCursor: vi.fn().mockReturnValue({ ch: 0, line: cursorLine }),
    getValue: vi.fn().mockReturnValue('## A\n\n## B\n\n### B1\n\n## C\n'),
    setSelection: vi.fn(),
    somethingSelected: vi.fn().mockReturnValue(isSomethingSelected)
  });
}

function createMockFile(path = 'test/note.md'): TFile {
  return strictProxy<TFile>({
    parent: strictProxy<TFolder>({
      name: 'test',
      path: 'test'
    }),
    path
  });
}

function createMockLeaf(): WorkspaceLeaf {
  return strictProxy<WorkspaceLeaf>({
    openFile: vi.fn().mockResolvedValue(undefined)
  });
}

function createMockParams(options?: MockParamsOptions): SplitHeadingRecursivelyEditorCommandHandlerConstructorParams {
  return {
    app: strictProxy<App>({
      fileManager: strictProxy<FileManager>({
        getNewFileParent: vi.fn().mockReturnValue(strictProxy<TFolder>({ name: 'Inbox', path: 'Inbox' }))
      }),
      metadataCache: strictProxy<MetadataCache>({
        getFileCache: vi.fn()
      }),
      workspace: strictProxy<Workspace>({
        getActiveViewOfType: vi.fn(),
        getLeaf: vi.fn().mockReturnValue(createMockLeaf())
      })
    }),
    consoleDebugComponent: strictProxy<ConsoleDebugComponent>({}),
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({
      showNotice: vi.fn().mockReturnValue({ hide: vi.fn() }),
      showNoticeAfterDelay: createShowNoticeAfterDelayStub()
    }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      editAndSave: vi.fn().mockResolvedValue(undefined),
      settings: strictProxy<PluginSettings>({
        isPathIgnored: vi.fn().mockReturnValue(options?.isPathIgnored ?? false),
        reorderedFolderNameTemplate: '{{index}}. {{safeFolderName}}',
        shouldAddCommandsToSubmenu: true,
        shouldAskBeforeSplitting: options?.shouldAskBeforeSplitting ?? false,
        shouldBlockCommandOnPath: vi.fn().mockReturnValue(options?.shouldBlockCommandOnPath ?? false),
        shouldBlockVaultDuringOperations: false,
        shouldShowOperationNotices: true,
        shouldSplitRecursivelyIntoDefaultNewNoteFolder: false
      })
    }),
    resourceLockComponent: strictProxy<ResourceLockComponent>({})
  };
}

/**
 * The note the scoped split is driven against: two H2 siblings around the target, one of which has a
 * sub-heading. `B` (line 4) is the target, so `A` and `C` are what must be left alone.
 *
 * @returns The headings, in document order.
 */
function createSiblingHeadings(): HeadingCache[] {
  return [
    createHeading(2, 0, 'A'),
    createHeading(2, 4, 'B'),
    createHeading(3, 8, 'B1'),
    createHeading(2, 12, 'C')
  ];
}

function createSplitResult(targetFile: TFile): PrepareForSplitFileResult {
  return strictProxy<PrepareForSplitFileResult>({
    capturedSelections: [],
    isNewTargetFile: true,
    selectedText: '',
    targetFile
  });
}

function getShownNoticeText(pluginNoticeComponent: PluginNoticeComponent): string {
  const [content] = vi.mocked(pluginNoticeComponent.showNotice).mock.lastCall ?? [];
  return castTo<DocumentFragment>(content).textContent;
}

function scriptCaches(...caches: CachedMetadataEx[]): void {
  let index = 0;
  mockGetCacheSafe.mockImplementation(() => Promise.resolve(caches[index++] ?? createCache([])));
}

function setActiveEditor(app: App, editor: Editor | null): void {
  vi.mocked(app.workspace.getActiveViewOfType).mockReturnValue(editor === null ? null : strictProxy<MarkdownView>({ editor }));
}

function toTestable(handler: SplitHeadingRecursivelyEditorCommandHandler): TestableHandler {
  return castTo<TestableHandler>(handler);
}

function useRealFragments(): void {
  mockCreateFragmentAsync.mockImplementation(async (callback) => {
    const fragment = createFragment();
    await (callback as (f: DocumentFragment) => Promise<void>)(fragment);
    return fragment;
  });
  mockRenderInternalLink.mockImplementation((linkParams) => {
    const path = typeof linkParams.pathOrAbstractFile === 'string' ? linkParams.pathOrAbstractFile : linkParams.pathOrAbstractFile.path;
    return Promise.resolve(createEl('a', { text: `[${path}]` }));
  });
}

describe('SplitHeadingRecursivelyEditorCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRealFragments();
    capturedConfirmParams = null;
    confirmResult = createConfirmResult(false);
    MockSplitComposer.prototype.splitFile = vi.fn().mockResolvedValue(undefined);
    mockGetEnclosingHeadingLine.mockReturnValue(4);
    mockGetSelectionUnderHeading.mockReturnValue({
      end: { ch: 0, line: 11 },
      heading: 'B',
      start: { ch: 0, line: 4 }
    });
  });

  it('should construct with the scoped command identity', () => {
    const handler = toTestable(new SplitHeadingRecursivelyEditorCommandHandler(createMockParams()));
    expect(handler.id).toBe('split-heading-recursively');
    expect(handler.name).toBe('Split heading recursively...');
    expect(handler.icon).toBe('lucide-folder-tree');
  });

  it('should return false from canExecuteEditor when the command is blocked on the path', () => {
    const handler = toTestable(new SplitHeadingRecursivelyEditorCommandHandler(createMockParams({ shouldBlockCommandOnPath: true })));
    expect(handler.canExecuteEditor(createMockEditor(), createMockContext(createMockFile()))).toBe(false);
  });

  it('should return false from canExecuteEditor when file is null', () => {
    const handler = toTestable(new SplitHeadingRecursivelyEditorCommandHandler(createMockParams()));
    expect(handler.canExecuteEditor(createMockEditor(), createMockContext(null))).toBe(false);
  });

  it('should return false from canExecuteEditor when the cursor is before the first heading', () => {
    const handler = toTestable(new SplitHeadingRecursivelyEditorCommandHandler(createMockParams()));
    mockGetEnclosingHeadingLine.mockReturnValue(null);
    expect(handler.canExecuteEditor(createMockEditor(), createMockContext(createMockFile()))).toBe(false);
  });

  it('should return false from canExecuteEditor when the heading owns no resolvable range', () => {
    const handler = toTestable(new SplitHeadingRecursivelyEditorCommandHandler(createMockParams()));
    mockGetSelectionUnderHeading.mockReturnValue(null);
    expect(handler.canExecuteEditor(createMockEditor(), createMockContext(createMockFile()))).toBe(false);
  });

  it('should return true from canExecuteEditor from anywhere inside the heading section (issue #143)', () => {
    const handler = toTestable(new SplitHeadingRecursivelyEditorCommandHandler(createMockParams()));
    // The cursor is in the BODY of the heading, not on the `#` line — the enclosing heading is what counts.
    expect(handler.canExecuteEditor(createMockEditor(false, 6), createMockContext(createMockFile()))).toBe(true);
  });

  it('should still return true from canExecuteEditor when something is selected, so the palette command stays available (issue #188)', () => {
    const handler = toTestable(new SplitHeadingRecursivelyEditorCommandHandler(createMockParams()));
    expect(handler.canExecuteEditor(createMockEditor(true), createMockContext(createMockFile()))).toBe(true);
  });

  it('should return true from shouldAddToEditorMenu when nothing is selected', () => {
    const handler = toTestable(new SplitHeadingRecursivelyEditorCommandHandler(createMockParams()));
    expect(handler.shouldAddToEditorMenu(createMockEditor(), createMockContext(createMockFile()))).toBe(true);
  });

  it('should return false from shouldAddToEditorMenu when something is selected (issue #188)', () => {
    const handler = toTestable(new SplitHeadingRecursivelyEditorCommandHandler(createMockParams()));
    expect(handler.shouldAddToEditorMenu(createMockEditor(true), createMockContext(createMockFile()))).toBe(false);
  });

  it('should do nothing when the cursor is before the first heading', async () => {
    const handler = toTestable(new SplitHeadingRecursivelyEditorCommandHandler(createMockParams()));
    mockGetCacheSafe.mockResolvedValue(createCache(createSiblingHeadings()));
    mockGetEnclosingHeadingLine.mockReturnValue(null);

    await handler.executeEditor(createMockEditor(), createMockContext(createMockFile()));

    expect(MockSplitComposer).not.toHaveBeenCalled();
  });

  it('should do nothing when no heading starts on the resolved line', async () => {
    // The cache moved on between the gate and the run — there is no subtree to split.
    const handler = toTestable(new SplitHeadingRecursivelyEditorCommandHandler(createMockParams()));
    mockGetCacheSafe.mockResolvedValue(createCache([createHeading(2, 0, 'A')]));

    await handler.executeEditor(createMockEditor(), createMockContext(createMockFile()));

    expect(MockSplitComposer).not.toHaveBeenCalled();
  });

  it('should do nothing when the note was indexed without any headings', async () => {
    // A cache entry with no `headings` key at all, which is distinct from one holding an empty list.
    const handler = toTestable(new SplitHeadingRecursivelyEditorCommandHandler(createMockParams()));
    mockGetCacheSafe.mockResolvedValue(castTo<CachedMetadataEx>({}));

    await handler.executeEditor(createMockEditor(), createMockContext(createMockFile()));

    expect(MockSplitComposer).not.toHaveBeenCalled();
  });

  it('should stop when the heading disappears between the confirmation and the split', async () => {
    const params = createMockParams();
    const handler = toTestable(new SplitHeadingRecursivelyEditorCommandHandler(params));

    // The run is resolved against a note that still has `B`; by the time the root pass reads the cache
    // Again, it is gone — so there is nothing to extract and nothing is created.
    scriptCaches(createCache(createSiblingHeadings()), createCache([createHeading(2, 0, 'A')]));
    setActiveEditor(params.app, createMockEditor());

    await handler.executeEditor(createMockEditor(), createMockContext(createMockFile()));

    expect(MockSplitComposer).not.toHaveBeenCalled();
    expect(mockPrepareForSplitFile).not.toHaveBeenCalled();
  });

  it('should split only the cursor heading, leaving its siblings alone (issue #228)', async () => {
    const params = createMockParams();
    const handler = toTestable(new SplitHeadingRecursivelyEditorCommandHandler(params));
    const file = createMockFile();
    const childFile = createMockFile('test/B/B.md');
    const grandChildFile = createMockFile('test/B/B1/B1.md');

    scriptCaches(
      createCache(createSiblingHeadings()),
      createCache(createSiblingHeadings()),
      // What the produced `B.md` holds: its own heading plus the sub-heading that moved with it.
      createCache([createHeading(2, 0, 'B'), createHeading(3, 2, 'B1')]),
      createCache([])
    );
    mockPrepareForSplitFile
      .mockResolvedValueOnce(createSplitResult(childFile))
      .mockResolvedValueOnce(createSplitResult(grandChildFile));
    setActiveEditor(params.app, createMockEditor());

    await handler.executeEditor(createMockEditor(), createMockContext(file));

    // Two splits: the chosen heading, then its own sub-heading. `A` and `C` are never touched — a
    // Whole-note recursive split of the same note would have produced four notes.
    expect(MockSplitComposer).toHaveBeenCalledTimes(2);
    expect(MockSplitComposer.mock.calls[0]?.[0].sourceFile).toBe(file);
    expect(MockSplitComposer.mock.calls[1]?.[0].sourceFile).toBe(childFile);
    // The notice names the ROOT note only (issue #235): the grandchild is counted, and reached from inside
    // The note it was split out of.
    expect(getShownNoticeText(params.pluginNoticeComponent)).toBe('Split heading in [test/note.md] into 2 note(s): [test/B/B.md].');
  });

  it('should extract the chosen heading rather than the first one in the note', async () => {
    const params = createMockParams();
    const handler = toTestable(new SplitHeadingRecursivelyEditorCommandHandler(params));

    scriptCaches(createCache(createSiblingHeadings()), createCache(createSiblingHeadings()), createCache([]));
    mockPrepareForSplitFile.mockResolvedValue(createSplitResult(createMockFile('test/B/B.md')));
    setActiveEditor(params.app, createMockEditor());

    await handler.executeEditor(createMockEditor(), createMockContext(createMockFile()));

    // `A` sits at the same (shallowest) level and comes first in document order, so a whole-note run would
    // Have taken it — the cursor's line is what selects `B` instead.
    expect(mockGetSelectionUnderHeading.mock.calls[0]?.[0].lineNumber).toBe(4);
  });

  it('should split a leaf heading into a single note', async () => {
    const params = createMockParams();
    const handler = toTestable(new SplitHeadingRecursivelyEditorCommandHandler(params));
    mockGetEnclosingHeadingLine.mockReturnValue(12);
    mockGetSelectionUnderHeading.mockReturnValue({
      end: { ch: 0, line: 15 },
      heading: 'C',
      start: { ch: 0, line: 12 }
    });

    scriptCaches(createCache(createSiblingHeadings()), createCache(createSiblingHeadings()), createCache([]));
    mockPrepareForSplitFile.mockResolvedValue(createSplitResult(createMockFile('test/C/C.md')));
    setActiveEditor(params.app, createMockEditor());

    await handler.executeEditor(createMockEditor(), createMockContext(createMockFile()));

    expect(MockSplitComposer).toHaveBeenCalledTimes(1);
    expect(getShownNoticeText(params.pluginNoticeComponent)).toBe('Split heading in [test/note.md] into 1 note(s): [test/C/C.md].');
  });

  it('should not split when the up-front confirmation is cancelled', async () => {
    const params = createMockParams({ shouldAskBeforeSplitting: true });
    const handler = toTestable(new SplitHeadingRecursivelyEditorCommandHandler(params));
    mockGetCacheSafe.mockResolvedValue(createCache(createSiblingHeadings()));

    await handler.executeEditor(createMockEditor(), createMockContext(createMockFile()));

    expect(mockOpenConfirmDialogModal).toHaveBeenCalledTimes(1);
    expect(MockSplitComposer).not.toHaveBeenCalled();
  });

  it('should name the heading and list only its subtree in the confirmation body', async () => {
    const params = createMockParams({ shouldAskBeforeSplitting: true });
    const handler = toTestable(new SplitHeadingRecursivelyEditorCommandHandler(params));
    mockGetCacheSafe.mockResolvedValue(createCache(createSiblingHeadings()));
    mockRenderInternalLink.mockResolvedValue(createEl('a'));

    await handler.executeEditor(createMockEditor(), createMockContext(createMockFile()));

    expect(capturedConfirmParams?.title).toBe('Split heading recursively');

    const fragment = createFragment();
    await capturedConfirmParams?.buildContent(fragment);

    const { appendCodeBlock } = await import('obsidian-dev-utils/obsidian/html-element');
    const renderedCodeBlocks = vi.mocked(appendCodeBlock).mock.calls.map((call) => call[1]);
    // The heading is named, and the promise the dialog makes is exactly its own subtree: `B` and `B1`, at
    // The depths they will nest at — never the untouched `A` or `C`.
    expect(renderedCodeBlocks).toContain('B');
    expect(renderedCodeBlocks).toContain('    B1');
    expect(renderedCodeBlocks).toContain('2');
    expect(renderedCodeBlocks).not.toContain('A');
    expect(renderedCodeBlocks).not.toContain('C');
  });
});

/**
 * Builds a `showNoticeAfterDelay` stub that invokes the lazy content builder, so the progress-notice
 * content is exercised — the real component only runs it once the delay elapses. Fire-and-forget: its
 * result is not under test.
 *
 * @returns The stub.
 */
function createShowNoticeAfterDelayStub(): PluginNoticeComponent['showNoticeAfterDelay'] {
  return vi.fn().mockImplementation((delayedNoticeParams: PluginNoticeComponentShowNoticeAfterDelayParams) => {
    invokeAsyncSafely(async () => {
      await castTo<() => Promise<unknown>>(delayedNoticeParams.content)();
    });
    return { setContent: vi.fn(), [Symbol.dispose]: vi.fn() };
  });
}
