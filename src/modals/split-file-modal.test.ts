import type {
  InternalPlugins,
  ViewRegistry
} from '@obsidian-typings/obsidian-public-latest';
import type {
  App,
  Editor,
  MetadataCache,
  Notice,
  TFile,
  TFolder,
  Vault,
  Workspace,
  WorkspaceLeaf
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type {
  ResourceLockComponent,
  ResourceLockComponentLockForPathParams
} from 'obsidian-dev-utils/obsidian/resource-lock';

import { noop } from 'obsidian-dev-utils/function';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { prompt } from 'obsidian-dev-utils/obsidian/modals/prompt';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  afterEach,
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
import type { SuggestModalBaseConstructorParams } from './suggest-modal-base.ts';

import { InsertMode } from '../insert-mode.ts';
import { MoveSelectionBuffer } from '../move-selection-buffer.ts';
import { NameTransformError } from '../name-transform.ts';
import { openMinimizableModal } from '../open-minimizable-modal.ts';
import {
  FrontmatterMergeStrategy,
  SplitTargetMode
} from '../plugin-settings.ts';
import { selectFolder } from './select-folder-modal.ts';
import { prepareForSplitFile } from './split-file-modal.ts';

vi.mock('obsidian-dev-utils/obsidian/html-element', () => ({
  appendCodeBlock: vi.fn()
}));

vi.mock('obsidian-dev-utils/html-element', () => ({
  createFragmentAsync: vi.fn().mockImplementation((callback: (f: DocumentFragment) => Promise<void>) => {
    const fragment = createFragment();
    return callback(fragment).then(() => fragment);
  })
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn().mockResolvedValue(createSpan())
}));

vi.mock('obsidian-dev-utils/obsidian/metadata-cache', () => ({
  getCacheSafe: vi.fn().mockResolvedValue(null)
}));

vi.mock('obsidian-dev-utils/obsidian/vault', () => ({
  trashSafe: vi.fn().mockResolvedValue(undefined)
}));

interface OpenableModal {
  open(): void;
}

vi.mock('../open-minimizable-modal.ts', () => ({
  openConfirmDialogModal: vi.fn((modal: OpenableModal) => {
    modal.open();
  }),
  openMinimizableModal: vi.fn((modal: OpenableModal) => {
    modal.open();
  }),
  openModal: vi.fn((modal: OpenableModal) => {
    modal.open();
  })
}));

vi.mock('../composers/composer-base.ts', () => ({
  getInsertModeFromEvent: vi.fn().mockReturnValue(InsertMode.Append)
}));

let shouldAutoSelect = false;
let shouldAutoSwitchToSmartCut = false;

interface AsyncModule {
  invokeAsyncSafely($function: () => Promise<void>): void;
}

interface SwitchToSmartCutResult {
  readonly action: 'switch-to-smart-cut';
}

interface WithChooseAsync {
  onChooseSuggestionAsync(item: unknown, $event: KeyboardEvent | MouseEvent): Promise<void>;
}

interface WithSwitchToSmartCut {
  isSelected: boolean;
  promiseResolve(result: SwitchToSmartCutResult): void;
}

vi.mock('./suggest-modal-base.ts', async () => {
  const obsidian = await vi.importActual<typeof import('obsidian')>('obsidian');

  const asyncModule = await import('obsidian-dev-utils/async') as AsyncModule;

  class MockSuggestModalBase extends obsidian.SuggestModal<unknown> {
    protected allowCreateNewFile = false;
    protected readonly pluginSettingsComponent: PluginSettingsComponent;
    protected shouldAllowOnlyCurrentFolder = false;
    protected shouldShowAlias = false;
    protected shouldShowImages = true;
    protected shouldShowMarkdown = true;
    protected shouldShowNonAttachments = true;
    protected shouldShowNonFileBookmarks = false;
    protected shouldShowNonImageAttachments = true;
    protected shouldShowUnresolved = false;
    protected sourceFile: TFile;

    public constructor(params: SuggestModalBaseConstructorParams) {
      super(params.app);
      this.sourceFile = params.sourceFile;
      this.pluginSettingsComponent = params.pluginSettingsComponent;
      this.shouldAllowOnlyCurrentFolder = params.pluginSettingsComponent.settings.shouldAllowOnlyCurrentFolderByDefault;
    }

    public getSuggestions(_query: string): unknown[] {
      return [];
    }

    public onChooseSuggestion(item: unknown, $event: KeyboardEvent | MouseEvent): void {
      asyncModule.invokeAsyncSafely(() => (castTo<WithChooseAsync>(this)).onChooseSuggestionAsync(item, $event));
    }

    public override onOpen(): void {
      if (shouldAutoSwitchToSmartCut) {
        // Emulate the modal's Alt+S "switch to smart cut" action (its own code is UI-only / v8-ignored):
        // Resolve with a switch result so prepareForSplitFile takes its switch branch.
        const modal = castTo<WithSwitchToSmartCut>(this);
        modal.isSelected = true;
        modal.promiseResolve({ action: 'switch-to-smart-cut' });
        return;
      }
      if (shouldAutoSelect) {
        this.onChooseSuggestion(null, { shiftKey: false } as MouseEvent);
      }
      super.onOpen();
    }

    public renderSuggestion(): void {
      noop();
    }

    public override selectActiveSuggestion(_event: KeyboardEvent | MouseEvent): void {
      noop();
    }

    public override updateSuggestions(): void {
      noop();
    }

    // The real one reads `Editor > Spellcheck` off the vault and writes an attribute on `inputEl`; both
    // Belong to the base, so they are proved by `suggest-modal-base.test.ts` and the desktop case rather
    // Than here, where the base is a stand-in.
    protected refreshSpellcheck(): void {
      noop();
    }
  }
  return { SuggestModalBase: MockSuggestModalBase };
});

vi.mock('../composers/split-composer.ts', () => ({
  getSelections: vi.fn().mockReturnValue([{ endOffset: 10, startOffset: 0 }])
}));

vi.mock('../headings.ts', () => ({
  extractHeading: vi.fn().mockReturnValue('Test Heading')
}));

vi.mock('obsidian-dev-utils/obsidian/modals/prompt', () => ({
  prompt: vi.fn()
}));

vi.mock('./select-folder-modal.ts', () => ({
  selectFolder: vi.fn()
}));

const mockPrompt = vi.mocked(prompt);
const mockSelectFolder = vi.mocked(selectFolder);

interface MockPluginOptions {
  readonly defaultSplitTargetMode?: SplitTargetMode;
  readonly shouldAllowOnlyCurrentFolderByDefault?: boolean;
  readonly shouldAskBeforeSplitting?: boolean;
  readonly shouldAskForTargetFolderWhenSplitting?: boolean;
  readonly shouldChooseFolderBeforeNameWhenSplitting?: boolean;
  readonly shouldSplitHeadingsAutomatically?: boolean;
}

interface SelectItemResult {
  readonly isNewTargetFile: boolean;
  readonly targetFile: TFile;
}

const mockTargetFile = strictProxy<TFile>({ path: 'folder/target.md' });

const mockSelectItem = vi.fn(
  (): Promise<SelectItemResult> => Promise.resolve({ isNewTargetFile: false, targetFile: mockTargetFile })
);

const mockShowNotice = vi.fn();
// Shared across the suite because every call site needs one and no test cares about another's notices;
// `mockClear` in `beforeEach` keeps the call history per-test.
const pluginNoticeComponent = strictProxy<PluginNoticeComponent>({ showNotice: castTo<PluginNoticeComponent['showNotice']>(mockShowNotice) });

/**
 * The subset of the item selector's constructor params these tests assert are threaded through.
 */
interface CapturedSplitItemSelectorParams {
  readonly inputValue: string;
  readonly isModifier: boolean;
  readonly shouldAllowOnlyCurrentFolder: boolean;
  readonly shouldForceSplitIntoFolder: boolean;
  readonly splitTargetMode: SplitTargetMode;
  readonly targetParentFolderOverride: null | TFolder;
}

let capturedSplitItemSelectorParams: CapturedSplitItemSelectorParams | null = null;

const mockOpenMinimizableModal = vi.mocked(openMinimizableModal);

/**
 * The folder the issue-#261 pair's first prompt answers with.
 */
const chosenFolder = castTo<TFolder>({ getParentPrefix: () => 'chosen-folder/', path: 'chosen-folder' });

vi.mock('../item-selectors/split-item-selector.ts', () => {
  class MockSplitItemSelector {
    public constructor(params: CapturedSplitItemSelectorParams) {
      capturedSplitItemSelectorParams = params;
    }

    public selectItem(): Promise<SelectItemResult> {
      return mockSelectItem();
    }
  }
  return { SplitItemSelector: MockSplitItemSelector };
});

function createMockApp(): App {
  return strictProxy<App>({
    internalPlugins: strictProxy<InternalPlugins>({
      getEnabledPluginById: castTo<InternalPlugins['getEnabledPluginById']>(vi.fn().mockReturnValue(null))
    }),
    metadataCache: strictProxy<MetadataCache>({
      getFileCache: vi.fn().mockReturnValue(null),
      isUserIgnored: vi.fn().mockReturnValue(false),
      unresolvedLinks: {}
    }),
    vault: strictProxy<Vault>({
      getFileByPath: vi.fn().mockReturnValue(null),
      getFiles: vi.fn().mockReturnValue([]),
      getMarkdownFiles: vi.fn().mockReturnValue([])
    }),

    viewRegistry: strictProxy<ViewRegistry>({
      isExtensionRegistered: vi.fn().mockReturnValue(true)
    }),
    workspace: createMockWorkspace()
  });
}

function createMockEditor(): Editor {
  return strictProxy<Editor>({
    cm: strictProxy({
      state: strictProxy({
        sliceDoc: vi.fn().mockReturnValue('selected text')
      })
    }),
    getSelection: vi.fn().mockReturnValue('# Heading\nsome text')
  });
}

function createMockFile(path: string): TFile {
  const name = path.split('/').pop() ?? '';
  const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  return strictProxy<TFile>({
    extension: 'md',
    name,
    parent: strictProxy<TFolder>({
      getParentPrefix: () => parentPath ? `${parentPath}/` : '',
      path: parentPath
    }),
    path,
    stat: strictProxy({ mtime: 0 })
  });
}

function createMockLeaf(): WorkspaceLeaf {
  return strictProxy<WorkspaceLeaf>({ openFile: vi.fn().mockResolvedValue(undefined) });
}

function createMockMoveNoticeComponent(): MoveNoticeComponent {
  return strictProxy<MoveNoticeComponent>({
    refreshButtons: vi.fn(),
    showNotice: vi.fn().mockReturnValue(strictProxy<Notice>({ hide: vi.fn() }))
  });
}

function createMockPluginSettingsComponent(options?: MockPluginOptions): PluginSettingsComponent {
  const shouldAskBeforeSplitting = options?.shouldAskBeforeSplitting ?? false;
  const shouldSplitHeadingsAutomatically = options?.shouldSplitHeadingsAutomatically ?? false;

  return strictProxy<PluginSettingsComponent>({
    editAndSave: vi.fn().mockResolvedValue(undefined),
    settings: strictProxy({
      defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues,
      defaultSplitTargetMode: options?.defaultSplitTargetMode ?? SplitTargetMode.Create,
      isPathIgnored: vi.fn().mockReturnValue(false),
      shouldAllowOnlyCurrentFolderByDefault: options?.shouldAllowOnlyCurrentFolderByDefault ?? false,
      shouldAllowSplitIntoUnresolvedPathByDefault: true,
      shouldAskBeforeSplitting,
      shouldAskForTargetFolderWhenSplitting: options?.shouldAskForTargetFolderWhenSplitting ?? false,
      shouldChooseFolderBeforeNameWhenSplitting: options?.shouldChooseFolderBeforeNameWhenSplitting ?? false,
      shouldFixFootnotesByDefault: true,
      shouldIncludeFrontmatterWhenSplittingByDefault: false,
      shouldLockAllNotesWhenMarkingSelection: false,
      shouldMergeHeadingsByDefault: false,
      shouldOfferCurrentNoteWhenSplitting: true,
      shouldShowModalInstructions: true,
      shouldSplitHeadingsAutomatically,
      shouldTreatTitleAsPathByDefault: true
    })
  });
}

function createMockResourceLockComponent(): ResourceLockComponent {
  const unlockForPath = vi.fn();
  // The real lock is released by disposing the returned `Disposable`; model that as
  // `unlockForPath` so a `using` scope-exit disposal is observable through the same spy.
  return strictProxy<ResourceLockComponent>({
    lockForPath: castTo<ResourceLockComponent['lockForPath']>(vi.fn((params: ResourceLockComponentLockForPathParams) => ({
      [Symbol.dispose]: (): void => {
        unlockForPath(params.pathOrFile);
      }
    }))),
    unlockForPath
  });
}

function createMockSelectionHighlightComponent(): SelectionHighlightComponent {
  return strictProxy<SelectionHighlightComponent>({
    addHighlight: vi.fn().mockReturnValue({ [Symbol.dispose]: vi.fn() })
  });
}

function createMockWorkspace(): Workspace {
  return strictProxy<Workspace>({
    getLeaf: castTo<Workspace['getLeaf']>(vi.fn().mockReturnValue(createMockLeaf())),
    getRecentFiles: vi.fn().mockReturnValue([])
  });
}

describe('prepareForSplitFile', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    capturedSplitItemSelectorParams = null;
    shouldAutoSelect = false;
    shouldAutoSwitchToSmartCut = false;
    mockShowNotice.mockClear();
    mockSelectFolder.mockReset();
    mockPrompt.mockReset();
    mockOpenMinimizableModal.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return null when modal is cancelled', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const editor = createMockEditor();
    const resourceLockComponent = createMockResourceLockComponent();
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent();

    const promise = prepareForSplitFile({ app, editor, pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, sourceFile });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('should use extractHeading when heading is undefined', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const editor = createMockEditor();
    const resourceLockComponent = createMockResourceLockComponent();
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent();

    const promise = prepareForSplitFile({ app, editor, pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, sourceFile });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('marks the selection to move and stays on the source note when switching to smart cut', async () => {
    // Switching to smart cut from the picker must NOT open any note (issue #141): the picker only has a
    // Merely-highlighted suggestion the user never chose, so the active note must stay put.
    shouldAutoSwitchToSmartCut = true;
    const sourceFile = createMockFile('folder/source.md');
    const editor = createMockEditor();
    const resourceLockComponent = createMockResourceLockComponent();
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent();
    const moveSelectionBuffer = new MoveSelectionBuffer();
    const moveNoticeComponent = createMockMoveNoticeComponent();
    const selectionHighlightComponent = createMockSelectionHighlightComponent();

    const promise = prepareForSplitFile({ app, editor, moveNoticeComponent, moveSelectionBuffer, pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, selectionHighlightComponent, sourceFile });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;

    expect(result).toBeNull();
    expect(moveSelectionBuffer.hasMark()).toBe(true);
    expect(moveNoticeComponent.showNotice).toHaveBeenCalled();
    expect(vi.mocked(app.workspace.getLeaf(false).openFile)).not.toHaveBeenCalled();
  });

  it('should treat empty string heading as undefined', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const editor = createMockEditor();
    const resourceLockComponent = createMockResourceLockComponent();
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent();

    const promise = prepareForSplitFile({ app, editor, heading: '', pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, sourceFile });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('should use provided heading', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const editor = createMockEditor();
    const resourceLockComponent = createMockResourceLockComponent();
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent();

    const promise = prepareForSplitFile({ app, editor, heading: 'Custom Heading', pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, sourceFile });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('should skip modal when shouldSkipModal is true', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const editor = createMockEditor();
    const resourceLockComponent = createMockResourceLockComponent();
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent({ shouldAskBeforeSplitting: false });

    const result = await prepareForSplitFile({ app, editor, heading: 'Heading', pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, shouldSkipModal: true, sourceFile });
    expect(result).not.toBeNull();
    expect(result?.targetFile).toBe(mockTargetFile);
    expect(result?.insertMode).toBe(InsertMode.Append);
  });

  it('should return all settings when shouldSkipModal and not shouldAskBeforeSplitting', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const editor = createMockEditor();
    const resourceLockComponent = createMockResourceLockComponent();
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent({ shouldAskBeforeSplitting: false });

    const result = await prepareForSplitFile({ app, editor, heading: 'Heading', pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, shouldSkipModal: true, sourceFile });
    expect(result).not.toBeNull();
    expect(result?.frontmatterMergeStrategy).toBe(FrontmatterMergeStrategy.MergeAndPreferNewValues);
    expect(result?.shouldAllowOnlyCurrentFolder).toBe(false);
    expect(result?.shouldAllowSplitIntoUnresolvedPath).toBe(true);
    expect(result?.shouldMergeHeadings).toBe(false);
    expect(result?.shouldIncludeFrontmatter).toBe(false);
  });

  it('reports a refused name transform and cancels, instead of letting it escape (issue #203)', async () => {
    // With the picker skipped there is no prompt to report into, so this is the only place the user can
    // Learn that their `Name transform template` is the reason nothing happened.
    const sourceFile = createMockFile('folder/source.md');
    const editor = createMockEditor();
    const resourceLockComponent = createMockResourceLockComponent();
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent({ shouldAskBeforeSplitting: false });
    mockSelectItem.mockRejectedValueOnce(new NameTransformError('Name transform template produced a multi-line name'));

    const result = await prepareForSplitFile({ app, editor, heading: 'Heading', pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, shouldSkipModal: true, sourceFile });

    expect(result).toBeNull();
    expect(mockShowNotice).toHaveBeenCalledWith('Name transform template produced a multi-line name');
  });

  it('lets an unexpected failure through, so a real bug is not reported as a configuration problem', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const editor = createMockEditor();
    const resourceLockComponent = createMockResourceLockComponent();
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent({ shouldAskBeforeSplitting: false });
    mockSelectItem.mockRejectedValueOnce(new Error('boom'));

    await expect(prepareForSplitFile({ app, editor, heading: 'Heading', pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, shouldSkipModal: true, sourceFile }))
      .rejects.toThrow('boom');
    expect(mockShowNotice).not.toHaveBeenCalled();
  });

  it('should create the new note in the source folder when the caller forces it', async () => {
    // The recursive split (issue #79) needs each pass's new note to land beside its source, whatever the
    // `Should allow only current folder by default` setting says — that is what makes the tree nest.
    const sourceFile = createMockFile('folder/source.md');
    const editor = createMockEditor();
    const resourceLockComponent = createMockResourceLockComponent();
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent({ shouldAskBeforeSplitting: false });

    const result = await prepareForSplitFile({
      app,
      editor,
      heading: 'Heading',
      pluginNoticeComponent,
      pluginSettingsComponent,
      resourceLockComponent,
      shouldAllowOnlyCurrentFolderOverride: true,
      shouldSkipModal: true,
      sourceFile
    });

    expect(result?.shouldAllowOnlyCurrentFolder).toBe(true);
    expect(capturedSplitItemSelectorParams?.shouldAllowOnlyCurrentFolder).toBe(true);
  });

  it('should let an explicit false override win over the setting (issue #173)', async () => {
    // The override is a TRI-state resolved with `??`, so `false` is not "do not override" — it forces
    // Obsidian's own new-file location even with the setting on. That is the lever the recursive split's
    // Root pass pulls to root its tree in the `Default location for new notes`.
    const sourceFile = createMockFile('folder/source.md');
    const editor = createMockEditor();
    const resourceLockComponent = createMockResourceLockComponent();
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent({ shouldAllowOnlyCurrentFolderByDefault: true, shouldAskBeforeSplitting: false });

    const result = await prepareForSplitFile({
      app,
      editor,
      heading: 'Heading',
      pluginNoticeComponent,
      pluginSettingsComponent,
      resourceLockComponent,
      shouldAllowOnlyCurrentFolderOverride: false,
      shouldSkipModal: true,
      sourceFile
    });

    expect(result?.shouldAllowOnlyCurrentFolder).toBe(false);
    expect(capturedSplitItemSelectorParams?.shouldAllowOnlyCurrentFolder).toBe(false);
  });

  it('should fall back to the setting when no override is given', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const editor = createMockEditor();
    const resourceLockComponent = createMockResourceLockComponent();
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent({ shouldAllowOnlyCurrentFolderByDefault: true, shouldAskBeforeSplitting: false });

    const result = await prepareForSplitFile({ app, editor, heading: 'Heading', pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, shouldSkipModal: true, sourceFile });

    expect(result?.shouldAllowOnlyCurrentFolder).toBe(true);
  });

  it('should pass the forced folder split through to the item selector', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const editor = createMockEditor();
    const resourceLockComponent = createMockResourceLockComponent();
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent({ shouldAskBeforeSplitting: false });

    await prepareForSplitFile({
      app,
      editor,
      heading: 'Heading',
      pluginNoticeComponent,
      pluginSettingsComponent,
      resourceLockComponent,
      shouldForceSplitIntoFolder: true,
      shouldSkipModal: true,
      sourceFile
    });

    expect(capturedSplitItemSelectorParams?.shouldForceSplitIntoFolder).toBe(true);
  });

  it('should create the target of a heading-driven split whatever the default mode is', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const editor = createMockEditor();
    const resourceLockComponent = createMockResourceLockComponent();
    const app = createMockApp();
    // `Merge` as the DEFAULT is what makes this meaningful: the picker never opens for a heading-driven
    // Split, so it must still name a brand-new note after the heading (issue #227).
    const pluginSettingsComponent = createMockPluginSettingsComponent({ defaultSplitTargetMode: SplitTargetMode.Merge, shouldAskBeforeSplitting: false });

    await prepareForSplitFile({ app, editor, heading: 'Heading', pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, shouldSkipModal: true, sourceFile });

    expect(capturedSplitItemSelectorParams?.splitTargetMode).toBe(SplitTargetMode.Create);
    // The switch replaced the held-`Mod` rule on this path, so the flag is no longer what decides it.
    expect(capturedSplitItemSelectorParams?.isModifier).toBe(false);
  });

  it('should not force the folder split for an ordinary heading-driven split', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const editor = createMockEditor();
    const resourceLockComponent = createMockResourceLockComponent();
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent({ shouldAskBeforeSplitting: false });

    await prepareForSplitFile({ app, editor, heading: 'Heading', pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, shouldSkipModal: true, sourceFile });

    expect(capturedSplitItemSelectorParams?.shouldForceSplitIntoFolder).toBe(false);
  });

  it('should skip the confirmation when the caller already confirmed the whole operation', async () => {
    // The recursive split confirms once up front and then runs many splits; confirming each would be
    // Unusable. `shouldAskBeforeSplitting` stays on, so this proves the override and not the setting.
    const sourceFile = createMockFile('folder/source.md');
    const editor = createMockEditor();
    const resourceLockComponent = createMockResourceLockComponent();
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent({ shouldAskBeforeSplitting: true });

    const result = await prepareForSplitFile({
      app,
      editor,
      heading: 'Heading',
      pluginNoticeComponent,
      pluginSettingsComponent,
      resourceLockComponent,
      shouldSkipConfirmation: true,
      shouldSkipModal: true,
      sourceFile
    });

    expect(result).not.toBeNull();
    expect(result?.targetFile).toBe(mockTargetFile);
  });

  it('should skip the confirmation for a heading-driven split when splitting headings automatically', async () => {
    // Issue #79: a heading-driven split must run start-to-finish without prompting when the setting is on,
    // Even though `shouldAskBeforeSplitting` would otherwise open the confirmation dialog.
    const sourceFile = createMockFile('folder/source.md');
    const editor = createMockEditor();
    const resourceLockComponent = createMockResourceLockComponent();
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent({ shouldAskBeforeSplitting: true, shouldSplitHeadingsAutomatically: true });

    const result = await prepareForSplitFile({ app, editor, heading: 'Heading', pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, shouldSkipModal: true, sourceFile });

    expect(result).not.toBeNull();
    expect(result?.targetFile).toBe(mockTargetFile);
  });

  it('should still confirm a manually-targeted split when splitting headings automatically', async () => {
    // The setting only covers heading-driven splits (`shouldSkipModal`); an ordinary split keeps asking.
    shouldAutoSelect = true;
    const sourceFile = createMockFile('folder/source.md');
    const editor = createMockEditor();
    const resourceLockComponent = createMockResourceLockComponent();
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent({ shouldAskBeforeSplitting: true, shouldSplitHeadingsAutomatically: true });

    const promise = prepareForSplitFile({ app, editor, pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, sourceFile });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;

    // The confirmation dialog is never resolved in unit tests, so reaching it yields null.
    expect(result).toBeNull();
  });

  it('should return null when confirm dialog is rejected', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const editor = createMockEditor();
    const resourceLockComponent = createMockResourceLockComponent();
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent({ shouldAskBeforeSplitting: true });

    const promise = prepareForSplitFile({ app, editor, heading: 'Heading', pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, shouldSkipModal: true, sourceFile });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('should trash new target file when confirm rejected and file is new', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const editor = createMockEditor();
    const resourceLockComponent = createMockResourceLockComponent();
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent({ shouldAskBeforeSplitting: true });

    const { trashSafe } = await import('obsidian-dev-utils/obsidian/vault');

    mockSelectItem.mockResolvedValueOnce({ isNewTargetFile: true, targetFile: mockTargetFile });

    const promise = prepareForSplitFile({ app, editor, heading: 'Heading', pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, shouldSkipModal: true, sourceFile });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
    expect(trashSafe).toHaveBeenCalledWith(app, mockTargetFile);
  });

  it('should return result when user selects item via modal and shouldAskBeforeSplitting is false', async () => {
    shouldAutoSelect = true;
    const sourceFile = createMockFile('folder/source.md');
    const editor = createMockEditor();
    const resourceLockComponent = createMockResourceLockComponent();
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent({ shouldAskBeforeSplitting: false });

    const promise = prepareForSplitFile({ app, editor, pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, sourceFile });
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).not.toBeNull();
    expect(result?.targetFile).toBe(mockTargetFile);
  });

  it('should return null when confirm dialog rejects after modal selection', async () => {
    shouldAutoSelect = true;
    const sourceFile = createMockFile('folder/source.md');
    const editor = createMockEditor();
    const resourceLockComponent = createMockResourceLockComponent();
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent({ shouldAskBeforeSplitting: true });

    const promise = prepareForSplitFile({ app, editor, pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, sourceFile });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('should lock the source note while the modal is open and unlock it afterwards', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const editor = createMockEditor();
    const resourceLockComponent = createMockResourceLockComponent();
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent();

    const promise = prepareForSplitFile({ app, editor, pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, sourceFile });
    expect(vi.mocked(resourceLockComponent.lockForPath).mock.calls.map((call) => call[0].pathOrFile)).toContain(sourceFile);
    expect(resourceLockComponent.unlockForPath).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    await promise;
    expect(resourceLockComponent.unlockForPath).toHaveBeenCalledWith(sourceFile);
  });

  it('should lock the target note while the confirmation dialog is open and unlock both notes afterwards', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const editor = createMockEditor();
    const resourceLockComponent = createMockResourceLockComponent();
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent({ shouldAskBeforeSplitting: true });

    const promise = prepareForSplitFile({ app, editor, heading: 'Heading', pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, shouldSkipModal: true, sourceFile });
    await vi.advanceTimersByTimeAsync(0);
    await promise;
    const lockedPaths = vi.mocked(resourceLockComponent.lockForPath).mock.calls.map((call) => call[0].pathOrFile);
    expect(lockedPaths).toContain(sourceFile);
    expect(lockedPaths).toContain(mockTargetFile);
    expect(resourceLockComponent.unlockForPath).toHaveBeenCalledWith(sourceFile);
    expect(resourceLockComponent.unlockForPath).toHaveBeenCalledWith(mockTargetFile);
  });

  // Issue #238. Name first, path second: once the name is settled the flow ASKS where the note goes,
  // Instead of the destination falling out of a setting, a typed path, or Obsidian's default new-note
  // Location - which is where the reporter's extract silently landed.
  describe('the target folder prompt', () => {
    const pickedFolder = strictProxy<TFolder>({ getParentPrefix: () => 'picked-folder/', path: 'picked-folder' });

    it('should not ask when the setting is off', async () => {
      shouldAutoSelect = true;
      const sourceFile = createMockFile('folder/source.md');
      const editor = createMockEditor();
      const resourceLockComponent = createMockResourceLockComponent();
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({ shouldAskBeforeSplitting: false });

      const promise = prepareForSplitFile({ app, editor, pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, sourceFile });
      await vi.advanceTimersByTimeAsync(0);
      const result = await promise;

      expect(result).not.toBeNull();
      expect(mockSelectFolder).not.toHaveBeenCalled();
      expect(capturedSplitItemSelectorParams?.targetParentFolderOverride).toBeNull();
    });

    it('should ask once the name is chosen and hand the folder to the item selector', async () => {
      shouldAutoSelect = true;
      mockSelectFolder.mockResolvedValue(pickedFolder);
      const sourceFile = createMockFile('folder/source.md');
      const editor = createMockEditor();
      const resourceLockComponent = createMockResourceLockComponent();
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({ shouldAskBeforeSplitting: false, shouldAskForTargetFolderWhenSplitting: true });

      const promise = prepareForSplitFile({ app, editor, pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, sourceFile });
      await vi.advanceTimersByTimeAsync(0);
      const result = await promise;

      expect(result).not.toBeNull();
      expect(mockSelectFolder).toHaveBeenCalledTimes(1);
      expect(mockSelectFolder.mock.calls[0]?.[0]?.placeholder).toBe('Select folder to create the new note in...');
      // The source note is locked for the whole setup flow, so an unlock request has to close this prompt.
      expect(mockSelectFolder.mock.calls[0]?.[0]?.abortController).toBeInstanceOf(AbortController);
      expect(capturedSplitItemSelectorParams?.targetParentFolderOverride).toBe(pickedFolder);
    });

    it('should not ask when the picker never opened', async () => {
      // A heading-driven split derives everything from the heading and asks the user nothing, so it must
      // Not grow a prompt of its own.
      const sourceFile = createMockFile('folder/source.md');
      const editor = createMockEditor();
      const resourceLockComponent = createMockResourceLockComponent();
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({ shouldAskBeforeSplitting: false, shouldAskForTargetFolderWhenSplitting: true });

      const result = await prepareForSplitFile({ app, editor, heading: 'Heading', pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, shouldSkipModal: true, sourceFile });

      expect(result).not.toBeNull();
      expect(mockSelectFolder).not.toHaveBeenCalled();
    });

    it('should not ask when merging into an existing note', async () => {
      // A `Merge` writes into a note that already exists, so there is no folder left to choose.
      shouldAutoSelect = true;
      const sourceFile = createMockFile('folder/source.md');
      const editor = createMockEditor();
      const resourceLockComponent = createMockResourceLockComponent();
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        defaultSplitTargetMode: SplitTargetMode.Merge,
        shouldAskBeforeSplitting: false,
        shouldAskForTargetFolderWhenSplitting: true
      });

      const promise = prepareForSplitFile({ app, editor, pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, sourceFile });
      await vi.advanceTimersByTimeAsync(0);
      const result = await promise;

      expect(result).not.toBeNull();
      expect(capturedSplitItemSelectorParams?.splitTargetMode).toBe(SplitTargetMode.Merge);
      expect(mockSelectFolder).not.toHaveBeenCalled();
    });

    it('should reopen the picker when the folder prompt is dismissed', async () => {
      // Dismissing is "never mind, let me fix the name", not "abandon the operation" — so the flow goes
      // Back to the picker and asks again, rather than returning null.
      shouldAutoSelect = true;
      mockSelectFolder.mockResolvedValueOnce(null).mockResolvedValueOnce(pickedFolder);
      const sourceFile = createMockFile('folder/source.md');
      const editor = createMockEditor();
      const resourceLockComponent = createMockResourceLockComponent();
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({ shouldAskBeforeSplitting: false, shouldAskForTargetFolderWhenSplitting: true });

      const promise = prepareForSplitFile({ app, editor, pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, sourceFile });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
      const result = await promise;

      expect(result).not.toBeNull();
      expect(mockSelectFolder).toHaveBeenCalledTimes(2);
      expect(capturedSplitItemSelectorParams?.targetParentFolderOverride).toBe(pickedFolder);
    });
  });

  /*
   * Issue #261: the picker's box names the new note AND filters existing notes at the same time, and the
   * reporter wants those two questions asked separately. With the setting on the picker never opens: a
   * folder prompt comes first, a plain name prompt second.
   */
  describe('choosing the folder before the name (issue #261)', () => {
    it('should ask for the folder and then the name, and never open the picker', async () => {
      mockSelectFolder.mockResolvedValue(chosenFolder);
      mockPrompt.mockResolvedValue('typed name');
      const sourceFile = createMockFile('folder/source.md');
      const editor = createMockEditor();
      const resourceLockComponent = createMockResourceLockComponent();
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        shouldAskBeforeSplitting: false,
        shouldChooseFolderBeforeNameWhenSplitting: true
      });

      const result = await prepareForSplitFile({ app, editor, pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, sourceFile });

      expect(result).not.toBeNull();
      // The picker is what the pair REPLACES, so its absence is the feature, not a side effect.
      // Counted rather than asserted with `toHaveBeenCalled`: a failure would pretty-format the recorded
      // `strictProxy` modal, which throws on the first unmocked property it probes.
      expect(mockOpenMinimizableModal.mock.calls).toHaveLength(0);
      expect(mockSelectFolder).toHaveBeenCalledTimes(1);
      expect(mockPrompt).toHaveBeenCalledTimes(1);
      expect(capturedSplitItemSelectorParams?.targetParentFolderOverride).toBe(chosenFolder);
      expect(capturedSplitItemSelectorParams?.inputValue).toBe('typed name');
      expect(capturedSplitItemSelectorParams?.splitTargetMode).toBe(SplitTargetMode.Create);
    });

    it('should abandon the split when the folder prompt is dismissed', async () => {
      mockSelectFolder.mockResolvedValue(null);
      const sourceFile = createMockFile('folder/source.md');
      const editor = createMockEditor();
      const resourceLockComponent = createMockResourceLockComponent();
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        shouldAskBeforeSplitting: false,
        shouldChooseFolderBeforeNameWhenSplitting: true
      });

      const result = await prepareForSplitFile({ app, editor, pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, sourceFile });

      // Unlike the issue-#238 prompt, there is no picker to fall back to — these two prompts ARE the flow.
      expect(result).toBeNull();
      expect(mockPrompt).not.toHaveBeenCalled();
    });

    it('should abandon the split when the name prompt is dismissed', async () => {
      mockSelectFolder.mockResolvedValue(chosenFolder);
      mockPrompt.mockResolvedValue(null);
      const sourceFile = createMockFile('folder/source.md');
      const editor = createMockEditor();
      const resourceLockComponent = createMockResourceLockComponent();
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        shouldAskBeforeSplitting: false,
        shouldChooseFolderBeforeNameWhenSplitting: true
      });

      const result = await prepareForSplitFile({ app, editor, pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, sourceFile });

      expect(result).toBeNull();
    });

    it('should stay out of the way of a merge default', async () => {
      // The switch lives in the picker this replaces, so a pass that skipped it could not be switched.
      shouldAutoSelect = true;
      const sourceFile = createMockFile('folder/source.md');
      const editor = createMockEditor();
      const resourceLockComponent = createMockResourceLockComponent();
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        defaultSplitTargetMode: SplitTargetMode.Merge,
        shouldAskBeforeSplitting: false,
        shouldChooseFolderBeforeNameWhenSplitting: true
      });

      const promise = prepareForSplitFile({ app, editor, pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, sourceFile });
      await vi.advanceTimersByTimeAsync(0);
      const result = await promise;

      expect(result).not.toBeNull();
      expect(mockSelectFolder).not.toHaveBeenCalled();
      expect(mockPrompt).not.toHaveBeenCalled();
      expect(mockOpenMinimizableModal.mock.calls.length).toBeGreaterThan(0);
    });

    it('should stay out of the way of a heading-driven split', async () => {
      const sourceFile = createMockFile('folder/source.md');
      const editor = createMockEditor();
      const resourceLockComponent = createMockResourceLockComponent();
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        shouldAskBeforeSplitting: false,
        shouldChooseFolderBeforeNameWhenSplitting: true
      });

      const result = await prepareForSplitFile({ app, editor, heading: 'Heading', pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, shouldSkipModal: true, sourceFile });

      // That pass has both answers already; growing two prompts would be a regression of issue #143.
      expect(result).not.toBeNull();
      expect(mockSelectFolder).not.toHaveBeenCalled();
      expect(mockPrompt).not.toHaveBeenCalled();
    });
  });

  describe('remembering the last split target mode (issues #245, #264)', () => {
    // What the picker WROTE, by replaying the `editAndSave` callback against a settings stand-in. The
    // Component mock resolves without applying the edit, so the value has to be read out of the callback.
    async function applyRememberedMode(pluginSettingsComponent: PluginSettingsComponent): Promise<SplitTargetMode | undefined> {
      const editAndSave = vi.mocked(pluginSettingsComponent.editAndSave);
      const editor = editAndSave.mock.calls[0]?.[0];
      if (!editor) {
        return undefined;
      }
      const settingsToEdit = { defaultSplitTargetMode: SplitTargetMode.Create };
      await editor(castTo<PluginSettings>(settingsToEdit));
      return settingsToEdit.defaultSplitTargetMode;
    }

    it('should save the mode the target was chosen in', async () => {
      shouldAutoSelect = true;
      const sourceFile = createMockFile('folder/source.md');
      const editor = createMockEditor();
      const resourceLockComponent = createMockResourceLockComponent();
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        defaultSplitTargetMode: SplitTargetMode.Merge
      });

      const promise = prepareForSplitFile({ app, editor, pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, sourceFile });
      await vi.advanceTimersByTimeAsync(0);
      const result = await promise;

      expect(result).not.toBeNull();
      expect(pluginSettingsComponent.editAndSave).toHaveBeenCalledTimes(1);
      expect(await applyRememberedMode(pluginSettingsComponent)).toBe(SplitTargetMode.Merge);
    });

    it('should save nothing when the picker never opened', async () => {
      // A heading-driven split SYNTHESIZES `Create` for its heading-named note without ever showing a
      // Switch, so saving it would reset a `Merge` default from a screen the user never saw.
      const sourceFile = createMockFile('folder/source.md');
      const editor = createMockEditor();
      const resourceLockComponent = createMockResourceLockComponent();
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        defaultSplitTargetMode: SplitTargetMode.Merge
      });

      const result = await prepareForSplitFile({
        app,
        editor,
        heading: 'Heading',
        pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent,
        shouldSkipModal: true,
        sourceFile
      });

      expect(result).not.toBeNull();
      expect(pluginSettingsComponent.editAndSave).not.toHaveBeenCalled();
    });

    it('should save nothing when the flow cannot merge at all', async () => {
      // `Create empty note at cursor...` forces `Create` because it has nothing to merge (issue #244).
      // That is the flow's constraint, not the user's answer, so it must not overwrite their `Merge`.
      shouldAutoSelect = true;
      const sourceFile = createMockFile('folder/source.md');
      const editor = createMockEditor();
      const resourceLockComponent = createMockResourceLockComponent();
      const app = createMockApp();
      const pluginSettingsComponent = createMockPluginSettingsComponent({
        defaultSplitTargetMode: SplitTargetMode.Merge
      });

      const promise = prepareForSplitFile({
        app,
        canMergeIntoExistingNote: false,
        editor,
        pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent,
        sourceFile
      });
      await vi.advanceTimersByTimeAsync(0);
      const result = await promise;

      expect(result).not.toBeNull();
      expect(capturedSplitItemSelectorParams?.splitTargetMode).toBe(SplitTargetMode.Create);
      expect(pluginSettingsComponent.editAndSave).not.toHaveBeenCalled();
    });
  });

  it('should cancel and unlock when the lock is aborted while the modal is open', async () => {
    const sourceFile = createMockFile('folder/source.md');
    const editor = createMockEditor();
    const resourceLockComponent = createMockResourceLockComponent();
    const app = createMockApp();
    const pluginSettingsComponent = createMockPluginSettingsComponent();

    const promise = prepareForSplitFile({ app, editor, pluginNoticeComponent, pluginSettingsComponent, resourceLockComponent, sourceFile });
    // Simulate the user unlocking: abort the controller the lock was registered with.
    const abortController = vi.mocked(resourceLockComponent.lockForPath).mock.calls[0]?.[0]?.abortController;
    expect(abortController).toBeInstanceOf(AbortController);
    abortController?.abort();
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;
    expect(result).toBeNull();
    expect(resourceLockComponent.unlockForPath).toHaveBeenCalledWith(sourceFile);
  });
});
