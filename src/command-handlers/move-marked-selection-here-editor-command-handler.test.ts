import type {
  App,
  Editor,
  MarkdownFileInfo,
  MarkdownView,
  Notice,
  TFile,
  Vault,
  Workspace
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
  SmartCutAndPasteMoveKind,
  TextAfterExtractionMode
} from '../plugin-settings.ts';
import { MoveMarkedSelectionHereEditorCommandHandler } from './move-marked-selection-here-editor-command-handler.ts';

interface CapturedComposerArguments {
  readonly capturedSelections: Selection[];
  readonly frontmatterMergeStrategy: FrontmatterMergeStrategy;
  readonly insertToken: string;
  readonly isNewTargetFile: boolean;
  readonly selectedText: string;
  readonly shouldFixFootnotes: boolean;
  readonly shouldIncludeFrontmatter: boolean;
  readonly shouldJumpToMovedContent: boolean;
  readonly smartCutAndPasteMoveKind: SmartCutAndPasteMoveKind;
  readonly sourceFile: TFile;
  readonly targetCursorEndOffset: number;
  readonly targetCursorOffset: number;
  readonly targetFile: TFile;
  readonly textAfterExtractionMode: TextAfterExtractionMode;
}

interface MockPosition {
  readonly ch: number;
}

interface TestableHandler {
  canExecuteEditor(editor: Editor, context: MarkdownFileInfo): boolean;
  canExecuteInActiveEditor(): boolean;
  executeEditor(editor: Editor, context: MarkdownFileInfo): Promise<void>;
  executeInActiveEditor(): Promise<void>;
  readonly icon: string;
  readonly id: string;
  readonly name: string;
  shouldAddCommandToSubmenu(): boolean;
  shouldAddToEditorMenu(): boolean;
}

function capturedComposerArguments(): CapturedComposerArguments {
  return castTo<CapturedComposerArguments>(MockSplitComposer.mock.calls[0]?.[0]);
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
  readonly activeView?: MarkdownView | null;
  readonly getFileByPathResult?: null | TFile;
  readonly isAdvanced?: boolean;
  readonly isPathIgnored?: boolean;
  readonly moveSelectionBuffer?: MoveSelectionBuffer;
  readonly shouldAddCommandsToSubmenu?: boolean;
  readonly shouldApplyTextAfterExtractionToSameFile?: boolean;
  readonly shouldBlockCommandOnPath?: boolean;
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
    highlight: { [Symbol.dispose]: vi.fn() },
    lock: { [Symbol.dispose]: vi.fn() },
    markedHeading: null,
    notice: strictProxy<Notice>({ hide: vi.fn() }),
    selectedText: 'marked text',
    sourceFile,
    sourceMtime: SOURCE_MTIME
  });
  return buffer;
}

function createMockContext(file: null | TFile): MarkdownFileInfo {
  return strictProxy<MarkdownFileInfo>({ file });
}

function createMockEditor(cursorOffset = 42): Editor {
  return strictProxy<Editor>({
    getCursor: vi.fn().mockReturnValue({ ch: 0, line: 0 }),
    posToOffset: vi.fn().mockReturnValue(cursorOffset)
  });
}

