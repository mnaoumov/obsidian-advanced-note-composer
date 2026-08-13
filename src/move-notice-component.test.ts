import type {
  App as AppOriginal,
  CachedMetadata,
  Editor,
  HeadingCache,
  MarkdownView,
  Notice,
  TFile,
  WorkspaceLeaf
} from 'obsidian';
import type {
  PluginNoticeComponent,
  PluginNoticeComponentShowNoticeOptions
} from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { waitForAllAsyncOperations } from 'obsidian-dev-utils/async';
import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { ActiveEditorCommandHandlerBase } from './command-handlers/active-editor-command-handler-base.ts';
import type { CancelMoveCommandHandler } from './command-handlers/cancel-move-command-handler.ts';
import type { MoveMarkedSelectionEditorCommandHandlerBase } from './command-handlers/move-marked-selection-editor-command-handler-base.ts';
import type { OpenSplitModalCommandHandler } from './command-handlers/open-split-modal-command-handler.ts';
import type { SwapMarkedSelectionEditorCommandHandler } from './command-handlers/swap-marked-selection-editor-command-handler.ts';
import type {
  MarkedHeading,
  MarkedSelection
} from './move-selection-buffer.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import { MoveNoticeComponent } from './move-notice-component.ts';
import { MoveSelectionBuffer } from './move-selection-buffer.ts';
import { PluginSettings } from './plugin-settings.ts';

const MARKED_HEADING_LINE = 6;
const MARKED_HEADING: MarkedHeading = { line: MARKED_HEADING_LINE, text: 'Marked heading' };
const SOURCE_FILE: TFile = strictProxy<TFile>({ path: 'source.md' });

interface TestableComponent {
  readonly buttons: null | TestButton[];
}

interface TestButton {
  readonly component: TestButtonComponent;
}

interface TestButtonComponent {
  readonly buttonEl: HTMLButtonElement;
  readonly disabled: boolean;
  simulateClick__(): void;
}

function createActiveEditorHandler(): ActiveEditorCommandHandlerBase {
  return strictProxy<ActiveEditorCommandHandlerBase>({
    canExecuteInActiveEditor: vi.fn().mockReturnValue(true),
    executeInActiveEditor: vi.fn().mockResolvedValue(undefined)
  });
}

function createHandler(canExecute: boolean): MoveMarkedSelectionEditorCommandHandlerBase {
  return strictProxy<MoveMarkedSelectionEditorCommandHandlerBase>({
    canExecuteInActiveEditor: vi.fn().mockReturnValue(canExecute),
    executeInActiveEditor: vi.fn().mockResolvedValue(undefined)
  });
}

function createMarkedHeadingSelection(): MarkedSelection {
  return strictProxy<MarkedSelection>({
    capturedSelections: [{ endOffset: 30, startOffset: 10 }],
    highlight: { [Symbol.dispose]: vi.fn() },
    lock: { [Symbol.dispose]: vi.fn() },
    markedHeading: { line: MARKED_HEADING_LINE, text: 'Marked heading' },
    notice: strictProxy<Notice>({ hide: vi.fn() }),
    selectedText: '## Marked heading',
    sourceFile: strictProxy<TFile>({ path: 'source.md' })
  });
}

function createMarkedSelection(): MarkedSelection {
  return strictProxy<MarkedSelection>({
    capturedSelections: [{ endOffset: 3, startOffset: 1 }],
    markedHeading: null,
    selectedText: 'x'
  });
}

function createSwapHandler(canExecute: boolean): SwapMarkedSelectionEditorCommandHandler {
  return strictProxy<SwapMarkedSelectionEditorCommandHandler>({
    canExecuteInActiveEditor: vi.fn().mockReturnValue(canExecute),
    executeInActiveEditor: vi.fn().mockResolvedValue(undefined)
  });
}

/**
 * Stubs the active markdown view the heading handoff re-opens the marked note into, so the notice's
 * heading-only buttons reach their handler the way they do in Obsidian.
 *
 * @param viewFile - The file the active view shows, or `null` for no active markdown view at all.
 * @returns The stubbed editor.
 */
