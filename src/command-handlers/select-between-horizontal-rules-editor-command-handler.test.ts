import type {
  App,
  Editor,
  MarkdownFileInfo,
  TFile
} from 'obsidian';

import { castTo } from 'obsidian-dev-utils/object-utils';
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

import { getSelectionBetweenHorizontalRules } from '../horizontal-rules.ts';
import { CommandMenuPlacement } from '../plugin-settings.ts';
import { SelectBetweenHorizontalRulesEditorCommandHandler } from './select-between-horizontal-rules-editor-command-handler.ts';

vi.mock('../horizontal-rules.ts', () => ({
  getSelectionBetweenHorizontalRules: vi.fn()
}));

const mockGetSelectionBetweenHorizontalRules = vi.mocked(getSelectionBetweenHorizontalRules);

const RANGE = {
  end: { ch: 3, line: 8 },
  start: { ch: 0, line: 4 }
};

interface TestableHandler {
  canExecuteEditor(editor: Editor, context: MarkdownFileInfo): boolean;
  executeEditor(editor: Editor, context: MarkdownFileInfo): void;
  readonly icon: string;
  readonly id: string;
  readonly name: string;
}

function createContext(file: null | TFile = strictProxy<TFile>({ path: 'test/note.md' })): MarkdownFileInfo {
  return strictProxy<MarkdownFileInfo>({ file });
}

function createEditor(): Editor {
  return strictProxy<Editor>({
    getCursor: vi.fn().mockReturnValue({ ch: 0, line: 6 }),
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
    new SelectBetweenHorizontalRulesEditorCommandHandler({
      app: strictProxy<App>({}),
      pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings })
    })
  );
}

describe('SelectBetweenHorizontalRulesEditorCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should construct with correct params', () => {
    const handler = createHandler();
    expect(handler.id).toBe('select-between-horizontal-rules');
    expect(handler.name).toBe('Select between horizontal rules');
    expect(handler.icon).toBe('lucide-separator-horizontal');
  });

  it('is unavailable with no file in context', () => {
    expect(createHandler().canExecuteEditor(createEditor(), createContext(null))).toBe(false);
    expect(mockGetSelectionBetweenHorizontalRules).not.toHaveBeenCalled();
  });

  it('is unavailable in a note with no rule-bounded section', () => {
    mockGetSelectionBetweenHorizontalRules.mockReturnValue(null);
    expect(createHandler().canExecuteEditor(createEditor(), createContext())).toBe(false);
  });

  it('selects the block between the rules closest to the cursor', () => {
    mockGetSelectionBetweenHorizontalRules.mockReturnValue(RANGE);
    const editor = createEditor();

    createHandler().executeEditor(editor, createContext());

    expect(vi.mocked(editor.setSelection)).toHaveBeenCalledWith(RANGE.start, RANGE.end);
    expect(mockGetSelectionBetweenHorizontalRules).toHaveBeenCalledWith(expect.objectContaining({ lineNumber: 6 }));
  });

  it('selects nothing with no file in context', () => {
    const editor = createEditor();
    createHandler().executeEditor(editor, createContext(null));
    expect(vi.mocked(editor.setSelection)).not.toHaveBeenCalled();
  });
});
