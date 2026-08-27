import type {
  App,
  Editor,
  MarkdownFileInfo,
  MarkdownView
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { EditorCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/editor-command-handler';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { SwapSelectionBuffer } from '../swap-selection-buffer.ts';

import { isEditorCommandBlocked } from '../command-block.ts';
import {
  checkShouldAddCommandToEditorMenu,
  checkShouldAddCommandToViewportMenu
} from '../command-menu-placement.ts';
import { CommandCategory } from '../plugin-settings.ts';

interface MarkSelectionToSwapEditorCommandHandlerConstructorParams {
  readonly app: App;
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
  private readonly app: App;
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

    this.app = params.app;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.swapSelectionBuffer = params.swapSelectionBuffer;
  }

  protected override canExecuteEditor(editor: Editor, context: MarkdownFileInfo): boolean {
    if (isEditorCommandBlocked({ commandCategory: CommandCategory.Swap, context, pluginSettingsComponent: this.pluginSettingsComponent })) {
      return false;
    }
    return editor.somethingSelected();
  }

  protected override async executeEditor(editor: Editor, context: MarkdownFileInfo): Promise<void> {
    const file = context.file;
    if (!file) {
      return;
    }
    if (this.pluginSettingsComponent.settings.isPathIgnored(file.path)) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot swap a selection from file ');
          f.append(await renderInternalLink({ app: this.app, pathOrAbstractFile: file }));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
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
