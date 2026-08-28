import type {
  App,
  Editor,
  MarkdownFileInfo,
  TFile
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

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
import { StartSelectionEditorCommandHandler } from './start-selection-editor-command-handler.ts';

interface CreatedHandler {
  readonly handler: TestableHandler;
  readonly params: HandlerParams;
}

interface HandlerParams {
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly selectionAnchorComponent: SelectionAnchorComponent;
}

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
  return strictProxy<Editor>({});
}

function createHandler(): CreatedHandler {
  const settings = strictProxy<PluginSettings>({
    commandMenuPlacement: vi.fn().mockReturnValue(CommandMenuPlacement.EditorMenu),
    shouldAddCommandsToSubmenu: true,
    shouldBlockCommandOnPath: vi.fn().mockReturnValue(false)
  });
  const params: HandlerParams = {
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice: vi.fn() }),
    selectionAnchorComponent: strictProxy<SelectionAnchorComponent>({ setAnchor: vi.fn() })
  };
  const handler = new StartSelectionEditorCommandHandler({
    app: strictProxy<App>({}),
    pluginNoticeComponent: params.pluginNoticeComponent,
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings }),
    selectionAnchorComponent: params.selectionAnchorComponent
  });
  return { handler: castTo<TestableHandler>(handler), params };
}

describe('StartSelectionEditorCommandHandler', () => {
  it('should construct with correct params', () => {
    const { handler } = createHandler();
    expect(handler.id).toBe('start-selection');
    // Prefixed like the two other stateful families (`Smart cut & paste:`, `Swap selections:`), which is
    // What tells the palette these three commands belong to one multi-step flow.
    expect(handler.name).toBe('Selection anchor: Start selection');
    expect(handler.icon).toBe('lucide-text-cursor');
  });

  // No anchor is needed to start one, so this is available in any note — unlike its two siblings.
  it('is available in any note', () => {
    const { handler } = createHandler();
    expect(handler.canExecuteEditor(createEditor(), createContext())).toBe(true);
  });

  it('is unavailable with no file in context', () => {
    const { handler } = createHandler();
    expect(handler.canExecuteEditor(createEditor(), createContext(null))).toBe(false);
  });

  it('anchors in the note and says what to do next', () => {
    const { handler, params } = createHandler();
    const editor = createEditor();
    const context = createContext();

    handler.executeEditor(editor, context);

    expect(vi.mocked(params.selectionAnchorComponent.setAnchor)).toHaveBeenCalledWith(editor, context.file);
    expect(vi.mocked(params.pluginNoticeComponent.showNotice)).toHaveBeenCalledWith(expect.stringContaining('End selection'));
  });

  it('anchors nothing with no file in context', () => {
    const { handler, params } = createHandler();
    handler.executeEditor(createEditor(), createContext(null));
    expect(vi.mocked(params.selectionAnchorComponent.setAnchor)).not.toHaveBeenCalled();
  });
});
