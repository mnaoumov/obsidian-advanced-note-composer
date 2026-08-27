import type {
  App,
  Editor,
  MarkdownFileInfo,
  MarkdownView
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { EditorCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/editor-command-handler';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { SwapSelectionBuffer } from '../swap-selection-buffer.ts';

import { isEditorCommandBlocked } from '../command-block.ts';
import {
  checkShouldAddCommandToEditorMenu,
  checkShouldAddCommandToViewportMenu
} from '../command-menu-placement.ts';
import { CommandCategory } from '../plugin-settings.ts';
import {
  canSwapWithSelection,
  swapWithSelection
} from '../swap-selection-runner.ts';

interface SwapWithMarkedSelectionEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
  readonly swapSelectionBuffer: SwapSelectionBuffer;
}

/**
 * Swaps the current editor selection with the previously marked selection (`Swap selections: Mark
 * selection to swap`), exchanging the two pieces of text across their notes (or within one note). Both
 * notes are locked and the writes run in a reversible transaction (via the shared swap runner).
 */
export class SwapWithMarkedSelectionEditorCommandHandler extends EditorCommandHandler {
  private readonly app: App;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;
  private readonly swapSelectionBuffer: SwapSelectionBuffer;

  public constructor(params: SwapWithMarkedSelectionEditorCommandHandlerConstructorParams) {
    super({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'switch-camera',
      id: 'swap-with-marked-selection',
      name: 'Swap selections: Swap with marked selection'
    });

    this.app = params.app;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.resourceLockComponent = params.resourceLockComponent;
    this.swapSelectionBuffer = params.swapSelectionBuffer;
  }

  protected override canExecuteEditor(editor: Editor, context: MarkdownFileInfo): boolean {
    if (isEditorCommandBlocked({ commandCategory: CommandCategory.Swap, context, pluginSettingsComponent: this.pluginSettingsComponent })) {
      return false;
    }
    const marked = this.swapSelectionBuffer.get();
    if (!marked) {
      return false;
    }
    const targetFile = context.file;
    if (!targetFile) {
      return false;
    }
    return canSwapWithSelection({
      app: this.app,
      editor,
      marked,
      targetFile
    });
  }

  protected override async executeEditor(editor: Editor, context: MarkdownFileInfo): Promise<void> {
    const targetFile = context.file;
    if (!targetFile) {
      return;
    }
    const marked = this.swapSelectionBuffer.get();
    if (!marked) {
      return;
    }

    await swapWithSelection({
      app: this.app,
      clearMark: () => {
        this.swapSelectionBuffer.clear();
      },
      editor,
      marked,
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent,
      resourceLockComponent: this.resourceLockComponent,
      targetFile
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
