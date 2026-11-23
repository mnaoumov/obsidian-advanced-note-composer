import type { ConsoleDebugComponent } from '@mnaoumov/obsidian-lib/components/console-debug-component';
import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type { ResourceLockComponent } from '@mnaoumov/obsidian-lib/resource-lock';
import type {
  App,
  Editor,
  MarkdownFileInfo,
  MarkdownView,
  Notice,
  TFile,
  Vault
} from 'obsidian';

import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';
import type { PluginSettings } from '../settings/plugin-settings.ts';
import type { HeadingMoveDestination } from './move-under-heading.ts';

import {
  CommandCategory,
  CommandMenuPlacement
} from '../settings/plugin-settings.ts';
import { MoveSelectionBuffer } from '../smart-cut/mark/move-selection-buffer.ts';
import { MoveMarkedSelectionUnderHeadingEditorCommandHandler } from './move-marked-selection-under-heading-editor-command-handler.ts';
import {
  pickHeadingMoveDestination,
  runMoveUnderHeading
} from './move-under-heading.ts';

vi.mock('./move-under-heading.ts', () => ({ pickHeadingMoveDestination: vi.fn(), runMoveUnderHeading: vi.fn() }));

interface CreateMocksOptions {
  readonly currentMtime?: number;
  readonly isSourceFound?: boolean;
  readonly shouldBlockCommandOnPath?: boolean;
}

interface Mocks {
  readonly buffer: MoveSelectionBuffer;
  readonly handler: TestableHandler;
  readonly showNotice: ReturnType<typeof vi.fn>;
}

interface TestableHandler {
  readonly canExecuteEditor: (editor: Editor, context: MarkdownFileInfo) => boolean;
  readonly executeEditor: (editor: Editor, context: MarkdownFileInfo) => Promise<void>;
  readonly id: string;
  readonly name: string;
  readonly shouldAddCommandToSubmenu: () => boolean;
  readonly shouldAddToEditorMenu: () => boolean;
  readonly shouldAddToViewportMenu: (view: MarkdownView, mode: string, source: string) => boolean;
}

const SOURCE_MTIME = 1000;
const CAPTURED_SELECTIONS = [{ endOffset: 4, startOffset: 1 }];

function createFile(mtime: number): TFile {
  return strictProxy<TFile>({ path: 'source.md', stat: strictProxy({ mtime }) });
}

function createMocks(options: CreateMocksOptions = {}): Mocks {
  const buffer = new MoveSelectionBuffer();
  const showNotice = vi.fn();
  const sourceFile = options.isSourceFound === false ? null : createFile(options.currentMtime ?? SOURCE_MTIME);
  const vault = strictProxy<Vault>({ getFileByPath: vi.fn().mockReturnValue(sourceFile) });
  const settings = strictProxy<PluginSettings>({
    commandMenuPlacement: vi.fn().mockReturnValue(CommandMenuPlacement.Both),
    shouldAddCommandsToSubmenu: true,
    shouldBlockCommandOnPath: vi.fn().mockReturnValue(options.shouldBlockCommandOnPath ?? false)
  });
  const handler = new MoveMarkedSelectionUnderHeadingEditorCommandHandler({
    app: strictProxy<App>({ vault }),
    consoleDebugComponent: strictProxy<ConsoleDebugComponent>({}),
    moveSelectionBuffer: buffer,
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice }),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings }),
    resourceLockComponent: strictProxy<ResourceLockComponent>({})
  });
  return { buffer, handler: castTo<TestableHandler>(handler), showNotice };
}

function mark(buffer: MoveSelectionBuffer): void {
  buffer.mark({
    abortController: new AbortController(),
    capturedSelections: CAPTURED_SELECTIONS,
    highlight: { [Symbol.dispose]: vi.fn() },
    lock: { [Symbol.dispose]: vi.fn() },
    markedHeading: null,
    notice: strictProxy<Notice>({ hide: vi.fn() }),
    selectedText: 'marked',
    sourceFile: createFile(SOURCE_MTIME),
    sourceMtime: SOURCE_MTIME
  });
}

const EDITOR = strictProxy<Editor>({});
const CONTEXT = strictProxy<MarkdownFileInfo>({ file: strictProxy<TFile>({ path: 'other.md' }) });

