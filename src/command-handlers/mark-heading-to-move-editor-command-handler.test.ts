import type {
  App,
  Editor,
  EditorPosition,
  MarkdownFileInfo,
  Notice,
  TFile,
  TFolder,
  Vault
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type {
  ResourceLockComponent,
  ResourceLockComponentLockForPathParams
} from 'obsidian-dev-utils/obsidian/resource-lock';

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

import type { MoveNoticeComponent } from '../move-notice-component.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';
import type { SelectionHighlightComponent } from '../selection-highlight-component.ts';

import {
  getEnclosingHeadingLine,
  getSelectionUnderHeading
} from '../composers/composer-base.ts';
import { MoveSelectionBuffer } from '../move-selection-buffer.ts';
import { MarkHeadingToMoveEditorCommandHandler } from './mark-heading-to-move-editor-command-handler.ts';

interface HandlerParams {
  readonly app: App;
  readonly moveNoticeComponent: MoveNoticeComponent;
  readonly moveSelectionBuffer: MoveSelectionBuffer;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
  readonly selectionHighlightComponent: SelectionHighlightComponent;
}

interface MockParamsOptions {
  readonly isPathIgnored?: boolean;
  readonly shouldAddCommandsToSubmenu?: boolean;
  readonly shouldBlockCommandOnPath?: boolean;
  readonly shouldLockAllNotesWhenMarkingSelection?: boolean;
}

interface TestableHandler {
  canExecuteEditor(editor: Editor, context: MarkdownFileInfo): boolean;
  executeEditor(editor: Editor, context: MarkdownFileInfo): Promise<void>;
  readonly icon: string;
  readonly id: string;
  readonly name: string;
  shouldAddCommandToSubmenu(): boolean;
  shouldAddToEditorMenu(editor: Editor, context: MarkdownFileInfo): boolean;
}

vi.mock('obsidian-dev-utils/html-element', () => ({
  createFragmentAsync: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn()
}));

vi.mock('../composers/composer-base.ts', () => ({
  getEnclosingHeadingLine: vi.fn(),
  getSelectionUnderHeading: vi.fn()
}));

const mockCreateFragmentAsync = vi.mocked(createFragmentAsync);
const mockGetEnclosingHeadingLine = vi.mocked(getEnclosingHeadingLine);
const mockGetSelectionUnderHeading = vi.mocked(getSelectionUnderHeading);
const mockRenderInternalLink = vi.mocked(renderInternalLink);

const HEADING_LINE = 6;
const HEADING_START: EditorPosition = { ch: 0, line: HEADING_LINE };
const HEADING_END: EditorPosition = { ch: 16, line: 12 };
const HEADING_START_OFFSET = 40;
const HEADING_END_OFFSET = 120;
const HEADING_TEXT = 'Marked heading';
const HEADING_SECTION_TEXT = '## Marked heading\n\nbody\n\n### Nested\n\nnested body';

const MOCK_NOTICE: Notice = strictProxy<Notice>({ hide: vi.fn() });
const ROOT_FOLDER = strictProxy<TFolder>({ path: '/' });

function createMockContext(file: null | TFile): MarkdownFileInfo {
  return strictProxy<MarkdownFileInfo>({ file });
}

function createMockEditor(hasSomethingSelected = false): Editor {
  return strictProxy<Editor>({
    getCursor: vi.fn().mockReturnValue({ ch: 3, line: 8 }),
    getRange: vi.fn().mockReturnValue(HEADING_SECTION_TEXT),
    posToOffset: vi.fn((position: EditorPosition) => position.line === HEADING_LINE ? HEADING_START_OFFSET : HEADING_END_OFFSET),
    somethingSelected: vi.fn().mockReturnValue(hasSomethingSelected)
  });
}

function createMockFile(mtime = 1000): TFile {
  return strictProxy<TFile>({
    path: 'source.md',
    stat: strictProxy({ mtime })
  });
}

function createMockParams(options: MockParamsOptions = {}): HandlerParams {
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
        isPathIgnored: vi.fn().mockReturnValue(options.isPathIgnored ?? false),
        shouldAddCommandsToSubmenu: options.shouldAddCommandsToSubmenu ?? true,
        shouldBlockCommandOnPath: vi.fn().mockReturnValue(options.shouldBlockCommandOnPath ?? false),
        shouldLockAllNotesWhenMarkingSelection: options.shouldLockAllNotesWhenMarkingSelection ?? false
      })
    }),
    resourceLockComponent: strictProxy<ResourceLockComponent>({
      lockForPath: vi.fn().mockImplementation((lockParams: ResourceLockComponentLockForPathParams) => {
        lockParams.abortController?.signal.addEventListener('abort', () => {
          lockParams.onUnlockRequested?.();
        }, { once: true });
        return { [Symbol.dispose]: vi.fn() };
      })
    }),
    selectionHighlightComponent: strictProxy<SelectionHighlightComponent>({
      addHighlight: vi.fn().mockReturnValue({ [Symbol.dispose]: vi.fn() })
    })
  };
}