// An editor whose `from`/`to` cursor map to distinct offsets, i.e. an active selection in the target.
function createMockEditorWithSelection(fromOffset: number, toOffset: number): Editor {
  return strictProxy<Editor>({
    getCursor: vi.fn().mockImplementation((which?: string) => ({ ch: which === 'to' ? toOffset : fromOffset, line: 0 })),
    posToOffset: vi.fn().mockImplementation((pos: MockPosition) => pos.ch)
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
      }),
      workspace: strictProxy<Workspace>({
        getActiveViewOfType: vi.fn().mockReturnValue(options.activeView ?? null)
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
        shouldBlockCommandOnPath: vi.fn().mockReturnValue(options.shouldBlockCommandOnPath ?? false),
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
    expect(handler.name).toBe('Smart cut & paste: Move marked selection here');
    expect(handler.icon).toBe('lucide-clipboard-paste');
  });

  it('should construct the advanced command', () => {
    const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(createMockParams({ isAdvanced: true })));
    expect(handler.id).toBe('move-marked-selection-here-advanced');
    expect(handler.name).toBe('Smart cut & paste: Move marked selection here (advanced)...');
  });

  describe('canExecuteEditor', () => {
    it('should be unavailable when nothing is marked', () => {
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(createMockParams()));
      expect(handler.canExecuteEditor(createMockEditor(), createMockContext(createMockFile('target.md')))).toBe(false);
    });

    it('should be unavailable when there is no target file', () => {
      const source = createMockFile('source.md');
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(createMockParams({ moveSelectionBuffer: createMarkedBuffer(source) })));
      expect(handler.canExecuteEditor(createMockEditor(), createMockContext(null))).toBe(false);
    });

    it('should be unavailable when the source note no longer exists', () => {
      const source = createMockFile('source.md');
      const handler = toTestable(
        new MoveMarkedSelectionHereEditorCommandHandler(createMockParams({
          getFileByPathResult: null,
          moveSelectionBuffer: createMarkedBuffer(source)
        }))
      );
      expect(handler.canExecuteEditor(createMockEditor(), createMockContext(createMockFile('target.md')))).toBe(false);
    });

    it('should be unavailable when the cursor is inside the marked selection in the same note', () => {
      const source = createMockFile('source.md');
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(createMockParams({ moveSelectionBuffer: createMarkedBuffer(source) })));
      expect(handler.canExecuteEditor(createMockEditor(7), createMockContext(createMockFile('source.md')))).toBe(false);
    });

    it('should be available when the cursor is outside the marked selection in the same note', () => {
      const source = createMockFile('source.md');
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(createMockParams({ moveSelectionBuffer: createMarkedBuffer(source) })));
      expect(handler.canExecuteEditor(createMockEditor(20), createMockContext(createMockFile('source.md')))).toBe(true);
    });

    it('should be available when moving into a different note', () => {
      const source = createMockFile('source.md');
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(createMockParams({ moveSelectionBuffer: createMarkedBuffer(source) })));
      expect(handler.canExecuteEditor(createMockEditor(), createMockContext(createMockFile('target.md')))).toBe(true);
    });

    it('should be unavailable when the target selection overlaps the marked selection in the same note', () => {
      const source = createMockFile('source.md');
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(createMockParams({ moveSelectionBuffer: createMarkedBuffer(source) })));
      // Marked selection is offsets 5..10; a target selection of 7..9 overlaps it.
      expect(handler.canExecuteEditor(createMockEditorWithSelection(7, 9), createMockContext(createMockFile('source.md')))).toBe(false);
    });

    it('should be available when the target selection is clear of the marked selection in the same note', () => {
      const source = createMockFile('source.md');
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(createMockParams({ moveSelectionBuffer: createMarkedBuffer(source) })));
      // A target selection of 12..15 does not overlap the marked 5..10.
      expect(handler.canExecuteEditor(createMockEditorWithSelection(12, 15), createMockContext(createMockFile('source.md')))).toBe(true);
    });

    it('should be unavailable when the command is blocked on the target path', () => {
      const source = createMockFile('source.md');
      const handler = toTestable(
        new MoveMarkedSelectionHereEditorCommandHandler(createMockParams({ moveSelectionBuffer: createMarkedBuffer(source), shouldBlockCommandOnPath: true }))
      );
      expect(handler.canExecuteEditor(createMockEditor(), createMockContext(createMockFile('target.md')))).toBe(false);
    });
  });

  describe('executeEditor', () => {
    it('should return when there is no target file', async () => {
      const source = createMockFile('source.md');
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(createMockParams({ moveSelectionBuffer: createMarkedBuffer(source) })));
      await handler.executeEditor(createMockEditor(), createMockContext(null));
      expect(MockSplitComposer).not.toHaveBeenCalled();
    });

    it('should return when nothing is marked', async () => {
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(createMockParams()));
      await handler.executeEditor(createMockEditor(), createMockContext(createMockFile('target.md')));
      expect(MockSplitComposer).not.toHaveBeenCalled();
    });

    it('should notice and clear the mark when the source note no longer exists', async () => {
      const source = createMockFile('source.md');
      const buffer = createMarkedBuffer(source);
      const params = createMockParams({ getFileByPathResult: null, moveSelectionBuffer: buffer });
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(params));

      await handler.executeEditor(createMockEditor(), createMockContext(createMockFile('target.md')));

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
        append: vi.fn(),
        appendChild: vi.fn(),
        appendText: vi.fn()
      });
      mockCreateFragmentAsync.mockImplementation(async (callback) => {
        await (callback as (f: DocumentFragment) => Promise<void>)(mockFragment);
        return mockFragment;
      });
      mockRenderInternalLink.mockResolvedValue(createEl('a'));

      await handler.executeEditor(createMockEditor(), createMockContext(createMockFile('target.md')));

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

      await handler.executeEditor(createMockEditor(), createMockContext(createMockFile('target.md')));

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

      await handler.executeEditor(createMockEditor(42), createMockContext(target));

      expect(mockOpenPasteOptionsModal).not.toHaveBeenCalled();
      expect(MockSplitComposer).toHaveBeenCalledTimes(1);
      const $arguments = capturedComposerArguments();
      expect($arguments.capturedSelections).toBe(CAPTURED_SELECTIONS);
      expect($arguments.frontmatterMergeStrategy).toBe(FrontmatterMergeStrategy.MergeAndPreferNewValues);
      expect($arguments.insertToken).toContain('advanced-note-composer-move-');
      expect($arguments.isNewTargetFile).toBe(false);
      expect($arguments.selectedText).toBe('marked text');
      expect($arguments.shouldFixFootnotes).toBe(true);
      expect($arguments.shouldIncludeFrontmatter).toBe(false);
      // A move AT THE CURSOR always lands the cursor on the moved content — there is no setting for it
      // (issue #144); only the top/bottom moves are configurable.
      expect($arguments.shouldJumpToMovedContent).toBe(true);
      // The kind both marks this as a smart cut & paste move and selects its template: the at-cursor move
      // Has no override of its own, so it always takes the shared template (issue #174).
      expect($arguments.smartCutAndPasteMoveKind).toBe(SmartCutAndPasteMoveKind.AtCursor);
      expect($arguments.sourceFile).toBe(resolvedSource);
      expect($arguments.targetCursorOffset).toBe(42);
      expect($arguments.targetCursorEndOffset).toBe(42);
      expect($arguments.targetFile).toBe(target);
      expect($arguments.textAfterExtractionMode).toBe(TextAfterExtractionMode.LinkToNewFile);
      expect(buffer.hasMark()).toBe(false);
      expect(mockSplitFile).toHaveBeenCalledTimes(1);
    });

    it('should replace the target selection (paste semantics) when one is active', async () => {
      const source = createMockFile('source.md');
      const target = createMockFile('target.md');
      const buffer = createMarkedBuffer(source);
      const params = createMockParams({ getFileByPathResult: createMockFile('source.md'), moveSelectionBuffer: buffer });
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(params));

      await handler.executeEditor(createMockEditorWithSelection(12, 15), createMockContext(target));

      const $arguments = capturedComposerArguments();
      expect($arguments.targetCursorOffset).toBe(12);
      expect($arguments.targetCursorEndOffset).toBe(15);
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

      await handler.executeEditor(createMockEditor(42), createMockContext(createMockFile('source.md')));

      expect(capturedComposerArguments().textAfterExtractionMode).toBe(TextAfterExtractionMode.None);
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

      await handler.executeEditor(createMockEditor(42), createMockContext(createMockFile('source.md')));

      expect(capturedComposerArguments().textAfterExtractionMode).toBe(TextAfterExtractionMode.EmbedNewFile);
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

      await handler.executeEditor(createMockEditor(), createMockContext(createMockFile('target.md')));

      expect(mockOpenPasteOptionsModal).toHaveBeenCalledTimes(1);
      expect(MockSplitComposer).toHaveBeenCalledTimes(1);
      const $arguments = capturedComposerArguments();
      expect($arguments.frontmatterMergeStrategy).toBe(FrontmatterMergeStrategy.KeepOriginalFrontmatter);
      expect($arguments.shouldFixFootnotes).toBe(false);
      expect($arguments.shouldIncludeFrontmatter).toBe(true);
      expect($arguments.textAfterExtractionMode).toBe(TextAfterExtractionMode.EmbedNewFile);
      expect(buffer.hasMark()).toBe(false);
    });

    it('should not move when the advanced options modal is cancelled', async () => {
      const source = createMockFile('source.md');
      const buffer = createMarkedBuffer(source);
      const params = createMockParams({ isAdvanced: true, moveSelectionBuffer: buffer });
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(params));

      mockOpenPasteOptionsModal.mockResolvedValue(null);

      await handler.executeEditor(createMockEditor(), createMockContext(createMockFile('target.md')));

      expect(MockSplitComposer).not.toHaveBeenCalled();
      expect(buffer.hasMark()).toBe(true);
    });
  });

  describe('active-editor entry points (used by the notice buttons)', () => {
    function createActiveView(): MarkdownView {
      return strictProxy<MarkdownView>({
        editor: createMockEditor(),
        file: createMockFile('target.md')
      });
    }

    it('canExecuteInActiveEditor is false when there is no active markdown view', () => {
      const source = createMockFile('source.md');
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(createMockParams({ activeView: null, moveSelectionBuffer: createMarkedBuffer(source) })));
      expect(handler.canExecuteInActiveEditor()).toBe(false);
    });

    it('canExecuteInActiveEditor delegates to canExecuteEditor for the active view', () => {
      const source = createMockFile('source.md');
      const handler = toTestable(
        new MoveMarkedSelectionHereEditorCommandHandler(createMockParams({
          activeView: createActiveView(),
          getFileByPathResult: createMockFile('source.md'),
          moveSelectionBuffer: createMarkedBuffer(source)
        }))
      );
      expect(handler.canExecuteInActiveEditor()).toBe(true);
    });

    it('executeInActiveEditor is a no-op when there is no active markdown view', async () => {
      const source = createMockFile('source.md');
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(createMockParams({ activeView: null, moveSelectionBuffer: createMarkedBuffer(source) })));
      await handler.executeInActiveEditor();
      expect(MockSplitComposer).not.toHaveBeenCalled();
    });

    it('executeInActiveEditor is a no-op when the command cannot run in the active view', async () => {
      const handler = toTestable(new MoveMarkedSelectionHereEditorCommandHandler(createMockParams({ activeView: createActiveView() })));
      await handler.executeInActiveEditor();
      expect(MockSplitComposer).not.toHaveBeenCalled();
    });

    it('executeInActiveEditor runs the move against the active view', async () => {
      const source = createMockFile('source.md');
      const handler = toTestable(
        new MoveMarkedSelectionHereEditorCommandHandler(createMockParams({
          activeView: createActiveView(),
          getFileByPathResult: createMockFile('source.md'),
          moveSelectionBuffer: createMarkedBuffer(source)
        }))
      );
      await handler.executeInActiveEditor();
      expect(MockSplitComposer).toHaveBeenCalledTimes(1);
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
