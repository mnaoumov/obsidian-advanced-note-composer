import type { ConsoleDebugComponent } from '@mnaoumov/obsidian-lib/components/console-debug-component';
import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type { ResourceLockComponent } from '@mnaoumov/obsidian-lib/resource-lock';
import type {
  App,
  Editor,
  EditorPosition,
  MarkdownFileInfo,
  MarkdownView,
  TFile
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

import { InsertMode } from '../composers/insert-mode.ts';
import {
  CommandCategory,
  CommandMenuPlacement
} from '../settings/plugin-settings.ts';
import { MoveSelectionUnderHeadingEditorCommandHandler } from './move-selection-under-heading-editor-command-handler.ts';
import {
  pickHeadingMoveDestination,
  runMoveUnderHeading
} from './move-under-heading.ts';

vi.mock('./move-under-heading.ts', () => ({ pickHeadingMoveDestination: vi.fn(), runMoveUnderHeading: vi.fn() }));

interface LockForPathParams {
  readonly abortController: AbortController;
}

interface Mocks {
  readonly handler: TestableHandler;
  readonly lockForPath: ReturnType<typeof vi.fn>;
  readonly releaseLock: ReturnType<typeof vi.fn>;
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

function createEditor(hasSelection = true): Editor {
  const anchor: EditorPosition = { ch: 0, line: 0 };
  const head: EditorPosition = { ch: 2, line: 0 };
  return strictProxy<Editor>({
    getSelection: vi.fn().mockReturnValue('xy'),
    listSelections: vi.fn().mockReturnValue([{ anchor, head }]),
    posToOffset: vi.fn((position: EditorPosition) => position.ch),
    somethingSelected: vi.fn().mockReturnValue(hasSelection)
  });
}

function createMocks(shouldBlockCommandOnPath = false): Mocks {
  const releaseLock = vi.fn();
  const lockForPath = vi.fn().mockReturnValue({ [Symbol.dispose]: releaseLock });
  const settings = strictProxy<PluginSettings>({
    commandMenuPlacement: vi.fn().mockReturnValue(CommandMenuPlacement.Both),
    shouldAddCommandsToSubmenu: true,
    shouldBlockCommandOnPath: vi.fn().mockReturnValue(shouldBlockCommandOnPath)
  });
  const handler = new MoveSelectionUnderHeadingEditorCommandHandler({
    app: strictProxy<App>({}),
    consoleDebugComponent: strictProxy<ConsoleDebugComponent>({}),
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({}),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings }),
    resourceLockComponent: strictProxy<ResourceLockComponent>({ lockForPath })
  });
  return { handler: castTo<TestableHandler>(handler), lockForPath, releaseLock };
}

const SOURCE_FILE = strictProxy<TFile>({ path: 'source.md' });

function createContext(file: null | TFile = SOURCE_FILE): MarkdownFileInfo {
  return strictProxy<MarkdownFileInfo>({ file });
}

describe('MoveSelectionUnderHeadingEditorCommandHandler', () => {
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
    expect(handler.id).toBe('move-selection-under-heading');
    expect(handler.name).toBe('Move selection under heading...');
  });

  it('should be offered only with a selection', () => {
    const { handler } = createMocks();
    expect(handler.canExecuteEditor(createEditor(true), createContext())).toBe(true);
    expect(handler.canExecuteEditor(createEditor(false), createContext())).toBe(false);
  });

  it('should not be offered on a blocked path', () => {
    const { handler } = createMocks(true);
    expect(handler.canExecuteEditor(createEditor(true), createContext())).toBe(false);
  });

  it('should do nothing without a file', async () => {
    const { handler } = createMocks();
    await handler.executeEditor(createEditor(), createContext(null));
    expect(pickHeadingMoveDestination).not.toHaveBeenCalled();
  });

  it('should hold the source lock while picking and release it before moving', async () => {
    const { handler, lockForPath, releaseLock } = createMocks();
    const destination = castTo<HeadingMoveDestination>({ insertMode: InsertMode.Append });
    vi.mocked(pickHeadingMoveDestination).mockImplementation(() => {
      expect(releaseLock).not.toHaveBeenCalled();
      return Promise.resolve(destination);
    });
    vi.mocked(runMoveUnderHeading).mockImplementation(() => {
      expect(releaseLock).toHaveBeenCalled();
      return noopAsync();
    });
    const editor = createEditor();
    await handler.executeEditor(editor, createContext());
    expect(lockForPath).toHaveBeenCalledWith(expect.objectContaining({ pathOrFile: SOURCE_FILE }));
    expect(pickHeadingMoveDestination).toHaveBeenCalledWith(expect.objectContaining({
      capturedSelections: [{ endOffset: 2, startOffset: 0 }],
      commandCategory: CommandCategory.SplitAndExtract,
      sourceFile: SOURCE_FILE
    }));
    expect(runMoveUnderHeading).toHaveBeenCalledWith(expect.objectContaining({ destination, editor, selectedText: 'xy', sourceFile: SOURCE_FILE }));
  });

  it('should not move when the picking was dismissed', async () => {
    const { handler } = createMocks();
    vi.mocked(pickHeadingMoveDestination).mockResolvedValue(null);
    await handler.executeEditor(createEditor(), createContext());
    expect(runMoveUnderHeading).not.toHaveBeenCalled();
  });

  it('should not move when the source lock was taken away while picking', async () => {
    const { handler, lockForPath } = createMocks();
    vi.mocked(pickHeadingMoveDestination).mockImplementation(() => {
      const params = castTo<LockForPathParams>(lockForPath.mock.calls[0]?.[0]);
      params.abortController.abort();
      return Promise.resolve(castTo<HeadingMoveDestination>({}));
    });
    await handler.executeEditor(createEditor(), createContext());
    expect(runMoveUnderHeading).not.toHaveBeenCalled();
  });
});
