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
import {
  getHeadingContentSelection,
  resolveEnclosingHeadingInfo
} from '../select-ranges.ts';
import { SelectThisHeadingContentEditorCommandHandler } from './select-this-heading-content-editor-command-handler.ts';

vi.mock('../select-ranges.ts', () => ({
  getHeadingContentSelection: vi.fn(),
  resolveEnclosingHeadingInfo: vi.fn()
}));

const mockGetHeadingContentSelection = vi.mocked(getHeadingContentSelection);
const mockResolveEnclosingHeadingInfo = vi.mocked(resolveEnclosingHeadingInfo);

const HEADING_INFO: HeadingInfo = {
  end: { ch: 12, line: 9 },
  heading: 'Section',
  start: { ch: 0, line: 3 }
};

const CONTENT_RANGE = {
  end: { ch: 12, line: 9 },
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
  return strictProxy<Editor>({ setSelection: vi.fn() });
}

function createHandler(): TestableHandler {
  const settings = strictProxy<PluginSettings>({
    commandMenuPlacement: vi.fn().mockReturnValue(CommandMenuPlacement.EditorMenu),
    shouldAddCommandsToSubmenu: true,
    shouldBlockCommandOnPath: vi.fn().mockReturnValue(false)
  });
  return castTo<TestableHandler>(
    new SelectThisHeadingContentEditorCommandHandler({
      app: strictProxy<App>({}),
      pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings })
    })
  );
}

describe('SelectThisHeadingContentEditorCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should construct with correct params', () => {
    const handler = createHandler();
    expect(handler.id).toBe('select-this-heading-content');
    expect(handler.name).toBe('Select this heading\'s content');
    expect(handler.icon).toBe('lucide-text');
  });

  it('is unavailable with no file in context', () => {
    expect(createHandler().canExecuteEditor(createEditor(), createContext(null))).toBe(false);
    expect(mockResolveEnclosingHeadingInfo).not.toHaveBeenCalled();
  });

  it('is unavailable when the cursor is under no heading', () => {
    mockResolveEnclosingHeadingInfo.mockReturnValue(null);
    expect(createHandler().canExecuteEditor(createEditor(), createContext())).toBe(false);
    expect(mockGetHeadingContentSelection).not.toHaveBeenCalled();
  });

  // A heading with nothing under it has no content to select, so the command stays out of the palette
  // Rather than selecting an empty range.
  it('is unavailable on a heading with no body', () => {
    mockResolveEnclosingHeadingInfo.mockReturnValue(HEADING_INFO);
    mockGetHeadingContentSelection.mockReturnValue(null);
    expect(createHandler().canExecuteEditor(createEditor(), createContext())).toBe(false);
  });

  it('selects the section without its heading line', () => {
    mockResolveEnclosingHeadingInfo.mockReturnValue(HEADING_INFO);
    mockGetHeadingContentSelection.mockReturnValue(CONTENT_RANGE);
    const editor = createEditor();

    createHandler().executeEditor(editor, createContext());

    expect(vi.mocked(editor.setSelection)).toHaveBeenCalledWith(CONTENT_RANGE.start, CONTENT_RANGE.end);
    expect(mockGetHeadingContentSelection).toHaveBeenCalledWith({ editor, headingInfo: HEADING_INFO });
  });

  it('selects nothing with no file in context', () => {
    const editor = createEditor();
    createHandler().executeEditor(editor, createContext(null));
    expect(vi.mocked(editor.setSelection)).not.toHaveBeenCalled();
  });
});
