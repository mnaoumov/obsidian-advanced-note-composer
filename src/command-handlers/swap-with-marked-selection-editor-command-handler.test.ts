import type {
  App,
  Editor,
  EditorPosition,
  MarkdownFileInfo,
  TFile,
  Vault
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';
import type { VaultTransaction } from 'obsidian-dev-utils/obsidian/vault-transaction';

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

import type { RunLockedTransactionParams } from '../locked-transaction.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';
import type { MarkedSwapSelection } from '../swap-selection-buffer.ts';

import { runLockedTransaction } from '../locked-transaction.ts';
import { SwapSelectionBuffer } from '../swap-selection-buffer.ts';
import { SwapWithMarkedSelectionEditorCommandHandler } from './swap-with-marked-selection-editor-command-handler.ts';

interface MockEditorParams {
  readonly fromOffset?: number;
  readonly somethingSelected?: boolean;
  readonly toOffset?: number;
  readonly value?: string;
}

interface TestableHandler {
  canExecuteEditor(editor: Editor, context: MarkdownFileInfo): boolean;
  executeEditor(editor: Editor, context: MarkdownFileInfo): Promise<void>;
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

vi.mock('../locked-transaction.ts', () => ({
  runLockedTransaction: vi.fn()
}));

const mockCreateFragmentAsync = vi.mocked(createFragmentAsync);
const mockRenderInternalLink = vi.mocked(renderInternalLink);
const mockRunLockedTransaction = vi.mocked(runLockedTransaction);
const mockModify = vi.fn().mockResolvedValue(undefined);

interface CreateParamsOptions {
  readonly files?: readonly TFile[];
  readonly isPathIgnored?: boolean;
  readonly shouldBlockCommandOnPath?: boolean;
  readonly sourceContent?: string;
}

interface HandlerParams {
  readonly app: App;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
  readonly swapSelectionBuffer: SwapSelectionBuffer;
}

function createMockContext(file: null | TFile): MarkdownFileInfo {
  return strictProxy<MarkdownFileInfo>({ file });
}

function createMockEditor(params: MockEditorParams = {}): Editor {
  const fromOffset = params.fromOffset ?? 4;
  const toOffset = params.toOffset ?? 10;
  return strictProxy<Editor>({
    getCursor: vi.fn((which?: string) => ({ ch: which === 'from' ? fromOffset : toOffset, line: 0 })),
    getSelection: vi.fn().mockReturnValue('target text'),
    getValue: vi.fn().mockReturnValue(params.value ?? 'tgt [PICK] fin'),
    posToOffset: vi.fn((pos: EditorPosition) => pos.ch),
    somethingSelected: vi.fn().mockReturnValue(params.somethingSelected ?? true)
  });
}

function createMockFile(path: string, mtime = 1000): TFile {
  return strictProxy<TFile>({
    path,
    stat: strictProxy({ mtime })
  });
}

function createMockParams(options: CreateParamsOptions = {}): HandlerParams {
  const files = options.files ?? [];
  return {
    app: strictProxy<App>({
      vault: strictProxy<Vault>({
        getFileByPath: vi.fn((path: string) => files.find((file) => file.path === path) ?? null),
        read: vi.fn().mockResolvedValue(options.sourceContent ?? 'src [MARK] end')
      })
    }),
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice: vi.fn().mockReturnValue({ hide: vi.fn() }) }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        isPathIgnored: vi.fn().mockReturnValue(options.isPathIgnored ?? false),
        shouldAddCommandsToSubmenu: true,
        shouldBlockCommandOnPath: vi.fn().mockReturnValue(options.shouldBlockCommandOnPath ?? false),
        shouldShowOperationNotices: true
      })
    }),
    resourceLockComponent: strictProxy<ResourceLockComponent>({}),
    swapSelectionBuffer: new SwapSelectionBuffer()
  };
}