function stubActiveSourceEditor(viewFile: null | TFile = SOURCE_FILE): Editor {
  const editor = strictProxy<Editor>({ setCursor: vi.fn() });
  vi.spyOn(app.vault, 'getFileByPath').mockReturnValue(SOURCE_FILE);
  vi.spyOn(app.workspace, 'getLeaf').mockReturnValue(
    strictProxy<WorkspaceLeaf>({ openFile: vi.fn().mockResolvedValue(undefined) })
  );
  vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(
    viewFile === null ? null : strictProxy<MarkdownView>({ editor, file: viewFile })
  );
  return editor;
}

function stubHeadings(headings: HeadingCache[]): void {
  vi.spyOn(app.metadataCache, 'getFileCache').mockReturnValue(strictProxy<CachedMetadata>({ headings }));
}

let app: AppOriginal;
let cancelMoveCommandHandler: CancelMoveCommandHandler;
let moveSelectionBuffer: MoveSelectionBuffer;
let moveAtCursorHandler: MoveMarkedSelectionEditorCommandHandlerBase;
let moveToBottomHandler: MoveMarkedSelectionEditorCommandHandlerBase;
let moveToTopHandler: MoveMarkedSelectionEditorCommandHandlerBase;
let openSplitModalCommandHandler: OpenSplitModalCommandHandler;
let reorderHeadingsHandler: ActiveEditorCommandHandlerBase;
let splitHeadingRecursivelyHandler: ActiveEditorCommandHandlerBase;
let swapMarkedSelectionHandler: SwapMarkedSelectionEditorCommandHandler;
let notice: Notice;
let capturedMessage: DocumentFragment | null | string;
let capturedOptions: PluginNoticeComponentShowNoticeOptions | undefined;
let pluginNoticeComponent: PluginNoticeComponent;
let pluginSettings: PluginSettings;
let pluginSettingsComponent: PluginSettingsComponent;
let component: MoveNoticeComponent;

beforeEach(() => {
  app = App.createConfigured__({}).asOriginalType__();
  moveSelectionBuffer = new MoveSelectionBuffer();
  moveToTopHandler = createHandler(true);
  moveToBottomHandler = createHandler(false);
  moveAtCursorHandler = createHandler(true);
  cancelMoveCommandHandler = strictProxy<CancelMoveCommandHandler>({
    cancelMove: vi.fn()
  });
  openSplitModalCommandHandler = strictProxy<OpenSplitModalCommandHandler>({
    openSplitModal: vi.fn().mockResolvedValue(undefined)
  });
  reorderHeadingsHandler = createActiveEditorHandler();
  splitHeadingRecursivelyHandler = createActiveEditorHandler();
  swapMarkedSelectionHandler = createSwapHandler(true);
  notice = strictProxy<Notice>({ hide: vi.fn() });
  capturedMessage = null;
  capturedOptions = undefined;
  pluginNoticeComponent = strictProxy<PluginNoticeComponent>({
    showNotice: vi.fn<PluginNoticeComponent['showNotice']>().mockImplementation((message, options) => {
      capturedMessage = message;
      capturedOptions = options;
      return notice;
    })
  });
  pluginSettings = new PluginSettings();
  pluginSettingsComponent = strictProxy<PluginSettingsComponent>({
    get settings(): PluginSettings {
      return pluginSettings;
    }
  });
  component = new MoveNoticeComponent({
    app,
    cancelMoveCommandHandler,
    moveAtCursorHandler,
    moveSelectionBuffer,
    moveToBottomHandler,
    moveToTopHandler,
    pluginNoticeComponent,
    pluginSettingsComponent,
    reorderHeadingsHandler,
    splitHeadingRecursivelyHandler,
    swapMarkedSelectionHandler
  });
  component.setOpenSplitModalCommandHandler(openSplitModalCommandHandler);
  component.load();
});

afterEach(() => {
  component.unload();
  vi.restoreAllMocks();
});

function getButtons(): TestButton[] {
  const buttons = castTo<TestableComponent>(component).buttons;
  expect(buttons).not.toBeNull();
  return buttons ?? [];
}

/**
 * Shows the notice for a HEADING mark, the way `markSelectionToMove` does — with the heading passed in,
 * since the notice is built before the mark reaches the buffer.
 */
function showHeadingNotice(): void {
  component.showNotice({ markedHeading: MARKED_HEADING, sourceFile: SOURCE_FILE });
}

/**
 * Shows the notice for a plain selection mark.
 *
 * @returns The shown notice, or `null` when the notice is disabled via settings.
 */
function showPlainNotice(): Notice | null {
  return component.showNotice({ markedHeading: null, sourceFile: SOURCE_FILE });
}

