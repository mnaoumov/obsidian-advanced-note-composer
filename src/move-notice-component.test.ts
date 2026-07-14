import type {
  App as AppOriginal,
  Notice
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

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

import type { CancelMoveCommandHandler } from './command-handlers/cancel-move-command-handler.ts';
import type { MoveMarkedSelectionEditorCommandHandlerBase } from './command-handlers/move-marked-selection-editor-command-handler-base.ts';
import type { MarkedSelection } from './move-selection-buffer.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';

import { MoveNoticeComponent } from './move-notice-component.ts';
import { MoveSelectionBuffer } from './move-selection-buffer.ts';
import { PluginSettings } from './plugin-settings.ts';

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

function createHandler(canExecute: boolean): MoveMarkedSelectionEditorCommandHandlerBase {
  return strictProxy<MoveMarkedSelectionEditorCommandHandlerBase>({
    canExecuteInActiveEditor: vi.fn().mockReturnValue(canExecute),
    executeInActiveEditor: vi.fn().mockResolvedValue(undefined)
  });
}

function createMarkedSelection(): MarkedSelection {
  return strictProxy<MarkedSelection>({
    capturedSelections: [{ endOffset: 3, startOffset: 1 }],
    selectedText: 'x'
  });
}

let app: AppOriginal;
let cancelMoveCommandHandler: CancelMoveCommandHandler;
let moveSelectionBuffer: MoveSelectionBuffer;
let moveAtCursorHandler: MoveMarkedSelectionEditorCommandHandlerBase;
let moveToBottomHandler: MoveMarkedSelectionEditorCommandHandlerBase;
let moveToTopHandler: MoveMarkedSelectionEditorCommandHandlerBase;
let notice: Notice;
let capturedMessage: DocumentFragment | null | string;
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
  notice = strictProxy<Notice>({ hide: vi.fn() });
  capturedMessage = null;
  pluginNoticeComponent = strictProxy<PluginNoticeComponent>({
    showNotice: vi.fn().mockImplementation((message: DocumentFragment | string) => {
      capturedMessage = message;
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
    pluginSettingsComponent
  });
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

describe('MoveNoticeComponent', () => {
  it('shows a permanent notice with the three move buttons plus Cancel move', () => {
    const shownNotice = component.showNotice();

    expect(shownNotice).toBe(notice);
    expect(pluginNoticeComponent.showNotice).toHaveBeenCalledWith(expect.anything(), { isPermanent: true });

    const fragment = castTo<DocumentFragment>(capturedMessage);
    const labels = [...fragment.querySelectorAll('button')].map((buttonEl) => buttonEl.textContent);
    expect(labels).toEqual([
      'Move marked selection to top of file',
      'Move marked selection to bottom of file',
      'Move marked selection at cursor',
      'Cancel move'
    ]);
  });

  it('enables each move button only when its command can run, and keeps Cancel move enabled', () => {
    component.showNotice();
    moveSelectionBuffer.mark(createMarkedSelection());
    component.refreshButtons();

    const buttons = getButtons();
    expect(buttons[0]?.component.disabled).toBe(false);
    expect(buttons[1]?.component.disabled).toBe(true);
    expect(buttons[2]?.component.disabled).toBe(false);
    // Cancel move has no enablement predicate, so it is never disabled.
    expect(buttons[3]?.component.disabled).toBe(false);
  });

  it('drops the buttons and does nothing when nothing is marked', () => {
    component.showNotice();
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
    component.showNotice();
    moveSelectionBuffer.mark(createMarkedSelection());
    vi.mocked(moveToTopHandler.canExecuteInActiveEditor).mockClear();

    app.workspace.trigger('active-leaf-change', null);

    expect(vi.mocked(moveToTopHandler.canExecuteInActiveEditor)).toHaveBeenCalled();
  });

  it('refreshes button state when the editor selection changes', () => {
    component.showNotice();
    moveSelectionBuffer.mark(createMarkedSelection());
    vi.mocked(moveToTopHandler.canExecuteInActiveEditor).mockClear();

    activeDocument.dispatchEvent(new Event('selectionchange'));

    expect(vi.mocked(moveToTopHandler.canExecuteInActiveEditor)).toHaveBeenCalled();
  });

  it('runs the corresponding command when a move button is clicked', () => {
    component.showNotice();
    const buttons = getButtons();
    buttons[0]?.component.simulateClick__();
    buttons[1]?.component.simulateClick__();
    buttons[2]?.component.simulateClick__();
    expect(vi.mocked(moveToTopHandler.executeInActiveEditor)).toHaveBeenCalledOnce();
    expect(vi.mocked(moveToBottomHandler.executeInActiveEditor)).toHaveBeenCalledOnce();
    expect(vi.mocked(moveAtCursorHandler.executeInActiveEditor)).toHaveBeenCalledOnce();
  });

  it('cancels the move when the Cancel move button is clicked', () => {
    component.showNotice();
    getButtons()[3]?.component.simulateClick__();
    expect(vi.mocked(cancelMoveCommandHandler.cancelMove)).toHaveBeenCalledOnce();
  });

  it('hides the top button when shouldShowMoveToTopButton is off, keeping the rest', () => {
    pluginSettings.shouldShowMoveToTopButton = false;
    component.showNotice();
    expect(getButtonLabels()).toEqual([
      'Move marked selection to bottom of file',
      'Move marked selection at cursor',
      'Cancel move'
    ]);
  });

  it('hides the bottom button when shouldShowMoveToBottomButton is off, keeping the rest', () => {
    pluginSettings.shouldShowMoveToBottomButton = false;
    component.showNotice();
    expect(getButtonLabels()).toEqual([
      'Move marked selection to top of file',
      'Move marked selection at cursor',
      'Cancel move'
    ]);
  });

  it('hides the at-cursor button when shouldShowMoveAtCursorButton is off, keeping the rest', () => {
    pluginSettings.shouldShowMoveAtCursorButton = false;
    component.showNotice();
    expect(getButtonLabels()).toEqual([
      'Move marked selection to top of file',
      'Move marked selection to bottom of file',
      'Cancel move'
    ]);
  });

  it('shows only Cancel move when all three move buttons are off', () => {
    pluginSettings.shouldShowMoveToTopButton = false;
    pluginSettings.shouldShowMoveToBottomButton = false;
    pluginSettings.shouldShowMoveAtCursorButton = false;
    component.showNotice();
    expect(getButtonLabels()).toEqual(['Cancel move']);
  });

  it('shows no notice and returns null when shouldShowSmartCutNotice is off', () => {
    pluginSettings.shouldShowSmartCutNotice = false;

    const shownNotice = component.showNotice();

    expect(shownNotice).toBeNull();
    expect(pluginNoticeComponent.showNotice).not.toHaveBeenCalled();
    expect(castTo<TestableComponent>(component).buttons).toBeNull();
  });
});

function getButtonLabels(): (null | string)[] {
  const fragment = castTo<DocumentFragment>(capturedMessage);
  return [...fragment.querySelectorAll('button')].map((buttonEl) => buttonEl.textContent);
}
