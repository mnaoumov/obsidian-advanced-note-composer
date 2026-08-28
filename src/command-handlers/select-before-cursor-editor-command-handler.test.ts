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
import { SelectBeforeCursorEditorCommandHandler } from './select-before-cursor-editor-command-handler.ts';

const DOCUMENT_START: EditorPosition = { ch: 0, line: 0 };

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
    new SelectBeforeCursorEditorCommandHandler({
      app: strictProxy<App>({}),
      pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings })
    })
  );
}

describe('SelectBeforeCursorEditorCommandHandler', () => {
  it('should construct with correct params', () => {
    const handler = createHandler();
    expect(handler.id).toBe('select-before-cursor');
    expect(handler.name).toBe('Select before cursor');
    expect(handler.icon).toBe('lucide-arrow-up-from-line');
  });

  it('selects from the top of the note down to the cursor', () => {
    const cursor = { ch: 4, line: 7 };
    const editor = createEditor(cursor);

    createHandler().executeEditor(editor, createContext());

    expect(vi.mocked(editor.setSelection)).toHaveBeenCalledWith(DOCUMENT_START, cursor);
  });

  it('is available anywhere but the very start of the note', () => {
    expect(createHandler().canExecuteEditor(createEditor({ ch: 4, line: 7 }), createContext())).toBe(true);
    expect(createHandler().canExecuteEditor(createEditor({ ch: 1, line: 0 }), createContext())).toBe(true);
    expect(createHandler().canExecuteEditor(createEditor({ ch: 0, line: 3 }), createContext())).toBe(true);
  });

  // Nothing sits above the first character, so selecting "before" it would select an empty range.
  it('is unavailable with the cursor at the very start of the note', () => {
    expect(createHandler().canExecuteEditor(createEditor(DOCUMENT_START), createContext())).toBe(false);
  });
});
