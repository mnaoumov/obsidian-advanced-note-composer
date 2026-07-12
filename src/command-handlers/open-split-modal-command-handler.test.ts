import type {
  App as AppOriginal,
  Editor,
  MarkdownView,
  Notice,
  TFile,
  WorkspaceLeaf
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { Selection } from '../composers/composer-base.ts';
import type { ExtractCurrentSelectionEditorCommandHandler } from './extract-current-selection-editor-command-handler.ts';

import { MoveSelectionBuffer } from '../move-selection-buffer.ts';
import { OpenSplitModalCommandHandler } from './open-split-modal-command-handler.ts';

interface StubActiveSourceEditorResult {
  readonly editor: Editor;
  readonly openFile: ReturnType<typeof vi.fn>;
}

interface TestableHandler {
  canExecute(): boolean;
  execute(): void;
  readonly id: string;
  readonly name: string;
}

let app: AppOriginal;
let moveSelectionBuffer: MoveSelectionBuffer;
let extractCurrentSelectionEditorCommandHandler: ExtractCurrentSelectionEditorCommandHandler;
let pluginNoticeComponent: PluginNoticeComponent;
let handler: OpenSplitModalCommandHandler;

beforeEach(() => {
  app = App.createConfigured__({
    files: {
      'source.md': 'source body'
    }
  }).asOriginalType__();
  moveSelectionBuffer = new MoveSelectionBuffer();
  extractCurrentSelectionEditorCommandHandler = strictProxy<ExtractCurrentSelectionEditorCommandHandler>({
    executeInActiveEditor: vi.fn().mockResolvedValue(undefined)
  });
  pluginNoticeComponent = strictProxy<PluginNoticeComponent>({ showNotice: vi.fn() });
  handler = new OpenSplitModalCommandHandler({
    app,
    extractCurrentSelectionEditorCommandHandler,
    moveSelectionBuffer,
    pluginNoticeComponent
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function getSourceFile(): TFile {
  return ensureNonNullable(app.vault.getFileByPath('source.md'));
}

function markSelection(sourceFile: TFile, capturedSelections: Selection[] = [{ endOffset: 1, startOffset: 0 }]): void {
  moveSelectionBuffer.mark({
    abortController: new AbortController(),
    capturedSelections,
    highlight: { [Symbol.dispose]: vi.fn() },
    lock: { [Symbol.dispose]: vi.fn() },
    notice: strictProxy<Notice>({ hide: vi.fn() }),
    selectedText: 'selected',
    sourceFile,
    sourceMtime: sourceFile.stat.mtime
  });
}

function stubActiveSourceEditor(viewFile: null | TFile = getSourceFile()): StubActiveSourceEditorResult {
  const editor = strictProxy<Editor>({
    offsetToPos: vi.fn((offset: number) => ({ ch: offset, line: 0 })),
    setSelections: vi.fn()
  });
  const openFile = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(app.workspace, 'getLeaf').mockReturnValue(strictProxy<WorkspaceLeaf>({ openFile }));
  vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(
    strictProxy<MarkdownView>({ editor, file: viewFile })
  );
  return { editor, openFile };
}

describe('OpenSplitModalCommandHandler', () => {
  it('should construct with the correct id and name', () => {
    expect(castTo<TestableHandler>(handler).id).toBe('open-split-modal');
    expect(castTo<TestableHandler>(handler).name).toBe('Smart cut & paste: Switch to split/extract');
  });

  it('should be unavailable when nothing is marked', () => {
    expect(castTo<TestableHandler>(handler).canExecute()).toBe(false);
  });

  it('should be available when a selection is marked', () => {
    markSelection(getSourceFile());
    expect(castTo<TestableHandler>(handler).canExecute()).toBe(true);
  });

  it('should do nothing when nothing is marked', async () => {
    const getLeafSpy = vi.spyOn(app.workspace, 'getLeaf');
    await handler.openSplitModal();
    expect(getLeafSpy).not.toHaveBeenCalled();
    expect(vi.mocked(extractCurrentSelectionEditorCommandHandler.executeInActiveEditor)).not.toHaveBeenCalled();
  });

  it('should notice and clear the mark when the source note no longer exists', async () => {
    markSelection(strictProxy<TFile>({ path: 'ghost.md', stat: strictProxy({ mtime: 1 }) }));
    await handler.openSplitModal();
    expect(vi.mocked(pluginNoticeComponent.showNotice)).toHaveBeenCalledWith('The note the selection was marked in no longer exists.');
    expect(moveSelectionBuffer.hasMark()).toBe(false);
    expect(vi.mocked(extractCurrentSelectionEditorCommandHandler.executeInActiveEditor)).not.toHaveBeenCalled();
  });

  it('should clear the mark, re-open the source note, restore the selection, and delegate to the extract flow', async () => {
    const sourceFile = getSourceFile();
    markSelection(sourceFile);
    const { editor, openFile } = stubActiveSourceEditor();

    await handler.openSplitModal();

    expect(moveSelectionBuffer.hasMark()).toBe(false);
    expect(openFile).toHaveBeenCalledWith(sourceFile, { active: true });
    expect(editor.setSelections).toHaveBeenCalledWith([
      { anchor: { ch: 0, line: 0 }, head: { ch: 1, line: 0 } }
    ]);
    expect(vi.mocked(extractCurrentSelectionEditorCommandHandler.executeInActiveEditor)).toHaveBeenCalledOnce();
  });

  it('should abort without delegating when no markdown view becomes active', async () => {
    markSelection(getSourceFile());
    const openFile = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(app.workspace, 'getLeaf').mockReturnValue(strictProxy<WorkspaceLeaf>({ openFile }));
    vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue(null);

    await handler.openSplitModal();

    expect(moveSelectionBuffer.hasMark()).toBe(false);
    expect(vi.mocked(extractCurrentSelectionEditorCommandHandler.executeInActiveEditor)).not.toHaveBeenCalled();
  });

  it('should abort without delegating when the active view shows a different note', async () => {
    markSelection(getSourceFile());
    stubActiveSourceEditor(strictProxy<TFile>({ path: 'other.md' }));

    await handler.openSplitModal();

    expect(vi.mocked(extractCurrentSelectionEditorCommandHandler.executeInActiveEditor)).not.toHaveBeenCalled();
  });

  it('should run the switch on execute', async () => {
    markSelection(getSourceFile());
    stubActiveSourceEditor();

    castTo<TestableHandler>(handler).execute();

    await vi.waitFor(() => {
      expect(vi.mocked(extractCurrentSelectionEditorCommandHandler.executeInActiveEditor)).toHaveBeenCalledOnce();
    });
  });
});
