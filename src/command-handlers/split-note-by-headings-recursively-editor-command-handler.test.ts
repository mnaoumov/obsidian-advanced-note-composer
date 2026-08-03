import type {
  App,
  Editor,
  HeadingCache,
  MarkdownFileInfo,
  MarkdownView,
  MetadataCache,
  TFile,
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

import { applySplitTemplateToNotes } from '../apply-split-template.ts';
import { getSelectionUnderHeading } from '../composers/composer-base.ts';
import {
  resolveSplitTemplateForNewTargetFile,
  SplitComposer
} from '../composers/split-composer.ts';
import { InsertMode } from '../insert-mode.ts';
import { prepareForSplitFile } from '../modals/split-file-modal.ts';
import { openModal } from '../open-minimizable-modal.ts';
import { SplitNoteByHeadingsRecursivelyEditorCommandHandler } from './split-note-by-headings-recursively-editor-command-handler.ts';

/**
 * The subset of the confirmation dialog's constructor params this test drives.
 */
interface CapturedConfirmParams {
  buildContent(this: void, fragment: DocumentFragment): Promise<void>;
  promiseResolve(result: ConfirmDialogModalResult): void;
}

interface MockParamsOptions {
  readonly isPathIgnored?: boolean;
  readonly shouldAddCommandsToSubmenu?: boolean;
  readonly shouldAskBeforeSplitting?: boolean;
  readonly shouldBlockCommandOnPath?: boolean;
  readonly shouldSplitRecursivelyIntoDefaultNewNoteFolder?: boolean;
}

type PrepareForSplitFileResult = NonNullable<Awaited<ReturnType<typeof prepareForSplitFile>>>;

interface SplitNoteByHeadingsRecursivelyEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

interface TestableHandler {
  canExecuteEditor(editor: Editor, ctx: MarkdownFileInfo): boolean;
  executeEditor(editor: Editor, ctx: MarkdownFileInfo): Promise<void>;
  readonly icon: string;
  readonly id: string;
  readonly name: string;
  shouldAddCommandToSubmenu(): boolean;
  shouldAddToEditorMenu(editor: Editor, ctx: MarkdownFileInfo): boolean;
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

vi.mock('../open-minimizable-modal.ts', () => ({
  openModal: vi.fn(() => {
    capturedConfirmParams?.promiseResolve(confirmResult);
  })
}));

/**
 * What the (mocked) settings resolution hands the deferred template pass, so the wiring can be asserted
 * without depending on the real fallback chain (covered by `split-composer.test.ts`).
 */
const RESOLVED_TEMPLATE = '# {{newTitle}}\n\n{{content}}\n\nFrom: {{fromTitle}}';

const mockApplySplitTemplateToNotes = vi.mocked(applySplitTemplateToNotes);
const mockCreateFragmentAsync = vi.mocked(createFragmentAsync);
const mockGetCacheSafe = vi.mocked(getCacheSafe);
const mockResolveSplitTemplateForNewTargetFile = vi.mocked(resolveSplitTemplateForNewTargetFile);
const mockGetSelectionUnderHeading = vi.mocked(getSelectionUnderHeading);
const mockOpenModal = vi.mocked(openModal);
const mockPrepareForSplitFile = vi.mocked(prepareForSplitFile);
const mockRenderInternalLink = vi.mocked(renderInternalLink);
const MockSplitComposer = vi.mocked(SplitComposer);

function createCache(headings: HeadingCache[]): CachedMetadataEx {
  return strictProxy<CachedMetadataEx>({ headings });
}

/**
 * A cache entry for a note Obsidian indexed without recording any heading at all — distinct from one with
 * an empty heading list.
 *
 * @returns The cache entry.
 */
function createCacheWithoutHeadings(): CachedMetadataEx {
  return castTo<CachedMetadataEx>({});
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

function createMockCtx(file: null | TFile): MarkdownFileInfo {
  return strictProxy<MarkdownFileInfo>({ file });
}

function createMockEditor(): Editor {
  return strictProxy<Editor>({
    getValue: vi.fn().mockReturnValue('# Heading 0\n'),
    setSelection: vi.fn()
  });
}

function createMockFile(path = 'test/note.md'): TFile {
  return strictProxy<TFile>({ path });
}

function createMockParams(options?: MockParamsOptions): SplitNoteByHeadingsRecursivelyEditorCommandHandlerConstructorParams {
  return {
    app: strictProxy<App>({
      metadataCache: strictProxy<MetadataCache>({
        getFileCache: vi.fn()
      }),
      workspace: strictProxy<Workspace>({
        getActiveViewOfType: vi.fn(),
        getLeaf: vi.fn().mockReturnValue(strictProxy<WorkspaceLeaf>({
          openFile: vi.fn().mockResolvedValue(undefined)
        }))
      })
    }),
    consoleDebugComponent: strictProxy<ConsoleDebugComponent>({}),
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice: vi.fn().mockReturnValue({ hide: vi.fn() }), showNoticeAfterDelay: createShowNoticeAfterDelayStub() }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      editAndSave: vi.fn().mockResolvedValue(undefined),
      settings: strictProxy<PluginSettings>({
        isPathIgnored: vi.fn().mockReturnValue(options?.isPathIgnored ?? false),
        shouldAddCommandsToSubmenu: options?.shouldAddCommandsToSubmenu ?? true,
        shouldAskBeforeSplitting: options?.shouldAskBeforeSplitting ?? false,
        shouldBlockCommandOnPath: vi.fn().mockReturnValue(options?.shouldBlockCommandOnPath ?? false),
        shouldShowOperationNotices: true,
        shouldSplitRecursivelyIntoDefaultNewNoteFolder: options?.shouldSplitRecursivelyIntoDefaultNewNoteFolder ?? false
      })
    }),
    resourceLockComponent: strictProxy<ResourceLockComponent>({})
  };
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

/**
 * Scripts consecutive `getCacheSafe` reads. The command reads the cache once up front (to decide whether
 * there is anything to split at all) and then once per pass of the recursion, so the script starts with the
 * note's initial state and continues with what each pass leaves behind. Reads past the end see no headings.
 *
 * @param caches - The caches to return, in read order.
 */
function scriptCaches(...caches: CachedMetadataEx[]): void {
  let index = 0;
  mockGetCacheSafe.mockImplementation(() => Promise.resolve(caches[index++] ?? createCache([])));
}

/**
 * Points the mocked editor-opening path at a markdown view, so a note produced by the split can be
 * recursed into.
 *
 * @param app - The mocked app.
 * @param editor - The editor the reopened note should expose, or `null` for a non-markdown view.
 */
function setActiveEditor(app: App, editor: Editor | null): void {
  vi.mocked(app.workspace.getActiveViewOfType).mockReturnValue(editor === null ? null : strictProxy<MarkdownView>({ editor }));
}

function toTestable(handler: SplitNoteByHeadingsRecursivelyEditorCommandHandler): TestableHandler {
  return castTo<TestableHandler>(handler);
}

/**
 * Lets the mocked `createFragmentAsync` build a real fragment, so a notice's rendered text can be
 * asserted instead of just the fact that one was shown.
 */
function useRealFragments(): void {
  mockCreateFragmentAsync.mockImplementation(async (cb) => {
    const fragment = createFragment();
    await (cb as (f: DocumentFragment) => Promise<void>)(fragment);
    return fragment;
  });
  mockRenderInternalLink.mockImplementation((linkParams) => {
    const path = typeof linkParams.pathOrAbstractFile === 'string' ? linkParams.pathOrAbstractFile : linkParams.pathOrAbstractFile.path;
    return Promise.resolve(createEl('a', { text: `[${path}]` }));
  });
}

describe('SplitNoteByHeadingsRecursivelyEditorCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRealFragments();
    capturedConfirmParams = null;
    confirmResult = createConfirmResult(false);
    mockResolveSplitTemplateForNewTargetFile.mockReturnValue(RESOLVED_TEMPLATE);
    MockSplitComposer.prototype.splitFile = vi.fn().mockResolvedValue(undefined);
    mockGetSelectionUnderHeading.mockReturnValue({
      end: { ch: 0, line: 5 },
      heading: 'My Heading',
      start: { ch: 0, line: 0 }
    });
  });

  it('should construct with the recursive command identity', () => {
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(createMockParams()));
    expect(handler.id).toBe('split-note-by-headings-recursively');
    expect(handler.name).toBe('Split note by headings recursively...');
    expect(handler.icon).toBe('lucide-list-tree');
  });

  it('should return false from canExecuteEditor when file is null', () => {
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(createMockParams()));
    expect(handler.canExecuteEditor(createMockEditor(), createMockCtx(null))).toBe(false);
  });

  it('should return false from canExecuteEditor when cache is null', () => {
    const params = createMockParams();
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(params));
    vi.mocked(params.app.metadataCache.getFileCache).mockReturnValue(null);
    expect(handler.canExecuteEditor(createMockEditor(), createMockCtx(createMockFile()))).toBe(false);
  });

  it('should return false from canExecuteEditor when the note has no headings', () => {
    const params = createMockParams();
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(params));
    vi.mocked(params.app.metadataCache.getFileCache).mockReturnValue({});
    expect(handler.canExecuteEditor(createMockEditor(), createMockCtx(createMockFile()))).toBe(false);
  });

  it('should return true from canExecuteEditor for any heading, wherever the cursor is', () => {
    // Unlike the level-scoped commands, this one restructures the whole note, so it is not cursor-gated.
    const params = createMockParams();
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(params));
    vi.mocked(params.app.metadataCache.getFileCache).mockReturnValue(createCache([createHeading(3, 7)]));
    expect(handler.canExecuteEditor(createMockEditor(), createMockCtx(createMockFile()))).toBe(true);
  });

  it('should return false from canExecuteEditor when the command is blocked on the path', () => {
    const params = createMockParams({ shouldBlockCommandOnPath: true });
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(params));
    vi.mocked(params.app.metadataCache.getFileCache).mockReturnValue(createCache([createHeading(1, 0)]));
    expect(handler.canExecuteEditor(createMockEditor(), createMockCtx(createMockFile()))).toBe(false);
  });

  it('should return early from executeEditor when ctx.file is null', async () => {
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(createMockParams()));
    await handler.executeEditor(createMockEditor(), createMockCtx(null));
    expect(mockGetCacheSafe).not.toHaveBeenCalled();
  });

  it('should show a notice and return when the path is ignored', async () => {
    const params = createMockParams({ isPathIgnored: true });
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(params));

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
    expect(mockGetCacheSafe).not.toHaveBeenCalled();
  });

  it('should do nothing when the cache is unavailable', async () => {
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(createMockParams()));
    mockGetCacheSafe.mockResolvedValue(null);

    await handler.executeEditor(createMockEditor(), createMockCtx(createMockFile()));

    expect(MockSplitComposer).not.toHaveBeenCalled();
  });

  it('should do nothing when the note has no headings', async () => {
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(createMockParams()));
    mockGetCacheSafe.mockResolvedValue(createCacheWithoutHeadings());

    await handler.executeEditor(createMockEditor(), createMockCtx(createMockFile()));

    expect(MockSplitComposer).not.toHaveBeenCalled();
  });

  it('should not split when the up-front confirmation is cancelled', async () => {
    const params = createMockParams({ shouldAskBeforeSplitting: true });
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(params));
    mockGetCacheSafe.mockResolvedValue(createCache([createHeading(1, 0)]));
    confirmResult = createConfirmResult(false);

    await handler.executeEditor(createMockEditor(), createMockCtx(createMockFile()));

    expect(mockOpenModal).toHaveBeenCalledTimes(1);
    expect(MockSplitComposer).not.toHaveBeenCalled();
    expect(params.pluginSettingsComponent.editAndSave).not.toHaveBeenCalled();
  });

  it('should persist the "Don\'t ask again" choice and split once confirmed', async () => {
    const params = createMockParams({ shouldAskBeforeSplitting: true });
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(params));
    const file = createMockFile();
    confirmResult = createConfirmResult(true, false);

    scriptCaches(createCache([createHeading(1, 0)]), createCache([createHeading(1, 0)]), createCache([]));
    mockPrepareForSplitFile.mockResolvedValue(createSplitResult(createMockFile('A/A.md')));
    setActiveEditor(params.app, createMockEditor());

    await handler.executeEditor(createMockEditor(), createMockCtx(file));

    expect(MockSplitComposer).toHaveBeenCalledTimes(1);
    const settings = strictProxy<PluginSettings>({ shouldAskBeforeSplitting: true });
    await vi.mocked(params.pluginSettingsComponent.editAndSave).mock.calls[0]?.[0](settings);
    expect(settings.shouldAskBeforeSplitting).toBe(false);
  });

  it('should skip the confirmation entirely when the setting is off', async () => {
    const params = createMockParams({ shouldAskBeforeSplitting: false });
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(params));
    mockGetCacheSafe.mockResolvedValue(createCache([]));

    await handler.executeEditor(createMockEditor(), createMockCtx(createMockFile()));

    expect(mockOpenModal).not.toHaveBeenCalled();
  });

  it('should stop when the cache becomes unavailable mid-run', async () => {
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(createMockParams()));
    mockGetCacheSafe
      .mockResolvedValueOnce(createCache([createHeading(1, 0)]))
      .mockResolvedValueOnce(null);

    await handler.executeEditor(createMockEditor(), createMockCtx(createMockFile()));

    expect(MockSplitComposer).not.toHaveBeenCalled();
  });

  it('should stop when the note loses its headings mid-run', async () => {
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(createMockParams()));
    mockGetCacheSafe
      .mockResolvedValueOnce(createCache([createHeading(1, 0)]))
      .mockResolvedValueOnce(createCacheWithoutHeadings());

    await handler.executeEditor(createMockEditor(), createMockCtx(createMockFile()));

    expect(MockSplitComposer).not.toHaveBeenCalled();
  });

  it('should show a notice when the heading section cannot be resolved', async () => {
    const params = createMockParams();
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(params));
    mockGetCacheSafe.mockResolvedValue(createCache([createHeading(1, 0)]));
    mockGetSelectionUnderHeading.mockReturnValue(null);

    await handler.executeEditor(createMockEditor(), createMockCtx(createMockFile()));

    expect(params.pluginNoticeComponent.showNotice).toHaveBeenCalledWith('Failed to find heading');
    expect(MockSplitComposer).not.toHaveBeenCalled();
  });

  it('should stop when the split setup is cancelled', async () => {
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(createMockParams()));
    mockGetCacheSafe.mockResolvedValue(createCache([createHeading(1, 0)]));
    mockPrepareForSplitFile.mockResolvedValue(null);

    await handler.executeEditor(createMockEditor(), createMockCtx(createMockFile()));

    expect(MockSplitComposer).not.toHaveBeenCalled();
  });

  it('should force the folder tree and the current folder on every split', async () => {
    const params = createMockParams();
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(params));
    const file = createMockFile();
    const editor = createMockEditor();

    scriptCaches(createCache([createHeading(1, 0)]), createCache([createHeading(1, 0)]), createCache([]));
    mockPrepareForSplitFile.mockResolvedValue(createSplitResult(createMockFile('A/A.md')));
    setActiveEditor(params.app, createMockEditor());

    await handler.executeEditor(editor, createMockCtx(file));

    const prepareParams = mockPrepareForSplitFile.mock.calls[0]?.[0];
    expect(prepareParams?.sourceFile).toBe(file);
    expect(prepareParams?.editor).toBe(editor);
    expect(prepareParams?.heading).toBe('My Heading');
    // The three overrides are what make the folder tree nest: the new note goes beside its source, into a
    // Folder of its own, without asking again (the whole operation was confirmed once up front).
    expect(prepareParams?.shouldAllowOnlyCurrentFolderOverride).toBe(true);
    expect(prepareParams?.shouldForceSplitIntoFolder).toBe(true);
    expect(prepareParams?.shouldSkipConfirmation).toBe(true);
    expect(prepareParams?.shouldSkipModal).toBe(true);

    const composerParams = MockSplitComposer.mock.calls[0]?.[0];
    expect(composerParams?.sourceFile).toBe(file);
    expect(composerParams?.isMultipleSplit).toBe(true);
  });

  it('should root the tree in the default new note folder only on the first pass (issue #173)', async () => {
    const params = createMockParams({ shouldSplitRecursivelyIntoDefaultNewNoteFolder: true });
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(params));
    const file = createMockFile();
    const childFile = createMockFile('Inbox/A/A.md');
    const grandChildFile = createMockFile('Inbox/A/B/B.md');

    // The source yields one H1; the note it produced still holds the H2 that was nested under it.
    scriptCaches(
      createCache([createHeading(1, 0, 'A'), createHeading(2, 2, 'B')]),
      createCache([createHeading(1, 0, 'A'), createHeading(2, 2, 'B')]),
      createCache([]),
      createCache([createHeading(2, 2, 'B')]),
      createCache([])
    );
    mockPrepareForSplitFile
      .mockResolvedValueOnce(createSplitResult(childFile))
      .mockResolvedValueOnce(createSplitResult(grandChildFile));
    setActiveEditor(params.app, createMockEditor());

    await handler.executeEditor(createMockEditor(), createMockCtx(file));

    // An explicit `false` is what forces Obsidian's own new-file location for the root pass, whatever the
    // `shouldAllowOnlyCurrentFolderByDefault` setting says.
    expect(mockPrepareForSplitFile.mock.calls[0]?.[0].shouldAllowOnlyCurrentFolderOverride).toBe(false);
    // Every deeper pass keeps creating its note beside its source, which is what keeps the tree nesting
    // Instead of collapsing into one flat folder.
    expect(mockPrepareForSplitFile.mock.calls[1]?.[0].shouldAllowOnlyCurrentFolderOverride).toBe(true);
    // The folder tree itself is unaffected by the redirection.
    expect(mockPrepareForSplitFile.mock.calls[0]?.[0].shouldForceSplitIntoFolder).toBe(true);
  });

  it('should recurse into each produced note, one heading level deeper each time', async () => {
    const params = createMockParams();
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(params));
    const file = createMockFile();
    const childFile = createMockFile('A/A.md');
    const grandChildFile = createMockFile('A/B/B.md');

    // The source yields one H1; the note it produced still holds the H2 that was nested under it.
    scriptCaches(
      createCache([createHeading(1, 0, 'A'), createHeading(2, 2, 'B')]),
      createCache([createHeading(1, 0, 'A'), createHeading(2, 2, 'B')]),
      createCache([]),
      createCache([createHeading(2, 2, 'B')]),
      createCache([])
    );
    mockPrepareForSplitFile
      .mockResolvedValueOnce(createSplitResult(childFile))
      .mockResolvedValueOnce(createSplitResult(grandChildFile));
    setActiveEditor(params.app, createMockEditor());
    useRealFragments();

    await handler.executeEditor(createMockEditor(), createMockCtx(file));

    expect(MockSplitComposer).toHaveBeenCalledTimes(2);
    // The second pass splits the note the first pass produced, not the original note.
    expect(MockSplitComposer.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ sourceFile: childFile }));
    expect(mockPrepareForSplitFile.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ sourceFile: childFile }));
    expect(getShownNoticeText(params.pluginNoticeComponent)).toBe('Split note [test/note.md] into 2 note(s).');
  });

  it('should defer the split template to every produced note, paired with the note it came out of (issue #172)', async () => {
    const params = createMockParams();
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(params));
    const file = createMockFile();
    const childFile = createMockFile('A/A.md');
    const grandChildFile = createMockFile('A/B/B.md');

    scriptCaches(
      createCache([createHeading(1, 0, 'A'), createHeading(2, 2, 'B')]),
      createCache([createHeading(1, 0, 'A'), createHeading(2, 2, 'B')]),
      createCache([]),
      createCache([createHeading(2, 2, 'B')]),
      createCache([])
    );
    mockPrepareForSplitFile
      .mockResolvedValueOnce(createSplitResult(childFile))
      .mockResolvedValueOnce(createSplitResult(grandChildFile));
    setActiveEditor(params.app, createMockEditor());

    await handler.executeEditor(createMockEditor(), createMockCtx(file));

    // Every structural pass writes the extracted content untouched, so nothing the template adds can be
    // Dragged into the next note down.
    for (const call of MockSplitComposer.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ templateOverride: '{{content}}' }));
    }

    // The real template is applied afterwards, once, per produced note — each resolved against the note it
    // Was split OUT of, so `{{fromTitle}}` names its recursion parent rather than the run's root.
    expect(mockApplySplitTemplateToNotes).toHaveBeenCalledTimes(1);
    const applyParams = mockApplySplitTemplateToNotes.mock.calls[0]?.[0];
    // Compared as paths: the mock files are strict proxies, which a failure diff cannot serialize.
    expect(applyParams?.notes.map((note) => [note.file.path, note.sourceFile.path])).toEqual([
      [childFile.path, file.path],
      [grandChildFile.path, childFile.path]
    ]);
    expect(applyParams?.template).toBe(RESOLVED_TEMPLATE);
    expect(applyParams?.app).toBe(params.app);
    expect(applyParams?.resourceLockComponent).toBe(params.resourceLockComponent);
  });

  it('should still template the notes a part-way failure already created (issue #172)', async () => {
    const params = createMockParams();
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(params));
    const file = createMockFile();
    const childFile = createMockFile('A/A.md');

    // Two H1s to extract, but the setup flow is cancelled on the second.
    scriptCaches(
      createCache([createHeading(1, 0, 'A'), createHeading(1, 4, 'B')]),
      createCache([createHeading(1, 0, 'A'), createHeading(1, 4, 'B')]),
      createCache([createHeading(1, 4, 'B')]),
      createCache([])
    );
    mockPrepareForSplitFile
      .mockResolvedValueOnce(createSplitResult(childFile))
      .mockResolvedValueOnce(null);
    setActiveEditor(params.app, createMockEditor());
    useRealFragments();

    await handler.executeEditor(createMockEditor(), createMockCtx(file));

    expect(MockSplitComposer).toHaveBeenCalledTimes(1);
    const applyParams = mockApplySplitTemplateToNotes.mock.calls[0]?.[0];
    expect(applyParams?.notes.map((note) => [note.file.path, note.sourceFile.path])).toEqual([[childFile.path, file.path]]);
    expect(getShownNoticeText(params.pluginNoticeComponent)).toBe('Split note [test/note.md] into 1 note(s).');
  });

  it('should reopen the note the command was invoked on once the recursion finishes', async () => {
    const params = createMockParams();
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(params));
    const file = createMockFile();

    scriptCaches(createCache([createHeading(1, 0)]), createCache([createHeading(1, 0)]), createCache([]));
    mockPrepareForSplitFile.mockResolvedValue(createSplitResult(createMockFile('A/A.md')));
    setActiveEditor(params.app, createMockEditor());

    await handler.executeEditor(createMockEditor(), createMockCtx(file));

    const leaf = vi.mocked(params.app.workspace.getLeaf).mock.results[0]?.value as WorkspaceLeaf;
    const openedFiles = vi.mocked(leaf.openFile).mock.calls.map((call) => call[0]);
    expect(openedFiles.at(-1)).toBe(file);
  });

  it('should skip a produced note that did not open as a markdown view', async () => {
    const params = createMockParams();
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(params));

    scriptCaches(createCache([createHeading(1, 0)]), createCache([createHeading(1, 0)]), createCache([]));
    mockPrepareForSplitFile.mockResolvedValue(createSplitResult(createMockFile('A/A.md')));
    setActiveEditor(params.app, null);

    await handler.executeEditor(createMockEditor(), createMockCtx(createMockFile()));

    expect(MockSplitComposer).toHaveBeenCalledTimes(1);
  });

  it('should not recurse past the deepest heading level', async () => {
    const params = createMockParams();
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(params));

    scriptCaches(createCache([createHeading(6, 0)]), createCache([createHeading(6, 0)]), createCache([]));
    mockPrepareForSplitFile.mockResolvedValue(createSplitResult(createMockFile('A/A.md')));
    setActiveEditor(params.app, createMockEditor());

    await handler.executeEditor(createMockEditor(), createMockCtx(createMockFile()));

    // An H6 can hold no sub-headings, so its note is never reopened for another pass.
    expect(vi.mocked(params.app.workspace.getActiveViewOfType)).not.toHaveBeenCalled();
  });

  it('should render the notes it will create in the confirmation body', async () => {
    const params = createMockParams({ shouldAskBeforeSplitting: true });
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(params));
    const file = createMockFile();
    const editor = createMockEditor();
    vi.mocked(editor.getValue).mockReturnValue('# A\n\n## B\n');

    mockGetCacheSafe.mockResolvedValue(createCache([
      strictProxy<HeadingCache>({ heading: 'A', level: 1, position: { end: { col: 0, line: 0, offset: 3 }, start: { col: 0, line: 0, offset: 0 } } }),
      strictProxy<HeadingCache>({ heading: 'B', level: 2, position: { end: { col: 0, line: 2, offset: 9 }, start: { col: 0, line: 2, offset: 5 } } })
    ]));
    mockRenderInternalLink.mockResolvedValue(createEl('a'));

    await handler.executeEditor(editor, createMockCtx(file));

    const fragment = createFragment();
    await capturedConfirmParams?.buildContent(fragment);

    const { appendCodeBlock } = await import('obsidian-dev-utils/obsidian/html-element');
    const renderedCodeBlocks = vi.mocked(appendCodeBlock).mock.calls.map((call) => call[1]);
    expect(renderedCodeBlocks).toContain('2');
    expect(renderedCodeBlocks).toContain('A');
    expect(renderedCodeBlocks).toContain('    B');
    expect(fragment.querySelector('h2')?.textContent).toBe('Notes that will be created');
  });

  it('should return the shouldAddCommandsToSubmenu setting when super returns undefined', () => {
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(createMockParams({ shouldAddCommandsToSubmenu: true })));
    expect(handler.shouldAddCommandToSubmenu()).toBe(true);
  });

  it('should return false from shouldAddCommandToSubmenu when the setting is false', () => {
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(createMockParams({ shouldAddCommandsToSubmenu: false })));
    expect(handler.shouldAddCommandToSubmenu()).toBe(false);
  });

  it('should return true from shouldAddToEditorMenu', () => {
    const handler = toTestable(new SplitNoteByHeadingsRecursivelyEditorCommandHandler(createMockParams()));
    expect(handler.shouldAddToEditorMenu(createMockEditor(), createMockCtx(createMockFile()))).toBe(true);
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
