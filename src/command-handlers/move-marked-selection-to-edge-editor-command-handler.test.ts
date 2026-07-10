import type {
  App,
  Editor,
  MarkdownFileInfo,
  Notice,
  TFile,
  Vault
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { Selection } from '../composers/composer-base.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';

import { SplitComposer } from '../composers/split-composer.ts';
import { InsertMode } from '../insert-mode.ts';
import { MoveSelectionBuffer } from '../move-selection-buffer.ts';
import {
  FrontmatterMergeStrategy,
  TextAfterExtractionMode
} from '../plugin-settings.ts';
import { MoveMarkedSelectionToEdgeEditorCommandHandler } from './move-marked-selection-to-edge-editor-command-handler.ts';

interface CapturedComposerArgs {
  readonly insertMode: InsertMode;
  readonly insertToken: string;
  readonly shouldFixFootnotes: boolean;
  readonly shouldIncludeFrontmatter: boolean;
  readonly sourceFile: TFile;
  readonly targetCursorOffset: null | number;
  readonly targetFile: TFile;
  readonly textAfterExtractionMode: TextAfterExtractionMode;
}

interface CreateMockParamsOptions {
  readonly insertMode?: InsertMode;
  readonly moveSelectionBuffer?: MoveSelectionBuffer;
}

interface HandlerParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly insertMode: InsertMode;
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

const SOURCE_MTIME = 1000;

vi.mock('../composers/split-composer.ts', () => {
  const MockSplitComposer = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- vi.fn() prototype is untyped in mock factories.
  MockSplitComposer.prototype.splitFile = vi.fn().mockResolvedValue(undefined);
  return { SplitComposer: MockSplitComposer };
});

const MockSplitComposer = vi.mocked(SplitComposer);

function capturedComposerArgs(): CapturedComposerArgs {
  return castTo<CapturedComposerArgs>(MockSplitComposer.mock.calls[0]?.[0]);
}

function createMarkedBuffer(sourceFile: TFile, capturedSelections: Selection[]): MoveSelectionBuffer {
  const buffer = new MoveSelectionBuffer();
  buffer.mark({
    abortController: new AbortController(),
    capturedSelections,
    highlight: { [Symbol.dispose]: vi.fn() },
    lock: { [Symbol.dispose]: vi.fn() },
    notice: strictProxy<Notice>({ hide: vi.fn() }),
    selectedText: 'marked text',
    sourceFile,
    sourceMtime: SOURCE_MTIME
  });
  return buffer;
}

function createMockCtx(file: null | TFile): MarkdownFileInfo {
  return strictProxy<MarkdownFileInfo>({ file });
}

function createMockEditor(value = 'one two three'): Editor {
  return strictProxy<Editor>({
    getValue: vi.fn().mockReturnValue(value)
  });
}

function createMockFile(path: string, mtime = SOURCE_MTIME): TFile {
  return strictProxy<TFile>({
    path,
    stat: strictProxy({ mtime })
  });
}

function createMockParams(options: CreateMockParamsOptions = {}): HandlerParams {
  return {
    app: strictProxy<App>({
      vault: strictProxy<Vault>({
        getFileByPath: vi.fn().mockReturnValue(createMockFile('source.md'))
      })
    }),
    consoleDebugComponent: strictProxy<ConsoleDebugComponent>({ consoleDebug: vi.fn() }),
    insertMode: options.insertMode ?? InsertMode.Append,
    moveSelectionBuffer: options.moveSelectionBuffer ?? new MoveSelectionBuffer(),
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice: vi.fn().mockReturnValue({ hide: vi.fn() }) }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
      settings: strictProxy<PluginSettings>({
        defaultFrontmatterMergeStrategy: FrontmatterMergeStrategy.MergeAndPreferNewValues,
        isPathIgnored: vi.fn().mockReturnValue(false),
        shouldApplyTextAfterExtractionToSameFile: false,
        shouldFixFootnotesByDefault: true,
        shouldIncludeFrontmatterWhenSplittingByDefault: false,
        textAfterExtractionMode: TextAfterExtractionMode.LinkToNewFile
      })
    }),
    resourceLockComponent: strictProxy<ResourceLockComponent>({})
  };
}

