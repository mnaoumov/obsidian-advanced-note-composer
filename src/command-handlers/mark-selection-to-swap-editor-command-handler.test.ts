import type {
  App,
  Editor,
  EditorPosition,
  MarkdownFileInfo,
  TFile
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

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

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';

import { SwapSelectionBuffer } from '../swap-selection-buffer.ts';
import { MarkSelectionToSwapEditorCommandHandler } from './mark-selection-to-swap-editor-command-handler.ts';

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

const mockCreateFragmentAsync = vi.mocked(createFragmentAsync);
const mockRenderInternalLink = vi.mocked(renderInternalLink);

interface HandlerParams {
  readonly app: App;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly swapSelectionBuffer: SwapSelectionBuffer;
}

function createMockContext(file: null | TFile): MarkdownFileInfo {
  return strictProxy<MarkdownFileInfo>({ file });
}

function createMockEditor(hasSomethingSelected = true): Editor {
  return strictProxy<Editor>({
    getCursor: vi.fn((which?: string) => (which === 'from' ? { ch: 0, line: 0 } : { ch: 0, line: 1 })),
    getSelection: vi.fn().mockReturnValue('marked text'),
    posToOffset: vi.fn((pos: EditorPosition) => (pos.line === 0 ? 3 : 14)),
    somethingSelected: vi.fn().mockReturnValue(hasSomethingSelected)
  });
}

function createMockFile(mtime = 1000): TFile {
  return strictProxy<TFile>({
    path: 'source.md',
    stat: strictProxy({ mtime })
  });
}

function createMockParams(isPathIgnored = false, shouldAddCommandsToSubmenu = true, shouldBlockCommandOnPath = false): HandlerParams {
  return {
    app: strictProxy<App>({}),
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice: vi.fn().mockReturnValue({ hide: vi.fn() }) }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        isPathIgnored: vi.fn().mockReturnValue(isPathIgnored),
        shouldAddCommandsToSubmenu,
        shouldBlockCommandOnPath: vi.fn().mockReturnValue(shouldBlockCommandOnPath)
      })
    }),
    swapSelectionBuffer: new SwapSelectionBuffer()
  };
}

function toTestable(handler: MarkSelectionToSwapEditorCommandHandler): TestableHandler {
  return castTo<TestableHandler>(handler);
}

describe('MarkSelectionToSwapEditorCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should construct with correct params', () => {
    const handler = toTestable(new MarkSelectionToSwapEditorCommandHandler(createMockParams()));
    expect(handler.id).toBe('mark-selection-to-swap');
    expect(handler.name).toBe('Swap selections: Mark selection to swap');
    expect(handler.icon).toBe('switch-camera');
  });

  it('should be available only when something is selected', () => {
    const handler = toTestable(new MarkSelectionToSwapEditorCommandHandler(createMockParams()));
    expect(handler.canExecuteEditor(createMockEditor(true), createMockContext(createMockFile()))).toBe(true);
    expect(handler.canExecuteEditor(createMockEditor(false), createMockContext(createMockFile()))).toBe(false);
  });

  it('should block canExecuteEditor when the command is blocked on the path', () => {
    const handler = toTestable(new MarkSelectionToSwapEditorCommandHandler(createMockParams(false, true, true)));
    expect(handler.canExecuteEditor(createMockEditor(true), createMockContext(createMockFile()))).toBe(false);
  });

  it('should allow canExecuteEditor when the command is not blocked on the path', () => {
    const handler = toTestable(new MarkSelectionToSwapEditorCommandHandler(createMockParams(false, true, false)));
    expect(handler.canExecuteEditor(createMockEditor(true), createMockContext(createMockFile()))).toBe(true);
  });

  it('should return early and not mark when context.file is null', async () => {
    const params = createMockParams();
    const handler = toTestable(new MarkSelectionToSwapEditorCommandHandler(params));

    await handler.executeEditor(createMockEditor(), createMockContext(null));

    expect(params.swapSelectionBuffer.hasMark()).toBe(false);
  });

  it('should show a notice and not mark when the path is ignored', async () => {
    const params = createMockParams(true);
    const handler = toTestable(new MarkSelectionToSwapEditorCommandHandler(params));

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
    expect(params.swapSelectionBuffer.hasMark()).toBe(false);
  });

  it('should mark the selection and show a notice on the happy path', async () => {
    const params = createMockParams(false);
    const handler = toTestable(new MarkSelectionToSwapEditorCommandHandler(params));
    const file = createMockFile(2000);

    await handler.executeEditor(createMockEditor(), createMockContext(file));

    const marked = params.swapSelectionBuffer.get();
    expect(marked).not.toBeNull();
    expect(marked?.startOffset).toBe(3);
    expect(marked?.endOffset).toBe(14);
    expect(marked?.selectedText).toBe('marked text');
    expect(marked?.sourceFile).toBe(file);
    expect(marked?.sourceMtime).toBe(2000);
    expect(params.pluginNoticeComponent.showNotice).toHaveBeenCalledWith(expect.stringContaining('Marked selection to swap'));
  });

  it('should add to the editor menu', () => {
    const handler = toTestable(new MarkSelectionToSwapEditorCommandHandler(createMockParams()));
    expect(handler.shouldAddToEditorMenu()).toBe(true);
  });

  it('should reflect the submenu setting', () => {
    expect(toTestable(new MarkSelectionToSwapEditorCommandHandler(createMockParams(false, true))).shouldAddCommandToSubmenu()).toBe(true);
    expect(toTestable(new MarkSelectionToSwapEditorCommandHandler(createMockParams(false, false))).shouldAddCommandToSubmenu()).toBe(false);
  });
});
