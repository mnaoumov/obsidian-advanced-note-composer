import type {
  App,
  Editor,
  MarkdownFileInfo,
  TFile
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { Selection } from '../composers/composer-base.ts';
import type { MarkedSelection } from '../move-selection-buffer.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { MarkedSwapSide } from '../swap-selection-runner.ts';

import { MoveSelectionBuffer } from '../move-selection-buffer.ts';
import {
  canSwapWithSelection,
  swapWithSelection
} from '../swap-selection-runner.ts';
import { SwapMarkedSelectionEditorCommandHandler } from './swap-marked-selection-editor-command-handler.ts';

interface HandlerParams {
  readonly app: App;
  readonly moveSelectionBuffer: MoveSelectionBuffer;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

interface TestableHandler {
  canExecuteEditor(editor: Editor, ctx: MarkdownFileInfo): boolean;
  executeEditor(editor: Editor, ctx: MarkdownFileInfo): Promise<void>;
  readonly id: string;
  readonly name: string;
}

vi.mock('../swap-selection-runner.ts', () => ({
  canSwapWithSelection: vi.fn(),
  swapWithSelection: vi.fn()
}));

const mockCanSwapWithSelection = vi.mocked(canSwapWithSelection);
const mockSwapWithSelection = vi.mocked(swapWithSelection);

const SOURCE_FILE = castTo<TFile>({ path: 'source.md' });

function createMockCtx(file: null | TFile): MarkdownFileInfo {
  return strictProxy<MarkdownFileInfo>({ file });
}

function createMockEditor(): Editor {
  return strictProxy<Editor>({});
}

function createMockParams(): HandlerParams {
  return {
    app: strictProxy<App>({}),
    moveSelectionBuffer: new MoveSelectionBuffer(),
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({}),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({}),
    resourceLockComponent: strictProxy<ResourceLockComponent>({})
  };
}

function markMove(buffer: MoveSelectionBuffer, capturedSelections: Selection[]): void {
  buffer.mark(strictProxy<MarkedSelection>({
    capturedSelections,
    highlight: { [Symbol.dispose]: vi.fn() },
    lock: { [Symbol.dispose]: vi.fn() },
    notice: null,
    selectedText: 'marked text',
    sourceFile: SOURCE_FILE,
    sourceMtime: 1000
  }));
}

function toTestable(handler: SwapMarkedSelectionEditorCommandHandler): TestableHandler {
  return castTo<TestableHandler>(handler);
}

describe('SwapMarkedSelectionEditorCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should construct with correct id and name', () => {
    const handler = toTestable(new SwapMarkedSelectionEditorCommandHandler(createMockParams()));
    expect(handler.id).toBe('swap-marked-selection');
    expect(handler.name).toBe('Swap selections: Swap marked selection with the current selection');
  });

  describe('canExecuteEditor', () => {
    it('should be unavailable when ctx.file is null', () => {
      const params = createMockParams();
      markMove(params.moveSelectionBuffer, [{ endOffset: 5, startOffset: 0 }]);
      const handler = toTestable(new SwapMarkedSelectionEditorCommandHandler(params));
      expect(handler.canExecuteEditor(createMockEditor(), createMockCtx(null))).toBe(false);
      expect(mockCanSwapWithSelection).not.toHaveBeenCalled();
    });

    it('should be unavailable when nothing is marked', () => {
      const params = createMockParams();
      const handler = toTestable(new SwapMarkedSelectionEditorCommandHandler(params));
      expect(handler.canExecuteEditor(createMockEditor(), createMockCtx(SOURCE_FILE))).toBe(false);
      expect(mockCanSwapWithSelection).not.toHaveBeenCalled();
    });

    it('should be unavailable when the mark has no captured selection', () => {
      const params = createMockParams();
      markMove(params.moveSelectionBuffer, []);
      const handler = toTestable(new SwapMarkedSelectionEditorCommandHandler(params));
      expect(handler.canExecuteEditor(createMockEditor(), createMockCtx(SOURCE_FILE))).toBe(false);
      expect(mockCanSwapWithSelection).not.toHaveBeenCalled();
    });

    it('should be unavailable when the mark covers more than one selection', () => {
      const params = createMockParams();
      markMove(params.moveSelectionBuffer, [{ endOffset: 5, startOffset: 0 }, { endOffset: 20, startOffset: 10 }]);
      const handler = toTestable(new SwapMarkedSelectionEditorCommandHandler(params));
      expect(handler.canExecuteEditor(createMockEditor(), createMockCtx(SOURCE_FILE))).toBe(false);
      expect(mockCanSwapWithSelection).not.toHaveBeenCalled();
    });

    it('should delegate to the runner for a single-selection mark', () => {
      const params = createMockParams();
      markMove(params.moveSelectionBuffer, [{ endOffset: 5, startOffset: 0 }]);
      mockCanSwapWithSelection.mockReturnValue(true);
      const handler = toTestable(new SwapMarkedSelectionEditorCommandHandler(params));

      expect(handler.canExecuteEditor(createMockEditor(), createMockCtx(SOURCE_FILE))).toBe(true);
      const expectedSide: MarkedSwapSide = {
        endOffset: 5,
        selectedText: 'marked text',
        sourceFile: SOURCE_FILE,
        sourceMtime: 1000,
        startOffset: 0
      };
      expect(mockCanSwapWithSelection).toHaveBeenCalledWith(expect.objectContaining({ marked: expectedSide, targetFile: SOURCE_FILE }));
    });
  });

  describe('executeEditor', () => {
    it('should do nothing when ctx.file is null', async () => {
      const params = createMockParams();
      markMove(params.moveSelectionBuffer, [{ endOffset: 5, startOffset: 0 }]);
      const handler = toTestable(new SwapMarkedSelectionEditorCommandHandler(params));
      await handler.executeEditor(createMockEditor(), createMockCtx(null));
      expect(mockSwapWithSelection).not.toHaveBeenCalled();
    });

    it('should do nothing when there is no single-selection mark', async () => {
      const params = createMockParams();
      const handler = toTestable(new SwapMarkedSelectionEditorCommandHandler(params));
      await handler.executeEditor(createMockEditor(), createMockCtx(SOURCE_FILE));
      expect(mockSwapWithSelection).not.toHaveBeenCalled();
    });

    it('should swap the marked selection and clear the mark on clearMark', async () => {
      const params = createMockParams();
      markMove(params.moveSelectionBuffer, [{ endOffset: 5, startOffset: 0 }]);
      const handler = toTestable(new SwapMarkedSelectionEditorCommandHandler(params));

      await handler.executeEditor(createMockEditor(), createMockCtx(SOURCE_FILE));

      expect(mockSwapWithSelection).toHaveBeenCalledOnce();
      const passed = ensureNonNullable(mockSwapWithSelection.mock.calls[0]?.[0]);
      expect(passed.marked).toStrictEqual({
        endOffset: 5,
        selectedText: 'marked text',
        sourceFile: SOURCE_FILE,
        sourceMtime: 1000,
        startOffset: 0
      });
      expect(params.moveSelectionBuffer.hasMark()).toBe(true);
      passed.clearMark();
      expect(params.moveSelectionBuffer.hasMark()).toBe(false);
    });
  });
});
