import type {
  App,
  Editor,
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
import type { SelectionRange } from '../select-ranges.ts';

import { CommandMenuPlacement } from '../plugin-settings.ts';
import { SelectRangeEditorCommandHandlerBase } from './select-range-editor-command-handler-base.ts';

const RANGE: SelectionRange = {
  end: { ch: 3, line: 4 },
  start: { ch: 0, line: 2 }
};

interface TestableHandler {
  canExecuteEditor(editor: Editor, context: MarkdownFileInfo): boolean;
  executeEditor(editor: Editor, context: MarkdownFileInfo): void;
}

class TestSelectRangeEditorCommandHandler extends SelectRangeEditorCommandHandlerBase {
  public resolveRangeCallCount = 0;

  public constructor(app: App, pluginSettingsComponent: PluginSettingsComponent, private readonly range: null | SelectionRange) {
    super({
      app,
      icon: 'lucide-text-select',
      id: 'test-select-range',
      name: 'Test select range',
      pluginSettingsComponent
    });
  }

  protected override resolveRange(): null | SelectionRange {
    this.resolveRangeCallCount++;
    return this.range;
  }
}

function createContext(): MarkdownFileInfo {
  return strictProxy<MarkdownFileInfo>({ file: strictProxy<TFile>({ path: 'test/note.md' }) });
}

function createEditor(): Editor {
  return strictProxy<Editor>({ setSelection: vi.fn() });
}

function createHandler(range: null | SelectionRange): TestSelectRangeEditorCommandHandler {
  const settings = strictProxy<PluginSettings>({
    commandMenuPlacement: vi.fn().mockReturnValue(CommandMenuPlacement.EditorMenu),
    shouldAddCommandsToSubmenu: true,
    shouldBlockCommandOnPath: vi.fn().mockReturnValue(false)
  });
  return new TestSelectRangeEditorCommandHandler(strictProxy<App>({}), strictProxy<PluginSettingsComponent>({ settings }), range);
}

describe('SelectRangeEditorCommandHandlerBase', () => {
  it('is available exactly when a range resolves', () => {
    expect(castTo<TestableHandler>(createHandler(RANGE)).canExecuteEditor(createEditor(), createContext())).toBe(true);
    expect(castTo<TestableHandler>(createHandler(null)).canExecuteEditor(createEditor(), createContext())).toBe(false);
  });

  it('selects the resolved range and opens nothing', () => {
    const editor = createEditor();
    castTo<TestableHandler>(createHandler(RANGE)).executeEditor(editor, createContext());
    expect(vi.mocked(editor.setSelection)).toHaveBeenCalledWith(RANGE.start, RANGE.end);
  });

  it('selects nothing when the range has gone', () => {
    const editor = createEditor();
    castTo<TestableHandler>(createHandler(null)).executeEditor(editor, createContext());
    expect(vi.mocked(editor.setSelection)).not.toHaveBeenCalled();
  });

  /*
   * The range is resolved again rather than cached from the availability check, unlike the extract
   * handlers (which stash a `headingInfo` / `range` field between the two calls). The resolvers read the
   * metadata cache and the live document, both of which can move between Obsidian asking whether the
   * command is available and the user actually invoking it.
   */
  it('re-resolves the range at invocation rather than reusing the availability check', () => {
    const handler = createHandler(RANGE);
    const editor = createEditor();
    const context = createContext();

    castTo<TestableHandler>(handler).canExecuteEditor(editor, context);
    castTo<TestableHandler>(handler).executeEditor(editor, context);

    const EXPECTED_RESOLVE_CALLS = 2;
    expect(handler.resolveRangeCallCount).toBe(EXPECTED_RESOLVE_CALLS);
  });
});
