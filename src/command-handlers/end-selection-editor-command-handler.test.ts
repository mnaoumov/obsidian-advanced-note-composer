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
import type { SelectionAnchorComponent } from '../selection-anchor-component.ts';

import { CommandMenuPlacement } from '../plugin-settings.ts';
import { EndSelectionEditorCommandHandler } from './end-selection-editor-command-handler.ts';

const CURSOR: EditorPosition = { ch: 2, line: 5 };
const CURSOR_OFFSET = 40;

interface CreatedHandler {
  readonly anchorComponent: SelectionAnchorComponent;
  readonly handler: TestableHandler;
}

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

/**
 * An editor whose offsets and positions are the same number, so a test can talk in offsets and read the
 * resulting selection in the same units.
 *
 * @returns The editor.
 */
function createEditor(): Editor {
  return strictProxy<Editor>({
    getCursor: vi.fn().mockReturnValue(CURSOR),
    offsetToPos: vi.fn().mockImplementation((offset: number) => ({ ch: offset, line: 0 })),
    posToOffset: vi.fn().mockReturnValue(CURSOR_OFFSET),
    setSelection: vi.fn()
  });
}

function createHandler(anchorOffset: null | number, hasAnchor = anchorOffset !== null): CreatedHandler {
  const settings = strictProxy<PluginSettings>({
    commandMenuPlacement: vi.fn().mockReturnValue(CommandMenuPlacement.EditorMenu),
    shouldAddCommandsToSubmenu: true,
    shouldBlockCommandOnPath: vi.fn().mockReturnValue(false)
  });
  const anchorComponent = strictProxy<SelectionAnchorComponent>({
    clearAnchor: vi.fn(),
    getAnchorOffset: vi.fn().mockReturnValue(anchorOffset),
    hasAnchor: vi.fn().mockReturnValue(hasAnchor)
  });
  const handler = new EndSelectionEditorCommandHandler({
    app: strictProxy<App>({}),
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings }),
    selectionAnchorComponent: anchorComponent
  });
  return { anchorComponent, handler: castTo<TestableHandler>(handler) };
}

describe('EndSelectionEditorCommandHandler', () => {
  it('should construct with correct params', () => {
    const { handler } = createHandler(10);
    expect(handler.id).toBe('end-selection');
    expect(handler.name).toBe('Selection anchor: End selection');
    expect(handler.icon).toBe('lucide-text-select');
  });

  /*
   * Availability is answered from the anchored NOTE, not by resolving the range, so it costs no trip into
   * CodeMirror — and so on a phone the command stays out of the palette until it can do something.
   */
  it('is unavailable until an anchor is set in this note', () => {
    const { anchorComponent, handler } = createHandler(null, false);
    const context = createContext();

    expect(handler.canExecuteEditor(createEditor(), context)).toBe(false);
    expect(vi.mocked(anchorComponent.hasAnchor)).toHaveBeenCalledWith(context.file);
  });

  it('is available once an anchor is set in this note', () => {
    const { handler } = createHandler(10, true);
    expect(handler.canExecuteEditor(createEditor(), createContext())).toBe(true);
  });

  it('selects from the anchor forwards to the cursor', () => {
    const { handler } = createHandler(10);
    const editor = createEditor();

    handler.executeEditor(editor, createContext());

    expect(vi.mocked(editor.setSelection)).toHaveBeenCalledWith({ ch: 10, line: 0 }, { ch: CURSOR_OFFSET, line: 0 });
  });

  // Anchoring and then moving the caret BACKWARDS is ordinary on a phone, where the caret is placed by
  // Tapping and taps do not arrive in document order.
  it('selects from the cursor forwards to an anchor that follows it', () => {
    const { handler } = createHandler(90);
    const editor = createEditor();

    handler.executeEditor(editor, createContext());

    expect(vi.mocked(editor.setSelection)).toHaveBeenCalledWith({ ch: CURSOR_OFFSET, line: 0 }, { ch: 90, line: 0 });
  });

  it('consumes the anchor, so the next End selection cannot reach back to it', () => {
    const { anchorComponent, handler } = createHandler(10);
    handler.executeEditor(createEditor(), createContext());
    expect(vi.mocked(anchorComponent.clearAnchor)).toHaveBeenCalledOnce();
  });

  it('selects nothing, and still clears, when the editor holds no anchor', () => {
    const { anchorComponent, handler } = createHandler(null, true);
    const editor = createEditor();

    handler.executeEditor(editor, createContext());

    expect(vi.mocked(editor.setSelection)).not.toHaveBeenCalled();
    expect(vi.mocked(anchorComponent.clearAnchor)).toHaveBeenCalledOnce();
  });
});