function markSelection(buffer: SwapSelectionBuffer, overrides: Partial<MarkedSwapSelection> = {}): TFile {
  const sourceFile = overrides.sourceFile ?? createMockFile('source.md');
  buffer.mark({
    endOffset: overrides.endOffset ?? 10,
    selectedText: overrides.selectedText ?? '[MARK]',
    sourceFile,
    sourceMtime: overrides.sourceMtime ?? 1000,
    startOffset: overrides.startOffset ?? 4
  });
  return sourceFile;
}

function toTestable(handler: SwapWithMarkedSelectionEditorCommandHandler): TestableHandler {
  return castTo<TestableHandler>(handler);
}

describe('SwapWithMarkedSelectionEditorCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunLockedTransaction.mockImplementation(async (params: RunLockedTransactionParams) => {
      await params.body(strictProxy<VaultTransaction>({ modify: mockModify }));
    });
  });

  it('should construct with correct params', () => {
    const handler = toTestable(new SwapWithMarkedSelectionEditorCommandHandler(createMockParams()));
    expect(handler.id).toBe('swap-with-marked-selection');
    expect(handler.name).toBe('Swap selections: Swap with marked selection');
    expect(handler.icon).toBe('switch-camera');
  });

  describe('canExecuteEditor', () => {
    it('should be unavailable when nothing is marked', () => {
      const params = createMockParams();
      const handler = toTestable(new SwapWithMarkedSelectionEditorCommandHandler(params));
      expect(handler.canExecuteEditor(createMockEditor(), createMockContext(createMockFile('t.md')))).toBe(false);
    });

    it('should be unavailable when context.file is null', () => {
      const params = createMockParams();
      markSelection(params.swapSelectionBuffer);
      const handler = toTestable(new SwapWithMarkedSelectionEditorCommandHandler(params));
      expect(handler.canExecuteEditor(createMockEditor(), createMockContext(null))).toBe(false);
    });

    it('should be unavailable when nothing is selected', () => {
      const params = createMockParams();
      markSelection(params.swapSelectionBuffer);
      const handler = toTestable(new SwapWithMarkedSelectionEditorCommandHandler(params));
      expect(handler.canExecuteEditor(createMockEditor({ somethingSelected: false }), createMockContext(createMockFile('t.md')))).toBe(false);
    });

    it('should be unavailable when the source note no longer exists', () => {
      const params = createMockParams();
      markSelection(params.swapSelectionBuffer);
      const handler = toTestable(new SwapWithMarkedSelectionEditorCommandHandler(params));
      expect(handler.canExecuteEditor(createMockEditor(), createMockContext(createMockFile('t.md')))).toBe(false);
    });

    it('should be unavailable when nothing is selected even though the source note exists', () => {
      const sourceFile = createMockFile('source.md');
      const targetFile = createMockFile('target.md');
      const params = createMockParams({ files: [sourceFile, targetFile] });
      markSelection(params.swapSelectionBuffer, { sourceFile });
      const handler = toTestable(new SwapWithMarkedSelectionEditorCommandHandler(params));
      expect(handler.canExecuteEditor(createMockEditor({ somethingSelected: false }), createMockContext(targetFile))).toBe(false);
    });

    it('should be available for a different existing target note', () => {
      const sourceFile = createMockFile('source.md');
      const targetFile = createMockFile('target.md');
      const params = createMockParams({ files: [sourceFile, targetFile] });
      markSelection(params.swapSelectionBuffer, { sourceFile });
      const handler = toTestable(new SwapWithMarkedSelectionEditorCommandHandler(params));
      expect(handler.canExecuteEditor(createMockEditor(), createMockContext(targetFile))).toBe(true);
    });

    it('should be unavailable for a same-note selection overlapping the marked one', () => {
      const sourceFile = createMockFile('note.md');
      const params = createMockParams({ files: [sourceFile] });
      markSelection(params.swapSelectionBuffer, { endOffset: 10, sourceFile, startOffset: 4 });
      const handler = toTestable(new SwapWithMarkedSelectionEditorCommandHandler(params));
      expect(handler.canExecuteEditor(createMockEditor({ fromOffset: 6, toOffset: 12 }), createMockContext(sourceFile))).toBe(false);
    });

    it('should be available for a same-note selection not overlapping the marked one', () => {
      const sourceFile = createMockFile('note.md');
      const params = createMockParams({ files: [sourceFile] });
      markSelection(params.swapSelectionBuffer, { endOffset: 3, sourceFile, startOffset: 0 });
      const handler = toTestable(new SwapWithMarkedSelectionEditorCommandHandler(params));
      expect(handler.canExecuteEditor(createMockEditor({ fromOffset: 8, toOffset: 13 }), createMockContext(sourceFile))).toBe(true);
    });

    it('should be unavailable when the command is blocked on the path', () => {
      const sourceFile = createMockFile('source.md');
      const targetFile = createMockFile('target.md');
      const params = createMockParams({ files: [sourceFile, targetFile], shouldBlockCommandOnPath: true });
      markSelection(params.swapSelectionBuffer, { sourceFile });
      const handler = toTestable(new SwapWithMarkedSelectionEditorCommandHandler(params));
      expect(handler.canExecuteEditor(createMockEditor(), createMockContext(targetFile))).toBe(false);
    });
  });

  describe('executeEditor', () => {
    it('should return early when context.file is null', async () => {
      const params = createMockParams();
      markSelection(params.swapSelectionBuffer);
      const handler = toTestable(new SwapWithMarkedSelectionEditorCommandHandler(params));
      await handler.executeEditor(createMockEditor(), createMockContext(null));
      expect(mockRunLockedTransaction).not.toHaveBeenCalled();
    });

    it('should return early when nothing is marked', async () => {
      const params = createMockParams();
      const handler = toTestable(new SwapWithMarkedSelectionEditorCommandHandler(params));
      await handler.executeEditor(createMockEditor(), createMockContext(createMockFile('t.md')));
      expect(mockRunLockedTransaction).not.toHaveBeenCalled();
    });

    it('should notice and clear when the source note no longer exists', async () => {
      const params = createMockParams();
      markSelection(params.swapSelectionBuffer);
      const handler = toTestable(new SwapWithMarkedSelectionEditorCommandHandler(params));
      await handler.executeEditor(createMockEditor(), createMockContext(createMockFile('target.md')));
      expect(params.pluginNoticeComponent.showNotice).toHaveBeenCalledWith(expect.stringContaining('no longer exists'));
      expect(params.swapSelectionBuffer.hasMark()).toBe(false);
      expect(mockRunLockedTransaction).not.toHaveBeenCalled();
    });

    it('should notice when the target path is ignored', async () => {
      const sourceFile = createMockFile('source.md');
      const targetFile = createMockFile('target.md');
      const params = createMockParams({ files: [sourceFile, targetFile], isPathIgnored: true });
      markSelection(params.swapSelectionBuffer, { sourceFile });
      const handler = toTestable(new SwapWithMarkedSelectionEditorCommandHandler(params));

      const mockFragment = strictProxy<DocumentFragment>({ append: vi.fn(), appendChild: vi.fn(), appendText: vi.fn() });
      mockCreateFragmentAsync.mockImplementation(async (callback) => {
        await (callback as (f: DocumentFragment) => Promise<void>)(mockFragment);
        return mockFragment;
      });
      mockRenderInternalLink.mockResolvedValue(createEl('a'));

      await handler.executeEditor(createMockEditor(), createMockContext(targetFile));
      expect(params.pluginNoticeComponent.showNotice).toHaveBeenCalled();
      expect(mockRunLockedTransaction).not.toHaveBeenCalled();
    });

    it('should notice when the source note changed since it was marked', async () => {
      const sourceFile = createMockFile('source.md', 2000);
      const targetFile = createMockFile('target.md');
      const params = createMockParams({ files: [sourceFile, targetFile] });
      markSelection(params.swapSelectionBuffer, { sourceFile, sourceMtime: 1000 });
      const handler = toTestable(new SwapWithMarkedSelectionEditorCommandHandler(params));
      await handler.executeEditor(createMockEditor(), createMockContext(targetFile));
      expect(params.pluginNoticeComponent.showNotice).toHaveBeenCalledWith(expect.stringContaining('changed since it was marked'));
      expect(mockRunLockedTransaction).not.toHaveBeenCalled();
    });

    it('should notice for a same-note overlapping selection', async () => {
      const sourceFile = createMockFile('note.md');
      const params = createMockParams({ files: [sourceFile], sourceContent: 'one and three' });
      markSelection(params.swapSelectionBuffer, { endOffset: 10, selectedText: 'nd three', sourceFile, startOffset: 4 });
      const handler = toTestable(new SwapWithMarkedSelectionEditorCommandHandler(params));
      await handler.executeEditor(createMockEditor({ fromOffset: 6, toOffset: 12, value: 'one and three' }), createMockContext(sourceFile));
      expect(params.pluginNoticeComponent.showNotice).toHaveBeenCalledWith(expect.stringContaining('overlaps'));
      expect(mockRunLockedTransaction).not.toHaveBeenCalled();
    });

    it('should notice and clear when the marked text no longer matches the source', async () => {
      const sourceFile = createMockFile('source.md');
      const targetFile = createMockFile('target.md');
      const params = createMockParams({ files: [sourceFile, targetFile], sourceContent: 'totally different' });
      markSelection(params.swapSelectionBuffer, { selectedText: '[MARK]', sourceFile });
      const handler = toTestable(new SwapWithMarkedSelectionEditorCommandHandler(params));
      await handler.executeEditor(createMockEditor(), createMockContext(targetFile));
      expect(params.pluginNoticeComponent.showNotice).toHaveBeenCalledWith(expect.stringContaining('no longer matches'));
      expect(params.swapSelectionBuffer.hasMark()).toBe(false);
      expect(mockRunLockedTransaction).not.toHaveBeenCalled();
    });

    it('should swap two selections across notes, writing both files', async () => {
      const sourceFile = createMockFile('source.md');
      const targetFile = createMockFile('target.md');
      const params = createMockParams({ files: [sourceFile, targetFile], sourceContent: 'src [MARK] end' });
      markSelection(params.swapSelectionBuffer, { endOffset: 10, selectedText: '[MARK]', sourceFile, startOffset: 4 });
      const handler = toTestable(new SwapWithMarkedSelectionEditorCommandHandler(params));

      await handler.executeEditor(createMockEditor({ fromOffset: 4, toOffset: 10, value: 'tgt [PICK] fin' }), createMockContext(targetFile));

      expect(mockRunLockedTransaction).toHaveBeenCalledOnce();
      expect(mockModify).toHaveBeenCalledWith(sourceFile, 'src [PICK] end');
      expect(mockModify).toHaveBeenCalledWith(targetFile, 'tgt [MARK] fin');
      expect(params.swapSelectionBuffer.hasMark()).toBe(false);
      expect(params.pluginNoticeComponent.showNotice).toHaveBeenCalledWith('Selections swapped.', { isReusable: false });
    });

    it('should swap two selections within the same note, writing it once', async () => {
      const sourceFile = createMockFile('note.md');
      const params = createMockParams({ files: [sourceFile] });
      markSelection(params.swapSelectionBuffer, { endOffset: 3, selectedText: 'one', sourceFile, startOffset: 0 });
      const handler = toTestable(new SwapWithMarkedSelectionEditorCommandHandler(params));

      await handler.executeEditor(createMockEditor({ fromOffset: 8, toOffset: 13, value: 'one and three' }), createMockContext(sourceFile));

      expect(mockRunLockedTransaction).toHaveBeenCalledOnce();
      expect(mockModify).toHaveBeenCalledOnce();
      expect(mockModify).toHaveBeenCalledWith(sourceFile, 'three and one');
      expect(params.pluginNoticeComponent.showNotice).toHaveBeenCalledWith('Selections swapped.', { isReusable: false });
    });
  });

  it('should add to the editor menu and reflect the submenu setting', () => {
    const handler = toTestable(new SwapWithMarkedSelectionEditorCommandHandler(createMockParams()));
    expect(handler.shouldAddToEditorMenu()).toBe(true);
    expect(handler.shouldAddCommandToSubmenu()).toBe(true);
  });
});
