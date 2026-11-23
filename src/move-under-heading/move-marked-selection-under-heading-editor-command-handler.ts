import type { ConsoleDebugComponent } from '@mnaoumov/obsidian-lib/components/console-debug-component';
import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type { ResourceLockComponent } from '@mnaoumov/obsidian-lib/resource-lock';
import type {
  App,
  Editor,
  MarkdownFileInfo,
  MarkdownView
} from 'obsidian';

import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';
import type { MoveSelectionBuffer } from '../smart-cut/mark/move-selection-buffer.ts';

import { ActiveEditorCommandHandlerBase } from '../active-editor-command-handler-base.ts';
import { isEditorCommandBlocked } from '../settings/command-visibility/command-block.ts';
import {
  checkShouldAddCommandToEditorMenu,
  checkShouldAddCommandToViewportMenu
} from '../settings/command-visibility/command-menu-placement.ts';
import { CommandCategory } from '../settings/plugin-settings.ts';
import {
  pickHeadingMoveDestination,
  runMoveUnderHeading
} from './move-under-heading.ts';

interface MoveMarkedSelectionUnderHeadingEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly moveSelectionBuffer: MoveSelectionBuffer;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

/**
 * `Smart cut & paste: Move marked selection under heading...`: the marked selection's counterpart of
 * `Move selection under heading...`. Offered in any note while a selection is marked, since the
 * destination is picked rather than being the note on screen.
 */
export class MoveMarkedSelectionUnderHeadingEditorCommandHandler extends ActiveEditorCommandHandlerBase {
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly moveSelectionBuffer: MoveSelectionBuffer;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: MoveMarkedSelectionUnderHeadingEditorCommandHandlerConstructorParams) {
    super({
      app: params.app,
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-list-tree',
      id: 'move-marked-selection-under-heading',
      name: 'Smart cut & paste: Move marked selection under heading...'
    });

    this.consoleDebugComponent = params.consoleDebugComponent;
    this.moveSelectionBuffer = params.moveSelectionBuffer;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.resourceLockComponent = params.resourceLockComponent;
  }

  protected override canExecuteEditor(_editor: Editor, context: MarkdownFileInfo): boolean {
    if (isEditorCommandBlocked({ commandCategory: CommandCategory.SmartCutAndPaste, context, pluginSettingsComponent: this.pluginSettingsComponent })) {
      return false;
    }
    const marked = this.moveSelectionBuffer.get();
    return !!marked && !!this.app.vault.getFileByPath(marked.sourceFile.path);
  }

  protected override async executeEditor(editor: Editor): Promise<void> {
    const marked = this.moveSelectionBuffer.get();
    if (!marked) {
      return;
    }

    const sourceFile = this.app.vault.getFileByPath(marked.sourceFile.path);
    if (!sourceFile) {
      this.pluginNoticeComponent.showNotice('The note the selection was marked in no longer exists.');
      this.moveSelectionBuffer.clear();
      return;
    }

    if (sourceFile.stat.mtime !== marked.sourceMtime) {
      this.pluginNoticeComponent.showNotice('The note the selection was marked in has changed since it was marked. Mark the selection again.');
      return;
    }

    const destination = await pickHeadingMoveDestination({
      app: this.app,
      capturedSelections: marked.capturedSelections,
      commandCategory: CommandCategory.SmartCutAndPaste,
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent,
      sourceFile
    });

    // The mark may have been cancelled or replaced while the pickers were open.
    if (!destination || this.moveSelectionBuffer.get() !== marked) {
      return;
    }

    // The mark's lock blocks writes to the source note, which the move is about to make.
    this.moveSelectionBuffer.clear();

    await runMoveUnderHeading({
      app: this.app,
      capturedSelections: marked.capturedSelections,
      consoleDebugComponent: this.consoleDebugComponent,
      destination,
      editor,
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent,
      resourceLockComponent: this.resourceLockComponent,
      selectedText: marked.selectedText,
      sourceFile
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
