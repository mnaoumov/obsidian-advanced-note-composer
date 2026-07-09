import type {
  App,
  Editor,
  MarkdownFileInfo,
  TFile,
  Vault
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
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
import type { MoveOptions } from '../modals/paste-options-modal.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';

import { SplitComposer } from '../composers/split-composer.ts';
import { openPasteOptionsModal } from '../modals/paste-options-modal.ts';
import { MoveSelectionBuffer } from '../move-selection-buffer.ts';
import {
  FrontmatterMergeStrategy,
  TextAfterExtractionMode
} from '../plugin-settings.ts';
import { MoveMarkedSelectionHereEditorCommandHandler } from './move-marked-selection-here-editor-command-handler.ts';

interface CapturedComposerArgs {
  readonly capturedSelections: Selection[];
  readonly frontmatterMergeStrategy: FrontmatterMergeStrategy;
  readonly insertToken: string;
  readonly isNewTargetFile: boolean;
  readonly selectedText: string;
  readonly shouldFixFootnotes: boolean;
  readonly shouldIncludeFrontmatter: boolean;
  readonly sourceFile: TFile;
  readonly targetCursorOffset: number;
  readonly targetFile: TFile;
  readonly textAfterExtractionMode: TextAfterExtractionMode;
}

interface TestableHandler {
  canExecuteEditor(editor: Editor, ctx: MarkdownFileInfo): boolean;
  executeEditor(editor: Editor, ctx: MarkdownFileInfo): Promise<void>;
  readonly icon: string;
  readonly id: string;
  readonly name: string;
  shouldAddCommandToSubmenu(): boolean;
  shouldAddToEditorMenu(): boolean;
}

function capturedComposerArgs(): CapturedComposerArgs {
  return castTo<CapturedComposerArgs>(MockSplitComposer.mock.calls[0]?.[0]);
}

vi.mock('obsidian-dev-utils/html-element', () => ({
  createFragmentAsync: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/markdown', () => ({
  renderInternalLink: vi.fn()
}));

vi.mock('../composers/split-composer.ts', () => {
  const MockSplitComposer = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- vi.fn() prototype is untyped in mock factories.
  MockSplitComposer.prototype.splitFile = vi.fn().mockResolvedValue(undefined);
  return { SplitComposer: MockSplitComposer };
});

vi.mock('../modals/paste-options-modal.ts', () => ({
  openPasteOptionsModal: vi.fn()
}));

const MockSplitComposer = vi.mocked(SplitComposer);
const mockOpenPasteOptionsModal = vi.mocked(openPasteOptionsModal);
const mockCreateFragmentAsync = vi.mocked(createFragmentAsync);
const mockRenderInternalLink = vi.mocked(renderInternalLink);

const CAPTURED_SELECTIONS: Selection[] = [{ endOffset: 10, startOffset: 5 }];
const SOURCE_MTIME = 1000;

interface CreateMockParamsOptions {
  readonly getFileByPathResult?: null | TFile;
  readonly isAdvanced?: boolean;
  readonly isPathIgnored?: boolean;
  readonly moveSelectionBuffer?: MoveSelectionBuffer;
  readonly shouldAddCommandsToSubmenu?: boolean;
  readonly shouldApplyTextAfterExtractionToSameFile?: boolean;
  readonly textAfterExtractionMode?: TextAfterExtractionMode;
}

interface HandlerParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly isAdvanced: boolean;
  readonly moveSelectionBuffer: MoveSelectionBuffer;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

function createMarkedBuffer(sourceFile: TFile): MoveSelectionBuffer {
  const buffer = new MoveSelectionBuffer();
  buffer.mark({
    abortController: new AbortController(),
    capturedSelections: CAPTURED_SELECTIONS,
    lock: { [Symbol.dispose]: vi.fn() },
    selectedText: 'marked text',
    sourceFile,
    sourceMtime: SOURCE_MTIME
  });
  return buffer;
}

function createMockCtx(file: null | TFile): MarkdownFileInfo {
  return strictProxy<MarkdownFileInfo>({ file });
}

function createMockEditor(cursorOffset = 42): Editor {
  return strictProxy<Editor>({
    getCursor: vi.fn().mockReturnValue({ ch: 0, line: 0 }),
    posToOffset: vi.fn().mockReturnValue(cursorOffset)
  });
}

function createMockFile(path: string, mtime = SOURCE_MTIME): TFile {
  return strictProxy<TFile>({
    path,
    stat: strictProxy({ mtime })
  });
}

function createMockParams(options: CreateMockParamsOptions = {}): HandlerParams {
  const getFileByPathResult = options.getFileByPathResult === undefined ? createMockFile('source.md') : options.getFileByPathResult;
  return {
    app: strictProxy<App>({
      vault: strictProxy<Vault>({
        getFileByPath: vi.fn().mockReturnValue(getFileByPathResult)
      })
    }),
    consoleDebugComponent: strictProxy<ConsoleDebugComponent>({ consoleDebug: vi.fn() }),
    isAdvanced: options.isAdvanced ?? false,
    moveSelectionBuffer: options.moveSelectionBuffer ?? new MoveSelectionBuffer(),
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice: vi.fn().mockReturnValue({ hide: vi.fn() }) }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues,
        isPathIgnored: vi.fn().mockReturnValue(options.isPathIgnored ?? false),
        shouldAddCommandsToSubmenu: options.shouldAddCommandsToSubmenu ?? true,
        shouldApplyTextAfterExtractionToSameFile: options.shouldApplyTextAfterExtractionToSameFile ?? false,
        shouldFixFootnotesByDefault: true,
        shouldIncludeFrontmatterWhenSplittingByDefault: false,
        textAfterExtractionMode: options.textAfterExtractionMode ?? TextAfterExtractionMode.LinkToNewFile
      })
    }),
    resourceLockComponent: strictProxy<ResourceLockComponent>({})
  };
}