describe('MoveMarkedSelectionUnderHeadingEditorCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should follow the menu placement and submenu settings', () => {
    const { handler } = createMocks();
    expect(handler.shouldAddCommandToSubmenu()).toBe(true);
    expect(handler.shouldAddToEditorMenu()).toBe(true);
    expect(handler.shouldAddToViewportMenu(strictProxy<MarkdownView>({}), 'source', '')).toBe(true);
  });

  it('should have the expected id and name', () => {
    const { handler } = createMocks();
    expect(handler.id).toBe('move-marked-selection-under-heading');
    expect(handler.name).toBe('Smart cut & paste: Move marked selection under heading...');
  });

  it('should be offered only while a selection is marked in an existing note', () => {
    const { buffer, handler } = createMocks();
    expect(handler.canExecuteEditor(EDITOR, CONTEXT)).toBe(false);
    mark(buffer);
    expect(handler.canExecuteEditor(EDITOR, CONTEXT)).toBe(true);

    const missing = createMocks({ isSourceFound: false });
    mark(missing.buffer);
    expect(missing.handler.canExecuteEditor(EDITOR, CONTEXT)).toBe(false);

    const blocked = createMocks({ shouldBlockCommandOnPath: true });
    mark(blocked.buffer);
    expect(blocked.handler.canExecuteEditor(EDITOR, CONTEXT)).toBe(false);
  });

  it('should do nothing without a mark', async () => {
    const { handler } = createMocks();
    await handler.executeEditor(EDITOR, CONTEXT);
    expect(pickHeadingMoveDestination).not.toHaveBeenCalled();
  });

  it('should drop the mark when its note is gone', async () => {
    const { buffer, handler, showNotice } = createMocks({ isSourceFound: false });
    mark(buffer);
    await handler.executeEditor(EDITOR, CONTEXT);
    expect(showNotice).toHaveBeenCalledWith('The note the selection was marked in no longer exists.');
    expect(buffer.get()).toBeNull();
  });

  it('should refuse when the marked note changed since marking', async () => {
    const { buffer, handler, showNotice } = createMocks({ currentMtime: SOURCE_MTIME + 1 });
    mark(buffer);
    await handler.executeEditor(EDITOR, CONTEXT);
    expect(showNotice).toHaveBeenCalledWith('The note the selection was marked in has changed since it was marked. Mark the selection again.');
    expect(pickHeadingMoveDestination).not.toHaveBeenCalled();
  });

  it('should keep the mark when the picking was dismissed', async () => {
    const { buffer, handler } = createMocks();
    mark(buffer);
    vi.mocked(pickHeadingMoveDestination).mockResolvedValue(null);
    await handler.executeEditor(EDITOR, CONTEXT);
    expect(runMoveUnderHeading).not.toHaveBeenCalled();
    expect(buffer.get()).not.toBeNull();
  });

  it('should not move when the mark was cancelled while picking', async () => {
    const { buffer, handler } = createMocks();
    mark(buffer);
    vi.mocked(pickHeadingMoveDestination).mockImplementation(() => {
      buffer.clear();
      return Promise.resolve(castTo<HeadingMoveDestination>({}));
    });
    await handler.executeEditor(EDITOR, CONTEXT);
    expect(runMoveUnderHeading).not.toHaveBeenCalled();
  });

  it('should release the mark and move the marked selection', async () => {
    const { buffer, handler } = createMocks();
    mark(buffer);
    const destination = castTo<HeadingMoveDestination>({});
    vi.mocked(pickHeadingMoveDestination).mockResolvedValue(destination);
    vi.mocked(runMoveUnderHeading).mockImplementation(() => {
      expect(buffer.get()).toBeNull();
      return noopAsync();
    });
    await handler.executeEditor(EDITOR, CONTEXT);
    expect(pickHeadingMoveDestination).toHaveBeenCalledWith(expect.objectContaining({
      capturedSelections: CAPTURED_SELECTIONS,
      commandCategory: CommandCategory.SmartCutAndPaste
    }));
    expect(runMoveUnderHeading).toHaveBeenCalledWith(expect.objectContaining({
      capturedSelections: CAPTURED_SELECTIONS,
      destination,
      editor: EDITOR,
      selectedText: 'marked'
    }));
  });
});
