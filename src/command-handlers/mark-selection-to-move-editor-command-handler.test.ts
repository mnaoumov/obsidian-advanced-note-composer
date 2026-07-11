import type {
  App,
  Editor,
  MarkdownFileInfo,
  Notice,
  TFile,
  TFolder,
  Vault
} from 'obsidian';
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

import type { Selection } from '../composers/composer-base.ts';
import type { MoveNoticeComponent } from '../move-notice-component.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';
import type { SelectionHighlightComponent } from '../selection-highlight-component.ts';

import { getSelections } from '../composers/split-composer.ts';
import { MoveSelectionBuffer } from '../move-selection-buffer.ts';
import { MarkSelectionToMoveEditorCommandHandler } from './mark-selection-to-move-editor-command-handler.ts';

interface TestableHandler {
  canExecuteEditor(editor: Editor): boolean;
  executeEditor(editor: Editor, ctx: MarkdownFileInfo): Promise<void>;
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

vi.mock('../composers/split-composer.ts', () => ({
  getSelections: vi.fn()
}));

const mockCreateFragmentAsync = vi.mocked(createFragmentAsync);
const mockRenderInternalLink = vi.mocked(renderInternalLink);
const mockGetSelections = vi.mocked(getSelections);

const CAPTURED_SELECTIONS: Selection[] = [{ endOffset: 12, startOffset: 5 }];

interface HandlerParams {
  readonly app: App;
  readonly moveNoticeComponent: MoveNoticeComponent;
  readonly moveSelectionBuffer: MoveSelectionBuffer;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
  readonly selectionHighlightComponent: SelectionHighlightComponent;
}

const MOCK_NOTICE: Notice = strictProxy<Notice>({ hide: vi.fn() });

function createMockCtx(file: null | TFile): MarkdownFileInfo {
  return strictProxy<MarkdownFileInfo>({ file });
}

function createMockEditor(hasSomethingSelected = true): Editor {
  return strictProxy<Editor>({
    getSelection: vi.fn().mockReturnValue('marked text'),
    somethingSelected: vi.fn().mockReturnValue(hasSomethingSelected)
  });
}

function createMockFile(mtime = 1000): TFile {
  return strictProxy<TFile>({
    path: 'source.md',
    stat: strictProxy({ mtime })
  });
}

const ROOT_FOLDER = strictProxy<TFolder>({ path: '/' });

function createMockParams(isPathIgnored = false, shouldAddCommandsToSubmenu = true, shouldLockAllNotesWhenMarkingSelection = false): HandlerParams {
  return {
    app: strictProxy<App>({
      vault: strictProxy<Vault>({
        getRoot: vi.fn().mockReturnValue(ROOT_FOLDER)
      })
    }),
    moveNoticeComponent: strictProxy<MoveNoticeComponent>({
      refreshButtons: vi.fn(),
      showNotice: vi.fn().mockReturnValue(MOCK_NOTICE)
    }),
    moveSelectionBuffer: new MoveSelectionBuffer(),
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice: vi.fn().mockReturnValue({ hide: vi.fn() }) }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        isPathIgnored: vi.fn().mockReturnValue(isPathIgnored),
        shouldAddCommandsToSubmenu,
        shouldLockAllNotesWhenMarkingSelection
      })
    }),
    resourceLockComponent: strictProxy<ResourceLockComponent>({
      lockForPath: vi.fn().mockReturnValue({ [Symbol.dispose]: vi.fn() })
    }),
    selectionHighlightComponent: strictProxy<SelectionHighlightComponent>({
      addHighlight: vi.fn().mockReturnValue({ [Symbol.dispose]: vi.fn() })
    })
  };
}

function toTestable(handler: MarkSelectionToMoveEditorCommandHandler): TestableHandler {
  return castTo<TestableHandler>(handler);
}

describe('MarkSelectionToMoveEditorCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSelections.mockReturnValue(CAPTURED_SELECTIONS);
  });

  it('should construct with correct params', () => {
    const handler = toTestable(new MarkSelectionToMoveEditorCommandHandler(createMockParams()));
    expect(handler.id).toBe('mark-selection-to-move');
    expect(handler.name).toBe('Smart cut & paste: Mark selection to move');
    expect(handler.icon).toBe('lucide-scissors');
  });

  it('should be available only when something is selected', () => {
    const handler = toTestable(new MarkSelectionToMoveEditorCommandHandler(createMockParams()));
    expect(handler.canExecuteEditor(createMockEditor(true))).toBe(true);
    expect(handler.canExecuteEditor(createMockEditor(false))).toBe(false);
  });

  it('should return early and not mark when ctx.file is null', async () => {
    const params = createMockParams();
    const handler = toTestable(new MarkSelectionToMoveEditorCommandHandler(params));

    await handler.executeEditor(createMockEditor(), createMockCtx(null));

    expect(params.moveSelectionBuffer.hasMark()).toBe(false);
    expect(params.resourceLockComponent.lockForPath).not.toHaveBeenCalled();
  });

  it('should show a notice and not mark when the path is ignored', async () => {
    const params = createMockParams(true);
    const handler = toTestable(new MarkSelectionToMoveEditorCommandHandler(params));

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
    expect(params.moveSelectionBuffer.hasMark()).toBe(false);
    expect(params.resourceLockComponent.lockForPath).not.toHaveBeenCalled();
  });

  it('should lock the source, mark the selection, and show a notice on the happy path', async () => {
    const params = createMockParams(false);
    const handler = toTestable(new MarkSelectionToMoveEditorCommandHandler(params));
    const file = createMockFile(2000);

    await handler.executeEditor(createMockEditor(), createMockCtx(file));

    expect(params.resourceLockComponent.lockForPath).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ mode: 'file', shouldBlockMutations: true })
    );
    const marked = params.moveSelectionBuffer.get();
    expect(marked).not.toBeNull();
    expect(marked?.capturedSelections).toBe(CAPTURED_SELECTIONS);
    expect(marked?.selectedText).toBe('marked text');
    expect(marked?.sourceFile).toBe(file);
    expect(marked?.sourceMtime).toBe(2000);
    expect(marked?.notice).toBe(MOCK_NOTICE);
    expect(params.moveNoticeComponent.showNotice).toHaveBeenCalled();
  });

  it('should subtree-lock the vault root when shouldLockAllNotesWhenMarkingSelection is on', async () => {
    const params = createMockParams(false, true, true);
    const handler = toTestable(new MarkSelectionToMoveEditorCommandHandler(params));
    const file = createMockFile(2000);

    await handler.executeEditor(createMockEditor(), createMockCtx(file));

    expect(params.resourceLockComponent.lockForPath).toHaveBeenCalledWith(
      ROOT_FOLDER.path,
      expect.objectContaining({ mode: 'subtree', shouldBlockMutations: true })
    );
    expect(params.moveSelectionBuffer.get()?.sourceFile).toBe(file);
  });

  it('should cancel the whole move when the held lock is aborted', async () => {
    const params = createMockParams(false);
    const handler = toTestable(new MarkSelectionToMoveEditorCommandHandler(params));

    await handler.executeEditor(createMockEditor(), createMockCtx(createMockFile()));

    const marked = params.moveSelectionBuffer.get();
    expect(marked).not.toBeNull();

    marked?.abortController.abort();

    expect(params.moveSelectionBuffer.hasMark()).toBe(false);
    expect(marked?.notice.hide).toHaveBeenCalled();
  });

  it('should not let a stale aborted controller cancel a subsequently marked selection', async () => {
    const params = createMockParams(false);
    const handler = toTestable(new MarkSelectionToMoveEditorCommandHandler(params));

    await handler.executeEditor(createMockEditor(), createMockCtx(createMockFile(1000)));
    const staleController = params.moveSelectionBuffer.get()?.abortController;

    const fileB = createMockFile(2000);
    await handler.executeEditor(createMockEditor(), createMockCtx(fileB));

    staleController?.abort();

    expect(params.moveSelectionBuffer.hasMark()).toBe(true);
    expect(params.moveSelectionBuffer.get()?.sourceFile).toBe(fileB);
  });

  it('should add to the editor menu', () => {
    const handler = toTestable(new MarkSelectionToMoveEditorCommandHandler(createMockParams()));
    expect(handler.shouldAddToEditorMenu()).toBe(true);
  });

  it('should reflect the submenu setting', () => {
    expect(toTestable(new MarkSelectionToMoveEditorCommandHandler(createMockParams(false, true))).shouldAddCommandToSubmenu()).toBe(true);
    expect(toTestable(new MarkSelectionToMoveEditorCommandHandler(createMockParams(false, false))).shouldAddCommandToSubmenu()).toBe(false);
  });
});
