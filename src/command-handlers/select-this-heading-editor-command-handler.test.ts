import type { HeadingInfo } from '@obsidian-typings/obsidian-public-latest/implementations';
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

import { CommandMenuPlacement } from '../plugin-settings.ts';
import { resolveEnclosingHeadingInfo } from '../select-ranges.ts';
import { SelectThisHeadingEditorCommandHandler } from './select-this-heading-editor-command-handler.ts';

vi.mock('../select-ranges.ts', () => ({
  resolveEnclosingHeadingInfo: vi.fn()
}));

const mockResolveEnclosingHeadingInfo = vi.mocked(resolveEnclosingHeadingInfo);

const HEADING_INFO: HeadingInfo = {
  end: { ch: 12, line: 9 },
  heading: 'Section',
  start: { ch: 0, line: 3 }
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
  return strictProxy<Editor>({ setSelection: vi.fn() });
}

function createHandler(): TestableHandler {
  const settings = strictProxy<PluginSettings>({
    commandMenuPlacement: vi.fn().mockReturnValue(CommandMenuPlacement.EditorMenu),
    shouldAddCommandsToSubmenu: true,
    shouldBlockCommandOnPath: vi.fn().mockReturnValue(false)
  });
  return castTo<TestableHandler>(
    new SelectThisHeadingEditorCommandHandler({
      app: strictProxy<App>({}),
      pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings })
    })
  );
}

describe('SelectThisHeadingEditorCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should construct with correct params', () => {
    const handler = createHandler();
    expect(handler.id).toBe('select-this-heading');
    // No trailing `...`: in this plugin that suffix marks a command that opens a modal, and this one does
    // Not — which is the entire point of issue #266.
    expect(handler.name).toBe('Select this heading');
    expect(handler.icon).toBe('lucide-heading');
  });

  it('is unavailable with no file in context', () => {
    expect(createHandler().canExecuteEditor(createEditor(), createContext(null))).toBe(false);
    expect(mockResolveEnclosingHeadingInfo).not.toHaveBeenCalled();
  });

  it('is unavailable when the cursor is under no heading', () => {
    mockResolveEnclosingHeadingInfo.mockReturnValue(null);
    expect(createHandler().canExecuteEditor(createEditor(), createContext())).toBe(false);
  });

  it('is available under a heading', () => {
    mockResolveEnclosingHeadingInfo.mockReturnValue(HEADING_INFO);
    expect(createHandler().canExecuteEditor(createEditor(), createContext())).toBe(true);
  });

  // The same range `Extract this heading...` sets before opening its modal — the reporter was getting it
  // By running that extract and cancelling the modal.
  it('selects the heading line together with its whole section', () => {
    mockResolveEnclosingHeadingInfo.mockReturnValue(HEADING_INFO);
    const editor = createEditor();

    createHandler().executeEditor(editor, createContext());

    expect(vi.mocked(editor.setSelection)).toHaveBeenCalledWith(HEADING_INFO.start, HEADING_INFO.end);
  });

  it('selects nothing with no file in context', () => {
    const editor = createEditor();
    createHandler().executeEditor(editor, createContext(null));
    expect(vi.mocked(editor.setSelection)).not.toHaveBeenCalled();
  });
});