function toTestable(handler: MoveMarkedSelectionHereEditorCommandHandler): TestableHandler {
  return castTo<TestableHandler>(handler);
}

describe('MoveMarkedSelectionHereEditorCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockSplitComposer.prototype.splitFile = vi.fn().mockResolvedValue(undefined);
  });

  it('should construct the default command', () => {
    const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(createMockParams({ isAdvanced: false })));
    expect(handler.id).toBe('move-marked-selection-here');
    expect(handler.name).toBe('Move marked selection here');
    expect(handler.icon).toBe('lucide-clipboard-paste');
  });

  it('should construct the advanced command', () => {
    const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(createMockParams({ isAdvanced: true })));
    expect(handler.id).toBe('move-marked-selection-here-advanced');
    expect(handler.name).toBe('Move marked selection here (advanced)...');
  });

  describe('canExecuteEditor', () => {
    it('should be unavailable when nothing is marked', () => {
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(createMockParams()));
      expect(handler.canExecuteEditor(createMockEditor(), createMockCtx(createMockFile('target.md')))).toBe(false);
    });

    it('should be unavailable when there is no target file', () => {
      const source = createMockFile('source.md');
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(createMockParams({ moveSelectionBuffer: createMarkedBuffer(source) })));
      expect(handler.canExecuteEditor(createMockEditor(), createMockCtx(null))).toBe(false);
    });

    it('should be unavailable when the source note no longer exists', () => {
      const source = createMockFile('source.md');
      const handler = toTestable(
        new MoveMarkedSelectionHereEditorCommandHandler(createMockParams({
          getFileByPathResult: null,
          moveSelectionBuffer: createMarkedBuffer(source)
        }))
      );
      expect(handler.canExecuteEditor(createMockEditor(), createMockCtx(createMockFile('target.md')))).toBe(false);
    });

    it('should be unavailable when the cursor is inside the marked selection in the same note', () => {
      const source = createMockFile('source.md');
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(createMockParams({ moveSelectionBuffer: createMarkedBuffer(source) })));
      expect(handler.canExecuteEditor(createMockEditor(7), createMockCtx(createMockFile('source.md')))).toBe(false);
    });

    it('should be available when the cursor is outside the marked selection in the same note', () => {
      const source = createMockFile('source.md');
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(createMockParams({ moveSelectionBuffer: createMarkedBuffer(source) })));
      expect(handler.canExecuteEditor(createMockEditor(20), createMockCtx(createMockFile('source.md')))).toBe(true);
    });

    it('should be available when moving into a different note', () => {
      const source = createMockFile('source.md');
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(createMockParams({ moveSelectionBuffer: createMarkedBuffer(source) })));
      expect(handler.canExecuteEditor(createMockEditor(), createMockCtx(createMockFile('target.md')))).toBe(true);
    });
  });

  describe('executeEditor', () => {
    it('should return when there is no target file', async () => {
      const source = createMockFile('source.md');
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(createMockParams({ moveSelectionBuffer: createMarkedBuffer(source) })));
      await handler.executeEditor(createMockEditor(), createMockCtx(null));
      expect(MockSplitComposer).not.toHaveBeenCalled();
    });

    it('should return when nothing is marked', async () => {
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(createMockParams()));
      await handler.executeEditor(createMockEditor(), createMockCtx(createMockFile('target.md')));
      expect(MockSplitComposer).not.toHaveBeenCalled();
    });

    it('should notice and clear the mark when the source note no longer exists', async () => {
      const source = createMockFile('source.md');
      const buffer = createMarkedBuffer(source);
      const params = createMockParams({ getFileByPathResult: null, moveSelectionBuffer: buffer });
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(params));

      await handler.executeEditor(createMockEditor(), createMockCtx(createMockFile('target.md')));

      expect(params.pluginNoticeComponent.showNotice).toHaveBeenCalled();
      expect(buffer.hasMark()).toBe(false);
      expect(MockSplitComposer).not.toHaveBeenCalled();
    });

    it('should notice and not move when the target is ignored', async () => {
      const source = createMockFile('source.md');
      const buffer = createMarkedBuffer(source);
      const params = createMockParams({ isPathIgnored: true, moveSelectionBuffer: buffer });
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(params));

      const mockFragment = strictProxy<DocumentFragment>({
        appendChild: vi.fn(),
        appendText: vi.fn()
      });
      mockCreateFragmentAsync.mockImplementation(async (cb) => {
        await (cb as (f: DocumentFragment) => Promise<void>)(mockFragment);
        return mockFragment;
      });
      mockRenderInternalLink.mockResolvedValue(createEl('a'));

      await handler.executeEditor(createMockEditor(), createMockCtx(createMockFile('target.md')));

      expect(params.pluginNoticeComponent.showNotice).toHaveBeenCalled();
      expect(buffer.hasMark()).toBe(true);
      expect(MockSplitComposer).not.toHaveBeenCalled();
    });

    it('should notice and not move when the source note changed since it was marked', async () => {
      const source = createMockFile('source.md');
      const buffer = createMarkedBuffer(source);
      const params = createMockParams({
        getFileByPathResult: createMockFile('source.md', SOURCE_MTIME + 1),
        moveSelectionBuffer: buffer
      });
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(params));

      await handler.executeEditor(createMockEditor(), createMockCtx(createMockFile('target.md')));

      expect(params.pluginNoticeComponent.showNotice).toHaveBeenCalled();
      expect(buffer.hasMark()).toBe(true);
      expect(MockSplitComposer).not.toHaveBeenCalled();
    });

    it('should move using default settings, clear the mark, and run the split', async () => {
      const source = createMockFile('source.md');
      const resolvedSource = createMockFile('source.md');
      const target = createMockFile('target.md');
      const buffer = createMarkedBuffer(source);
      const params = createMockParams({ getFileByPathResult: resolvedSource, isAdvanced: false, moveSelectionBuffer: buffer });
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(params));

      const mockSplitFile = vi.fn().mockResolvedValue(undefined);
      MockSplitComposer.prototype.splitFile = mockSplitFile;

      await handler.executeEditor(createMockEditor(42), createMockCtx(target));

      expect(mockOpenPasteOptionsModal).not.toHaveBeenCalled();
      expect(MockSplitComposer).toHaveBeenCalledTimes(1);
      const args = capturedComposerArgs();
      expect(args.capturedSelections).toBe(CAPTURED_SELECTIONS);
      expect(args.frontmatterMergeStrategy).toBe(FrontmatterMergeStrategy.MergeAndPreferNewValues);
      expect(args.insertToken).toContain('advanced-note-composer-move-');
      expect(args.isNewTargetFile).toBe(false);
      expect(args.selectedText).toBe('marked text');
      expect(args.shouldFixFootnotes).toBe(true);
      expect(args.shouldIncludeFrontmatter).toBe(false);
      expect(args.sourceFile).toBe(resolvedSource);
      expect(args.targetCursorOffset).toBe(42);
      expect(args.targetFile).toBe(target);
      expect(args.textAfterExtractionMode).toBe(TextAfterExtractionMode.LinkToNewFile);
      expect(buffer.hasMark()).toBe(false);
      expect(mockSplitFile).toHaveBeenCalledTimes(1);
    });

    it('should default text after extraction to None for a same-note move when the setting is disabled', async () => {
      const source = createMockFile('source.md');
      const resolvedSource = createMockFile('source.md');
      const buffer = createMarkedBuffer(source);
      const params = createMockParams({
        getFileByPathResult: resolvedSource,
        moveSelectionBuffer: buffer,
        shouldApplyTextAfterExtractionToSameFile: false,
        textAfterExtractionMode: TextAfterExtractionMode.LinkToNewFile
      });
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(params));

      await handler.executeEditor(createMockEditor(42), createMockCtx(createMockFile('source.md')));

      expect(capturedComposerArgs().textAfterExtractionMode).toBe(TextAfterExtractionMode.None);
    });

    it('should keep the configured text after extraction for a same-note move when the setting is enabled', async () => {
      const source = createMockFile('source.md');
      const resolvedSource = createMockFile('source.md');
      const buffer = createMarkedBuffer(source);
      const params = createMockParams({
        getFileByPathResult: resolvedSource,
        moveSelectionBuffer: buffer,
        shouldApplyTextAfterExtractionToSameFile: true,
        textAfterExtractionMode: TextAfterExtractionMode.EmbedNewFile
      });
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(params));

      await handler.executeEditor(createMockEditor(42), createMockCtx(createMockFile('source.md')));

      expect(capturedComposerArgs().textAfterExtractionMode).toBe(TextAfterExtractionMode.EmbedNewFile);
    });

    it('should prompt for options and move with them when advanced', async () => {
      const source = createMockFile('source.md');
      const buffer = createMarkedBuffer(source);
      const params = createMockParams({ isAdvanced: true, moveSelectionBuffer: buffer });
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(params));

      const chosen: MoveOptions = {
        frontmatterMergeStrategy: FrontmatterMergeStrategy.KeepOriginalFrontmatter,
        shouldFixFootnotes: false,
        shouldIncludeFrontmatter: true,
        textAfterExtractionMode: TextAfterExtractionMode.EmbedNewFile
      };
      mockOpenPasteOptionsModal.mockResolvedValue(chosen);

      await handler.executeEditor(createMockEditor(), createMockCtx(createMockFile('target.md')));

      expect(mockOpenPasteOptionsModal).toHaveBeenCalledTimes(1);
      expect(MockSplitComposer).toHaveBeenCalledTimes(1);
      const args = capturedComposerArgs();
      expect(args.frontmatterMergeStrategy).toBe(FrontmatterMergeStrategy.KeepOriginalFrontmatter);
      expect(args.shouldFixFootnotes).toBe(false);
      expect(args.shouldIncludeFrontmatter).toBe(true);
      expect(args.textAfterExtractionMode).toBe(TextAfterExtractionMode.EmbedNewFile);
      expect(buffer.hasMark()).toBe(false);
    });

    it('should not move when the advanced options modal is cancelled', async () => {
      const source = createMockFile('source.md');
      const buffer = createMarkedBuffer(source);
      const params = createMockParams({ isAdvanced: true, moveSelectionBuffer: buffer });
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(params));

      mockOpenPasteOptionsModal.mockResolvedValue(null);

      await handler.executeEditor(createMockEditor(), createMockCtx(createMockFile('target.md')));

      expect(MockSplitComposer).not.toHaveBeenCalled();
      expect(buffer.hasMark()).toBe(true);
    });
  });

  it('should add to the editor menu', () => {
    const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(createMockParams()));
    expect(handler.shouldAddToEditorMenu()).toBe(true);
  });

  it('should reflect the submenu setting', () => {
    expect(toTestable(new MoveMarkedSelectionHereEditorCommandHandler(createMockParams({ shouldAddCommandsToSubmenu: true }))).shouldAddCommandToSubmenu()).toBe(true);
    expect(toTestable(new MoveMarkedSelectionHereEditorCommandHandler(createMockParams({ shouldAddCommandsToSubmenu: false }))).shouldAddCommandToSubmenu()).toBe(false);
  });
});
