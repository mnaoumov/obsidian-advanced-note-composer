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
import type { SelectionHighlightComponent } from '../selection-highlight-component.ts';
import type { SuggestModalBaseConstructorParams } from './suggest-modal-base.ts';

import { InsertMode } from '../insert-mode.ts';
import { MoveSelectionBuffer } from '../move-selection-buffer.ts';
import { NameTransformError } from '../name-transform.ts';
import { FrontmatterMergeStrategy } from '../plugin-settings.ts';
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
  }
  return { SuggestModalBase: MockSuggestModalBase };
});

vi.mock('../composers/split-composer.ts', () => ({
  getSelections: vi.fn().mockReturnValue([{ endOffset: 10, startOffset: 0 }])
}));

vi.mock('../headings.ts', () => ({
  extractHeading: vi.fn().mockReturnValue('Test Heading')
}));

interface MockPluginOptions {
  readonly shouldAllowOnlyCurrentFolderByDefault?: boolean;
  readonly shouldAskBeforeSplitting?: boolean;
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
  readonly shouldAllowOnlyCurrentFolder: boolean;
  readonly shouldForceSplitIntoFolder: boolean;
}

let capturedSplitItemSelectorParams: CapturedSplitItemSelectorParams | null = null;

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
      isPathIgnored: vi.fn().mockReturnValue(false),
      shouldAllowOnlyCurrentFolderByDefault: options?.shouldAllowOnlyCurrentFolderByDefault ?? false,
      shouldAllowSplitIntoUnresolvedPathByDefault: true,
      shouldAskBeforeSplitting,
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
