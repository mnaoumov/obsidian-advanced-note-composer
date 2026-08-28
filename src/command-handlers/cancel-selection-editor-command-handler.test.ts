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
import { CancelSelectionEditorCommandHandler } from './cancel-selection-editor-command-handler.ts';

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

function createContext(): MarkdownFileInfo {
  return strictProxy<MarkdownFileInfo>({ file: strictProxy<TFile>({ path: 'test/note.md' }) });
}

function createEditor(): Editor {
  return strictProxy<Editor>({});
}

function createHandler(hasAnchor: boolean): CreatedHandler {
  const settings = strictProxy<PluginSettings>({
    commandMenuPlacement: vi.fn().mockReturnValue(CommandMenuPlacement.EditorMenu),
    shouldAddCommandsToSubmenu: true,
    shouldBlockCommandOnPath: vi.fn().mockReturnValue(false)
  });
  const params: HandlerParams = {
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice: vi.fn() }),
    selectionAnchorComponent: strictProxy<SelectionAnchorComponent>({
      clearAnchor: vi.fn(),
      hasAnchor: vi.fn().mockReturnValue(hasAnchor)
    })
  };
  const handler = new CancelSelectionEditorCommandHandler({
    app: strictProxy<App>({}),
    pluginNoticeComponent: params.pluginNoticeComponent,
    pluginSettingsComponent: strictProxy<PluginSettingsComponent>({ settings }),
    selectionAnchorComponent: params.selectionAnchorComponent
  });
  return { handler: castTo<TestableHandler>(handler), params };
}

describe('CancelSelectionEditorCommandHandler', () => {
  it('should construct with correct params', () => {
    const { handler } = createHandler(true);
    expect(handler.id).toBe('cancel-selection');
    expect(handler.name).toBe('Selection anchor: Cancel selection');
    expect(handler.icon).toBe('lucide-x');
  });

  it('is unavailable while nothing is anchored in this note', () => {
    const { handler } = createHandler(false);
    expect(handler.canExecuteEditor(createEditor(), createContext())).toBe(false);
  });

  it('is available once an anchor is set in this note', () => {
    const { handler, params } = createHandler(true);
    const context = createContext();

    expect(handler.canExecuteEditor(createEditor(), context)).toBe(true);
    expect(vi.mocked(params.selectionAnchorComponent.hasAnchor)).toHaveBeenCalledWith(context.file);
  });

  it('drops the anchor and confirms it', () => {
    const { handler, params } = createHandler(true);

    handler.executeEditor(createEditor(), createContext());

    expect(vi.mocked(params.selectionAnchorComponent.clearAnchor)).toHaveBeenCalledOnce();
    expect(vi.mocked(params.pluginNoticeComponent.showNotice)).toHaveBeenCalledWith('Cancelled the selection anchor.');
  });
});