function toTestable(handler: MoveMarkedSelectionToEdgeEditorCommandHandler): TestableHandler {
  return castTo<TestableHandler>(handler);
}

describe('MoveMarkedSelectionToEdgeEditorCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockSplitComposer.prototype.splitFile = vi.fn().mockResolvedValue(undefined);
  });

  it('should construct the bottom command for append', () => {
    const handler = toTestable(new MoveMarkedSelectionToEdgeEditorCommandHandler(createMockParams({ insertMode: InsertMode.Append })));
    expect(handler.id).toBe('move-marked-selection-to-bottom-of-file');
    expect(handler.name).toBe('Smart cut & paste: Move marked selection to bottom of file');
  });

  it('should construct the top command for prepend', () => {
    const handler = toTestable(new MoveMarkedSelectionToEdgeEditorCommandHandler(createMockParams({ insertMode: InsertMode.Prepend })));
    expect(handler.id).toBe('move-marked-selection-to-top-of-file');
    expect(handler.name).toBe('Smart cut & paste: Move marked selection to top of file');
  });

  it('should throw for an unknown insert mode', () => {
    expect(() => new MoveMarkedSelectionToEdgeEditorCommandHandler(createMockParams({ insertMode: castTo<InsertMode>('bogus') }))).toThrow();
  });

  describe('canExecuteEditor', () => {
    it('should be available when moving to the bottom of the same note', () => {
      const source = createMockFile('source.md');
      const handler = toTestable(
        new MoveMarkedSelectionToEdgeEditorCommandHandler(
          createMockParams({ insertMode: InsertMode.Append, moveSelectionBuffer: createMarkedBuffer(source, [{ endOffset: 10, startOffset: 5 }]) })
        )
      );
      expect(handler.canExecuteEditor(createMockEditor(), createMockCtx(createMockFile('source.md')))).toBe(true);
    });

    it('should be unavailable when the top offset falls inside a selection spanning the frontmatter', () => {
      const source = createMockFile('source.md');
      // Frontmatter ends (contentStart) at offset 10; the selection [8, 12) straddles it.
      const handler = toTestable(
        new MoveMarkedSelectionToEdgeEditorCommandHandler(
          createMockParams({ insertMode: InsertMode.Prepend, moveSelectionBuffer: createMarkedBuffer(source, [{ endOffset: 12, startOffset: 8 }]) })
        )
      );
      expect(handler.canExecuteEditor(createMockEditor('---\nx\n---\nbody'), createMockCtx(createMockFile('source.md')))).toBe(false);
    });

    it('should be available when moving to a different note', () => {
      const source = createMockFile('source.md');
      const handler = toTestable(
        new MoveMarkedSelectionToEdgeEditorCommandHandler(
          createMockParams({ insertMode: InsertMode.Prepend, moveSelectionBuffer: createMarkedBuffer(source, [{ endOffset: 10, startOffset: 5 }]) })
        )
      );
      expect(handler.canExecuteEditor(createMockEditor(), createMockCtx(createMockFile('target.md')))).toBe(true);
    });
  });

  describe('executeEditor', () => {
    it('should move using default settings with no cursor offset and a derived insert mode', async () => {
      const source = createMockFile('source.md');
      const buffer = createMarkedBuffer(source, [{ endOffset: 10, startOffset: 5 }]);
      const params = createMockParams({ insertMode: InsertMode.Prepend, moveSelectionBuffer: buffer });
      const handler = toTestable(new MoveMarkedSelectionToEdgeEditorCommandHandler(params));

      await handler.executeEditor(createMockEditor(), createMockCtx(createMockFile('target.md')));

      expect(MockSplitComposer).toHaveBeenCalledTimes(1);
      const args = capturedComposerArgs();
      expect(args.insertMode).toBe(InsertMode.Prepend);
      expect(args.targetCursorOffset).toBeNull();
      expect(args.insertToken).toContain('advanced-note-composer-move-');
      expect(args.shouldFixFootnotes).toBe(true);
      expect(args.textAfterExtractionMode).toBe(TextAfterExtractionMode.LinkToNewFile);
      expect(buffer.hasMark()).toBe(false);
    });
  });
});