describe('MoveNoticeComponent', () => {
  it('shows a non-dismissable notice with the Switch to split/extract button, the three move buttons, plus Cancel move', () => {
    const shownNotice = showPlainNotice();

    expect(shownNotice).toBe(notice);
    // Exact equality, not `toMatchObject`: the ABSENCE of `isPermanent` is the assertion. Combined with
    // `shouldHideOnClick: false` it throws in dev-utils 93, since that mode is `Separate` and a permanent
    // Notice needs the shared slot.
    expect(capturedOptions).toEqual({
      shouldHideOnClick: false,
      shouldShowCloseButton: false
    });

    const fragment = castTo<DocumentFragment>(capturedMessage);
    const labels = [...fragment.querySelectorAll('button')].map((buttonEl) => buttonEl.textContent);
    expect(labels).toEqual([
      'Switch to split/extract',
      'Move marked selection to top of file',
      'Move marked selection to bottom of file',
      'Move marked selection at cursor',
      'Swap with selection',
      'Cancel move'
    ]);
  });

  it('enables each move button only when its command can run, and keeps the always-on buttons enabled', () => {
    showPlainNotice();
    moveSelectionBuffer.mark(createMarkedSelection());
    component.refreshButtons();

    const buttons = getButtons();
    // Switch to split/extract has no enablement predicate, so it is never disabled.
    expect(buttons[0]?.component.disabled).toBe(false);
    expect(buttons[1]?.component.disabled).toBe(false);
    expect(buttons[2]?.component.disabled).toBe(true);
    expect(buttons[3]?.component.disabled).toBe(false);
    // Swap with selection is enabled while its handler reports it can run against the active editor.
    expect(buttons[4]?.component.disabled).toBe(false);
    // Cancel move has no enablement predicate, so it is never disabled.
    expect(buttons[5]?.component.disabled).toBe(false);
  });

  it('disables the Swap with selection button when its handler cannot run against the active editor', () => {
    swapMarkedSelectionHandler = createSwapHandler(false);
    component.unload();
    component = new MoveNoticeComponent({
      app,
      cancelMoveCommandHandler,
      moveAtCursorHandler,
      moveSelectionBuffer,
      moveToBottomHandler,
      moveToTopHandler,
      pluginNoticeComponent,
      pluginSettingsComponent,
      reorderHeadingsHandler,
      splitHeadingRecursivelyHandler,
      swapMarkedSelectionHandler
    });
    component.setOpenSplitModalCommandHandler(openSplitModalCommandHandler);
    component.load();

    showPlainNotice();
    moveSelectionBuffer.mark(createMarkedSelection());
    component.refreshButtons();

    expect(getButtons()[4]?.component.disabled).toBe(true);
  });

  it('drops the buttons and does nothing when nothing is marked', () => {
    showPlainNotice();
    // Nothing marked: refresh clears the stale button references without touching a command.
    component.refreshButtons();

    expect(castTo<TestableComponent>(component).buttons).toBeNull();
    expect(vi.mocked(moveToTopHandler.canExecuteInActiveEditor)).not.toHaveBeenCalled();
  });

  it('does nothing on refresh when a selection is marked but the notice was never shown', () => {
    // A mark exists but showNotice() was not called, so there are no buttons to update yet.
    moveSelectionBuffer.mark(createMarkedSelection());
    component.refreshButtons();

    expect(vi.mocked(moveToTopHandler.canExecuteInActiveEditor)).not.toHaveBeenCalled();
  });

  it('refreshes button state when the active leaf changes', () => {
    showPlainNotice();
    moveSelectionBuffer.mark(createMarkedSelection());
    vi.mocked(moveToTopHandler.canExecuteInActiveEditor).mockClear();

    app.workspace.trigger('active-leaf-change', null);

    expect(vi.mocked(moveToTopHandler.canExecuteInActiveEditor)).toHaveBeenCalled();
  });

  it('refreshes button state when the editor selection changes', () => {
    showPlainNotice();
    moveSelectionBuffer.mark(createMarkedSelection());
    vi.mocked(moveToTopHandler.canExecuteInActiveEditor).mockClear();

    activeDocument.dispatchEvent(new Event('selectionchange'));

    expect(vi.mocked(moveToTopHandler.canExecuteInActiveEditor)).toHaveBeenCalled();
  });

  it('opens the split/extract flow when the Switch to split/extract button is clicked', () => {
    showPlainNotice();
    getButtons()[0]?.component.simulateClick__();
    expect(vi.mocked(openSplitModalCommandHandler.openSplitModal)).toHaveBeenCalledOnce();
  });

  it('runs the corresponding command when a move button is clicked', () => {
    showPlainNotice();
    const buttons = getButtons();
    buttons[1]?.component.simulateClick__();
    buttons[2]?.component.simulateClick__();
    buttons[3]?.component.simulateClick__();
    expect(vi.mocked(moveToTopHandler.executeInActiveEditor)).toHaveBeenCalledOnce();
    expect(vi.mocked(moveToBottomHandler.executeInActiveEditor)).toHaveBeenCalledOnce();
    expect(vi.mocked(moveAtCursorHandler.executeInActiveEditor)).toHaveBeenCalledOnce();
  });

  it('runs the swap when the Swap with selection button is clicked', () => {
    showPlainNotice();
    getButtons()[4]?.component.simulateClick__();
    expect(vi.mocked(swapMarkedSelectionHandler.executeInActiveEditor)).toHaveBeenCalledOnce();
  });

  it('cancels the move when the Cancel move button is clicked', () => {
    showPlainNotice();
    getButtons()[5]?.component.simulateClick__();
    expect(vi.mocked(cancelMoveCommandHandler.cancelMove)).toHaveBeenCalledOnce();
  });

  it('hides the top button when shouldShowMoveToTopButton is off, keeping the rest', () => {
    pluginSettings.shouldShowMoveToTopButton = false;
    showPlainNotice();
    expect(getButtonLabels()).toEqual([
      'Switch to split/extract',
      'Move marked selection to bottom of file',
      'Move marked selection at cursor',
      'Swap with selection',
      'Cancel move'
    ]);
  });

  it('hides the bottom button when shouldShowMoveToBottomButton is off, keeping the rest', () => {
    pluginSettings.shouldShowMoveToBottomButton = false;
    showPlainNotice();
    expect(getButtonLabels()).toEqual([
      'Switch to split/extract',
      'Move marked selection to top of file',
      'Move marked selection at cursor',
      'Swap with selection',
      'Cancel move'
    ]);
  });

  it('hides the at-cursor button when shouldShowMoveAtCursorButton is off, keeping the rest', () => {
    pluginSettings.shouldShowMoveAtCursorButton = false;
    showPlainNotice();
    expect(getButtonLabels()).toEqual([
      'Switch to split/extract',
      'Move marked selection to top of file',
      'Move marked selection to bottom of file',
      'Swap with selection',
      'Cancel move'
    ]);
  });

  it('shows the reverse switch and Cancel move when all three move buttons are off', () => {
    pluginSettings.shouldShowMoveToTopButton = false;
    pluginSettings.shouldShowMoveToBottomButton = false;
    pluginSettings.shouldShowMoveAtCursorButton = false;
    showPlainNotice();
    expect(getButtonLabels()).toEqual([
      'Switch to split/extract',
      'Swap with selection',
      'Cancel move'
    ]);
  });

  it('offers the two heading actions only while a heading is marked', () => {
    moveSelectionBuffer.mark(createMarkedHeadingSelection());
    showHeadingNotice();

    expect(getButtonLabels()).toEqual([
      'Switch to split/extract',
      'Move marked selection to top of file',
      'Move marked selection to bottom of file',
      'Move marked selection at cursor',
      'Split heading recursively...',
      'Reorder headings...',
      'Swap with selection',
      'Cancel move'
    ]);
  });

  it('hides the split heading button when shouldShowSplitHeadingRecursivelyButton is off', () => {
    pluginSettings.shouldShowSplitHeadingRecursivelyButton = false;
    moveSelectionBuffer.mark(createMarkedHeadingSelection());
    showHeadingNotice();

    expect(getButtonLabels()).not.toContain('Split heading recursively...');
    expect(getButtonLabels()).toContain('Reorder headings...');
  });

  it('hides the reorder headings button when shouldShowReorderHeadingsButton is off', () => {
    pluginSettings.shouldShowReorderHeadingsButton = false;
    moveSelectionBuffer.mark(createMarkedHeadingSelection());
    showHeadingNotice();

    expect(getButtonLabels()).toContain('Split heading recursively...');
    expect(getButtonLabels()).not.toContain('Reorder headings...');
  });

  it('enables the reorder headings button only while the MARKED note has reorderable siblings', () => {
    moveSelectionBuffer.mark(createMarkedHeadingSelection());
    showHeadingNotice();

    stubHeadings([castTo<HeadingCache>({ heading: 'Only one', level: 1, position: { start: { offset: 0 } } })]);
    component.refreshButtons();
    expect(getButtons()[5]?.component.disabled).toBe(true);

    stubHeadings([
      castTo<HeadingCache>({ heading: 'First', level: 1, position: { start: { offset: 0 } } }),
      castTo<HeadingCache>({ heading: 'Second', level: 1, position: { start: { offset: 10 } } })
    ]);
    component.refreshButtons();
    expect(getButtons()[5]?.component.disabled).toBe(false);
    // The split button has no predicate — a leaf heading is still a valid recursive split.
    expect(getButtons()[4]?.component.disabled).toBe(false);
  });

  it('falls back to no headings when the marked note has no metadata cache', () => {
    moveSelectionBuffer.mark(createMarkedHeadingSelection());
    showHeadingNotice();
    vi.spyOn(app.metadataCache, 'getFileCache').mockReturnValue(null);

    component.refreshButtons();

    expect(getButtons()[5]?.component.disabled).toBe(true);
  });

  it('releases the mark, re-opens the marked note on its heading, and runs the split when its button is clicked', async () => {
    moveSelectionBuffer.mark(createMarkedHeadingSelection());
    showHeadingNotice();
    const editor = stubActiveSourceEditor();

    getButtons()[4]?.component.simulateClick__();
    await waitForAllAsyncOperations();

    // The mark holds a mutation-blocking lock on the note the split rewrites, so the handoff has to
    // Release it first.
    expect(moveSelectionBuffer.hasMark()).toBe(false);
    expect(editor.setCursor).toHaveBeenCalledWith({ ch: 0, line: MARKED_HEADING_LINE });
    expect(vi.mocked(splitHeadingRecursivelyHandler.executeInActiveEditor)).toHaveBeenCalledOnce();
  });

  it('releases the mark and runs the reorder when its button is clicked', async () => {
    moveSelectionBuffer.mark(createMarkedHeadingSelection());
    showHeadingNotice();
    const editor = stubActiveSourceEditor();

    getButtons()[5]?.component.simulateClick__();
    await waitForAllAsyncOperations();

    expect(moveSelectionBuffer.hasMark()).toBe(false);
    expect(editor.setCursor).toHaveBeenCalledWith({ ch: 0, line: MARKED_HEADING_LINE });
    expect(vi.mocked(reorderHeadingsHandler.executeInActiveEditor)).toHaveBeenCalledOnce();
  });

  it('does nothing when a heading button is clicked after the mark was already released', async () => {
    moveSelectionBuffer.mark(createMarkedHeadingSelection());
    showHeadingNotice();
    const buttons = getButtons();
    moveSelectionBuffer.clear();

    buttons[4]?.component.simulateClick__();
    await waitForAllAsyncOperations();

    expect(vi.mocked(splitHeadingRecursivelyHandler.executeInActiveEditor)).not.toHaveBeenCalled();
  });

  it('does not run the handler when no markdown view becomes active', async () => {
    moveSelectionBuffer.mark(createMarkedHeadingSelection());
    showHeadingNotice();
    stubActiveSourceEditor(null);

    getButtons()[4]?.component.simulateClick__();
    await waitForAllAsyncOperations();

    expect(moveSelectionBuffer.hasMark()).toBe(false);
    expect(vi.mocked(splitHeadingRecursivelyHandler.executeInActiveEditor)).not.toHaveBeenCalled();
  });

  it('shows no notice and returns null when shouldShowSmartCutNotice is off', () => {
    pluginSettings.shouldShowSmartCutNotice = false;

    const shownNotice = showPlainNotice();

    expect(shownNotice).toBeNull();
    expect(pluginNoticeComponent.showNotice).not.toHaveBeenCalled();
    expect(castTo<TestableComponent>(component).buttons).toBeNull();
  });
});

function getButtonLabels(): (null | string)[] {
  const fragment = castTo<DocumentFragment>(capturedMessage);
  return [...fragment.querySelectorAll('button')].map((buttonEl) => buttonEl.textContent);
}