function stubEnclosingHeading(): void {
  mockGetEnclosingHeadingLine.mockReturnValue(HEADING_LINE);
  mockGetSelectionUnderHeading.mockReturnValue({
    end: HEADING_END,
    heading: HEADING_TEXT,
    start: HEADING_START
  });
}

function toTestable(handler: MarkHeadingToMoveEditorCommandHandler): TestableHandler {
  return castTo<TestableHandler>(handler);
}

describe('MarkHeadingToMoveEditorCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubEnclosingHeading();
  });

  it('should construct with correct params', () => {
    const handler = toTestable(new MarkHeadingToMoveEditorCommandHandler(createMockParams()));
    expect(handler.id).toBe('mark-heading-to-move');
    expect(handler.name).toBe('Smart cut & paste: Mark heading to move');
    expect(handler.icon).toBe('lucide-scissors');
  });

  it('should be available when the cursor is inside a heading section', () => {
    const handler = toTestable(new MarkHeadingToMoveEditorCommandHandler(createMockParams()));
    expect(handler.canExecuteEditor(createMockEditor(), createMockContext(createMockFile()))).toBe(true);
  });

  it('should be unavailable when the command is blocked on the path', () => {
    const handler = toTestable(new MarkHeadingToMoveEditorCommandHandler(createMockParams({ shouldBlockCommandOnPath: true })));
    expect(handler.canExecuteEditor(createMockEditor(), createMockContext(createMockFile()))).toBe(false);
  });

  it('should be unavailable when there is no file', () => {
    const handler = toTestable(new MarkHeadingToMoveEditorCommandHandler(createMockParams()));
    expect(handler.canExecuteEditor(createMockEditor(), createMockContext(null))).toBe(false);
  });

  it('should be unavailable when the cursor is outside every heading', () => {
    mockGetEnclosingHeadingLine.mockReturnValue(null);
    const handler = toTestable(new MarkHeadingToMoveEditorCommandHandler(createMockParams()));
    expect(handler.canExecuteEditor(createMockEditor(), createMockContext(createMockFile()))).toBe(false);
  });

  it('should be unavailable when the heading owns no resolvable range', () => {
    mockGetSelectionUnderHeading.mockReturnValue(null);
    const handler = toTestable(new MarkHeadingToMoveEditorCommandHandler(createMockParams()));
    expect(handler.canExecuteEditor(createMockEditor(), createMockContext(createMockFile()))).toBe(false);
  });

  it('should mark the whole heading section, with the heading recorded on the mark', async () => {
    const params = createMockParams();
    const handler = toTestable(new MarkHeadingToMoveEditorCommandHandler(params));
    const file = createMockFile(2000);

    await handler.executeEditor(createMockEditor(), createMockContext(file));

    const lockParams = vi.mocked(params.resourceLockComponent.lockForPath).mock.calls[0]?.[0];
    expect(lockParams?.mode).toBe('file');
    expect(lockParams?.pathOrFile).toBe(file);
    expect(lockParams?.shouldBlockMutations).toBe(true);

    const marked = params.moveSelectionBuffer.get();
    expect(marked?.capturedSelections).toEqual([{ endOffset: HEADING_END_OFFSET, startOffset: HEADING_START_OFFSET }]);
    expect(marked?.selectedText).toBe(HEADING_SECTION_TEXT);
    expect(marked?.markedHeading).toEqual({ line: HEADING_LINE, text: HEADING_TEXT });
    expect(marked?.sourceFile).toBe(file);
    expect(marked?.sourceMtime).toBe(2000);
    expect(params.selectionHighlightComponent.addHighlight).toHaveBeenCalled();
    expect(params.moveNoticeComponent.showNotice).toHaveBeenCalled();
  });

  it('should subtree-lock the vault root when shouldLockAllNotesWhenMarkingSelection is on', async () => {
    const params = createMockParams({ shouldLockAllNotesWhenMarkingSelection: true });
    const handler = toTestable(new MarkHeadingToMoveEditorCommandHandler(params));

    await handler.executeEditor(createMockEditor(), createMockContext(createMockFile()));

    const lockParams = vi.mocked(params.resourceLockComponent.lockForPath).mock.calls[0]?.[0];
    expect(lockParams?.mode).toBe('subtree');
    expect(lockParams?.pathOrFile).toBe(ROOT_FOLDER.path);
  });

  it('should return early and not mark when context.file is null', async () => {
    const params = createMockParams();
    const handler = toTestable(new MarkHeadingToMoveEditorCommandHandler(params));

    await handler.executeEditor(createMockEditor(), createMockContext(null));

    expect(params.moveSelectionBuffer.hasMark()).toBe(false);
    expect(params.resourceLockComponent.lockForPath).not.toHaveBeenCalled();
  });

  it('should show a notice and not mark when the path is ignored', async () => {
    const params = createMockParams({ isPathIgnored: true });
    const handler = toTestable(new MarkHeadingToMoveEditorCommandHandler(params));

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

    await handler.executeEditor(createMockEditor(), createMockContext(createMockFile()));

    expect(params.pluginNoticeComponent.showNotice).toHaveBeenCalled();
    expect(params.moveSelectionBuffer.hasMark()).toBe(false);
    expect(params.resourceLockComponent.lockForPath).not.toHaveBeenCalled();
  });

  it('should not mark when the cursor left the heading between the gate and the run', async () => {
    const params = createMockParams();
    const handler = toTestable(new MarkHeadingToMoveEditorCommandHandler(params));
    mockGetEnclosingHeadingLine.mockReturnValue(null);

    await handler.executeEditor(createMockEditor(), createMockContext(createMockFile()));

    expect(params.moveSelectionBuffer.hasMark()).toBe(false);
  });

  it('should not mark when the heading range no longer resolves', async () => {
    const params = createMockParams();
    const handler = toTestable(new MarkHeadingToMoveEditorCommandHandler(params));
    mockGetSelectionUnderHeading.mockReturnValue(null);

    await handler.executeEditor(createMockEditor(), createMockContext(createMockFile()));

    expect(params.moveSelectionBuffer.hasMark()).toBe(false);
  });

  it('should leave the editor menu while a selection is active', () => {
    const handler = toTestable(new MarkHeadingToMoveEditorCommandHandler(createMockParams()));
    const context = createMockContext(createMockFile());
    expect(handler.shouldAddToEditorMenu(createMockEditor(false), context)).toBe(true);
    expect(handler.shouldAddToEditorMenu(createMockEditor(true), context)).toBe(false);
  });

  it('should reflect the submenu setting', () => {
    expect(toTestable(new MarkHeadingToMoveEditorCommandHandler(createMockParams({ shouldAddCommandsToSubmenu: true }))).shouldAddCommandToSubmenu()).toBe(true);
    expect(toTestable(new MarkHeadingToMoveEditorCommandHandler(createMockParams({ shouldAddCommandsToSubmenu: false }))).shouldAddCommandToSubmenu()).toBe(false);
  });
});
