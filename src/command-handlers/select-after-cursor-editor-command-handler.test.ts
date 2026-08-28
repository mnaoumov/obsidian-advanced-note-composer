import type {
  App,
  Editor,
  EditorPosition,
  MarkdownFileInfo,
  TFile
} from 'obsidian';

import { castTo } from 'obsidian-dev-utils/object-utils';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { PluginSettings } from '../plugin-settings.ts';

import { CommandMenuPlacement } from '../plugin-settings.ts';
import { SelectAfterCursorEditorCommandHandler } from './select-after-cursor-editor-command-handler.ts';

const LAST_LINE = 12;
const LAST_LINE_TEXT = 'the final line';
const DOCUMENT_END: EditorPosition = { ch: LAST_LINE_TEXT.length, line: LAST_LINE };

interface TestableHandler {
  canExecuteEditor(editor: Editor, context: MarkdownFileInfo): boolean;
  executeEditor(editor: Editor, context: MarkdownFileInfo): void;
  readonly icon: string;
  readonly id: string;
  readonly name: string;
}

function createContext(): MarkdownFileInfo {
  return strictProxy<MarkdownFileInfo>({ file: strictProxy<TFile>({ path: 'test/note.md' }) });
}

function createEditor(cursor: EditorPosition): Editor {
  return strictProxy<Editor>({
    getCursor: vi.fn().mockReturnValue(cursor),
    getLine: vi.fn().mockReturnValue(LAST_LINE_TEXT),
    lastLine: vi.fn().mockReturnValue(LAST_LINE),
    setSelection: vi.fn()
  });
}

function createHandler(): TestableHandler {
  const settings = strictProxy<PluginSettings>({
    commandMenuPlacement: vi.fn().mockReturnValue(CommandMenuPlacement.EditorMenu),
    shouldAddCommandsToSubmenu: true,
    shouldBlockCommandOnPath: vi.fn().mockReturnValue(false)
  });
  return castTo<TestableHandler>(
    new SelectAfterCursorEditorCommandHandler({
      app: strictProxy<App>({}),
      pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings })
    })
  );
}

describe('SelectAfterCursorEditorCommandHandler', () => {
  it('should construct with correct params', () => {
    const handler = createHandler();
    expect(handler.id).toBe('select-after-cursor');
    expect(handler.name).toBe('Select after cursor');
    expect(handler.icon).toBe('lucide-arrow-down-from-line');
  });

  /*
   * Start-to-end, where `Extract after cursor...` anchors at the note's END and puts its head at the
   * cursor. The range is the same either way; the direction decides which end a phone's adjust handle
   * lands on, and the end of the range is the one worth being able to drag.
   */
  it('selects from the cursor down to the end of the note', () => {
    const cursor = { ch: 4, line: 7 };
    const editor = createEditor(cursor);

    createHandler().executeEditor(editor, createContext());

    expect(vi.mocked(editor.setSelection)).toHaveBeenCalledWith(cursor, DOCUMENT_END);
  });

  it('is available anywhere but the very end of the note', () => {
    expect(createHandler().canExecuteEditor(createEditor({ ch: 4, line: 7 }), createContext())).toBe(true);
    expect(createHandler().canExecuteEditor(createEditor({ ch: 0, line: LAST_LINE }), createContext())).toBe(true);
    expect(createHandler().canExecuteEditor(createEditor({ ch: DOCUMENT_END.ch, line: 7 }), createContext())).toBe(true);
  });

  it('is unavailable with the cursor at the very end of the note', () => {
    expect(createHandler().canExecuteEditor(createEditor(DOCUMENT_END), createContext())).toBe(false);
  });
});
