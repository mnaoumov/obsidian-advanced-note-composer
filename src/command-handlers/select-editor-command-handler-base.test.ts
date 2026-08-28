import type {
  App,
  Editor,
  MarkdownFileInfo,
  MarkdownView,
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

import {
  CommandCategory,
  CommandMenuPlacement
} from '../plugin-settings.ts';
import { SelectEditorCommandHandlerBase } from './select-editor-command-handler-base.ts';

/**
 * The `mode` and `source` Obsidian passes with `markdown-viewport-menu` for a right-click on the empty
 * margin beside the text, or on the line-number gutter, of a note being edited (issue #252).
 */
const VIEWPORT_MENU_MODE = 'source';
const VIEWPORT_MENU_SOURCE = 'gutter';

interface CreateHandlerParams {
  readonly canSelect?: boolean;
  readonly shouldAddCommandsToSubmenu?: boolean;
  readonly shouldBlockCommandOnPath?: boolean;
}

interface TestableHandler {
  canExecuteEditor(editor: Editor, context: MarkdownFileInfo): boolean;
  shouldAddCommandToSubmenu(): boolean;
  shouldAddToEditorMenu(editor: Editor, context: MarkdownFileInfo): boolean;
  shouldAddToViewportMenu(view: MarkdownView, mode: string, source: string): boolean;
}

class TestSelectEditorCommandHandler extends SelectEditorCommandHandlerBase {
  public constructor(app: App, pluginSettingsComponent: PluginSettingsComponent, private readonly canSelectResult: boolean) {
    super({
      app,
      icon: 'lucide-text-cursor',
      id: 'test-select',
      name: 'Test select',
      pluginSettingsComponent
    });
  }

  protected override canSelect(): boolean {
    return this.canSelectResult;
  }

  protected override executeEditor(): void {
    // Nothing: this suite only exercises what the base owns.
  }
}

function createContext(file: null | TFile = strictProxy<TFile>({ path: 'test/note.md' })): MarkdownFileInfo {
  return strictProxy<MarkdownFileInfo>({ file });
}

function createEditor(): Editor {
  return strictProxy<Editor>({});
}

function createHandler(params: CreateHandlerParams = {}): TestableHandler {
  const settings = strictProxy<PluginSettings>({
    commandMenuPlacement: vi.fn().mockReturnValue(CommandMenuPlacement.EditorMenu),
    shouldAddCommandsToSubmenu: params.shouldAddCommandsToSubmenu ?? true,
    shouldBlockCommandOnPath: vi.fn().mockReturnValue(params.shouldBlockCommandOnPath ?? false)
  });
  const handler = new TestSelectEditorCommandHandler(
    strictProxy<App>({}),
    strictProxy<PluginSettingsComponent>({ settings }),
    params.canSelect ?? true
  );
  return castTo<TestableHandler>(handler);
}

describe('SelectEditorCommandHandlerBase', () => {
  it('defers to the subclass once the command filter allows the path', () => {
    expect(createHandler({ canSelect: true }).canExecuteEditor(createEditor(), createContext())).toBe(true);
    expect(createHandler({ canSelect: false }).canExecuteEditor(createEditor(), createContext())).toBe(false);
  });

  it('asks the command filter under the Select category', () => {
    const settings = strictProxy<PluginSettings>({
      commandMenuPlacement: vi.fn(),
      shouldAddCommandsToSubmenu: true,
      shouldBlockCommandOnPath: vi.fn().mockReturnValue(false)
    });
    const handler = castTo<TestableHandler>(
      new TestSelectEditorCommandHandler(strictProxy<App>({}), strictProxy<PluginSettingsComponent>({ settings }), true)
    );

    handler.canExecuteEditor(createEditor(), createContext());

    expect(settings.shouldBlockCommandOnPath).toHaveBeenCalledWith('test/note.md', CommandCategory.Select);
  });

  it('is unavailable on a path the Select category is blocked on', () => {
    expect(createHandler({ shouldBlockCommandOnPath: true }).canExecuteEditor(createEditor(), createContext())).toBe(false);
  });

  /*
   * The CONTENT filter (`isPathIgnored`) is deliberately never consulted — a select writes nothing, so
   * "this note may not be split into" is no reason to refuse to move the caret in it. Answering two
   * different questions with one setting is what produced bug #253. `strictProxy` is what pins this: the
   * settings object above has no `isPathIgnored`, so reaching for it would throw rather than pass.
   */
  it('does not consult the content filter', () => {
    expect(createHandler().canExecuteEditor(createEditor(), createContext())).toBe(true);
  });

  it('is unavailable with no file in context', () => {
    // A missing file is never blocked by the path filter, so availability is still the subclass's call.
    expect(createHandler({ canSelect: false }).canExecuteEditor(createEditor(), createContext(null))).toBe(false);
  });

  it('follows the submenu setting', () => {
    expect(createHandler({ shouldAddCommandsToSubmenu: true }).shouldAddCommandToSubmenu()).toBe(true);
    expect(createHandler({ shouldAddCommandsToSubmenu: false }).shouldAddCommandToSubmenu()).toBe(false);
  });

  /*
   * No `!editor.somethingSelected()` gate, unlike `Extract this heading...` (issue #188): re-selecting
   * over a live selection is exactly what a select command is for. `strictProxy` pins this too — the
   * editor above has no `somethingSelected`, so a gate would throw here.
   */
  it('stays in the editor menu while a selection is already live', () => {
    expect(createHandler().shouldAddToEditorMenu(createEditor(), createContext())).toBe(true);
  });

  it('stays off the readable-line-length margin while placed in the editor menu', () => {
    const view = strictProxy<MarkdownView>({});
    expect(createHandler().shouldAddToViewportMenu(view, VIEWPORT_MENU_MODE, VIEWPORT_MENU_SOURCE)).toBe(false);
  });
});
