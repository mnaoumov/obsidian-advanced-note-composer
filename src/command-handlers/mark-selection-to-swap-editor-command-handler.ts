import type {
  Editor,
  MarkdownFileInfo,
  MarkdownView
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { EditorCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/editor-command-handler';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { SwapSelectionBuffer } from '../swap-selection-buffer.ts';

import { isEditorCommandBlocked } from '../command-block.ts';
import {
  checkShouldAddCommandToEditorMenu,
  checkShouldAddCommandToViewportMenu
} from '../command-menu-placement.ts';
import { CommandCategory } from '../plugin-settings.ts';

interface MarkSelectionToSwapEditorCommandHandlerConstructorParams {
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly swapSelectionBuffer: SwapSelectionBuffer;
}

/**
 * Marks the current editor selection as the first side of a selection swap. The second side is chosen by
 * selecting text in any note (the same one or another) and running
 * `Swap selections: Swap with marked selection`.
 */
export class MarkSelectionToSwapEditorCommandHandler extends EditorCommandHandler {
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly swapSelectionBuffer: SwapSelectionBuffer;

  public constructor(params: MarkSelectionToSwapEditorCommandHandlerConstructorParams) {
    super({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'switch-camera',
      id: 'mark-selection-to-swap',
      name: 'Swap selections: Mark selection to swap'
    });

    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.swapSelectionBuffer = params.swapSelectionBuffer;
  }

  protected override canExecuteEditor(editor: Editor, context: MarkdownFileInfo): boolean {
    return !isEditorCommandBlocked({ commandCategory: CommandCategory.Swap, context, pluginSettingsComponent: this.pluginSettingsComponent }) && editor.somethingSelected();
  }

  protected override executeEditor(editor: Editor, context: MarkdownFileInfo): void {
    const file = context.file;
    if (!file) {
      return;
    }
    this.swapSelectionBuffer.mark({
      endOffset: editor.posToOffset(editor.getCursor('to')),
      selectedText: editor.getSelection(),
      sourceFile: file,
      sourceMtime: file.stat.mtime,
      startOffset: editor.posToOffset(editor.getCursor('from'))
    });

    this.pluginNoticeComponent.showNotice(
      'Marked selection to swap. Select text in another note (or the same note) and run "Swap selections: Swap with marked selection".'
    );
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
