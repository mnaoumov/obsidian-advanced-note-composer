import type { ResourceLockComponent } from '@mnaoumov/obsidian-lib/resource-lock';
import type {
  App,
  Editor,
  MarkdownFileInfo,
  MarkdownView
} from 'obsidian';

import { EditorCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/editor-command-handler';

import type { PluginSettingsComponent } from '../../settings/plugin-settings-component.ts';
import type { MoveNoticeComponent } from '../move-notice-component.ts';
import type { MoveSelectionBuffer } from './move-selection-buffer.ts';
import type { SelectionHighlightComponent } from './selection-highlight-component.ts';

import { isEditorCommandBlocked } from '../../settings/command-visibility/command-block.ts';
import {
  checkShouldAddCommandToEditorMenu,
  checkShouldAddCommandToViewportMenu
} from '../../settings/command-visibility/command-menu-placement.ts';
import { CommandCategory } from '../../settings/plugin-settings.ts';
import { getSelections } from '../../split/split-composer.ts';
import { markSelectionToMove } from './mark-selection-to-move.ts';

interface MarkSelectionToMoveEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly moveNoticeComponent: MoveNoticeComponent;
  readonly moveSelectionBuffer: MoveSelectionBuffer;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
  readonly selectionHighlightComponent: SelectionHighlightComponent;
}

export class MarkSelectionToMoveEditorCommandHandler extends EditorCommandHandler {
  private readonly app: App;
  private readonly moveNoticeComponent: MoveNoticeComponent;
  private readonly moveSelectionBuffer: MoveSelectionBuffer;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;
  private readonly selectionHighlightComponent: SelectionHighlightComponent;

  public constructor(params: MarkSelectionToMoveEditorCommandHandlerConstructorParams) {
    super({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-scissors',
      id: 'mark-selection-to-move',
      name: 'Smart cut & paste: Mark selection to move'
    });

    this.app = params.app;
    this.moveNoticeComponent = params.moveNoticeComponent;
    this.moveSelectionBuffer = params.moveSelectionBuffer;
    this.resourceLockComponent = params.resourceLockComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.selectionHighlightComponent = params.selectionHighlightComponent;
  }

  protected override canExecuteEditor(editor: Editor, context: MarkdownFileInfo): boolean {
    return !isEditorCommandBlocked({ commandCategory: CommandCategory.SmartCutAndPaste, context, pluginSettingsComponent: this.pluginSettingsComponent }) && editor.somethingSelected();
  }

  protected override executeEditor(editor: Editor, context: MarkdownFileInfo): void {
    const file = context.file;
    if (!file) {
      return;
    }
    markSelectionToMove({
      app: this.app,
      capturedSelections: getSelections(editor),
      markedHeading: null,
      moveNoticeComponent: this.moveNoticeComponent,
      moveSelectionBuffer: this.moveSelectionBuffer,
      resourceLockComponent: this.resourceLockComponent,
      selectedText: editor.getSelection(),
      selectionHighlightComponent: this.selectionHighlightComponent,
      shouldLockAllNotes: this.pluginSettingsComponent.settings.shouldLockAllNotesWhenMarkingSelection,
      sourceFile: file
    });
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  protected override shouldAddToEditorMenu(): boolean {
    return checkShouldAddCommandToEditorMenu({
      commandId: this.id,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }

  protected override shouldAddToViewportMenu(_view: MarkdownView, mode: string, _source: string): boolean {
    return checkShouldAddCommandToViewportMenu({
      commandId: this.id,
      mode,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }
}
