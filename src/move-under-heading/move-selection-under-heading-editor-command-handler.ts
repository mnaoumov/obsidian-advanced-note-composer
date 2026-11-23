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
import type { HeadingMoveDestination } from './move-under-heading.ts';

import { ActiveEditorCommandHandlerBase } from '../active-editor-command-handler-base.ts';
import { isEditorCommandBlocked } from '../settings/command-visibility/command-block.ts';
import {
  checkShouldAddCommandToEditorMenu,
  checkShouldAddCommandToViewportMenu
} from '../settings/command-visibility/command-menu-placement.ts';
import { CommandCategory } from '../settings/plugin-settings.ts';
import { getSelections } from '../split/split-composer.ts';
import {
  pickHeadingMoveDestination,
  runMoveUnderHeading
} from './move-under-heading.ts';

interface MoveSelectionUnderHeadingEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

/**
 * `Move selection under heading...`: moves the editor's selection under a heading chosen in a chosen note,
 * the same note included, without opening that note.
 */
export class MoveSelectionUnderHeadingEditorCommandHandler extends ActiveEditorCommandHandlerBase {
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: MoveSelectionUnderHeadingEditorCommandHandlerConstructorParams) {
    super({
      app: params.app,
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-list-tree',
      id: 'move-selection-under-heading',
      name: 'Move selection under heading...'
    });

    this.consoleDebugComponent = params.consoleDebugComponent;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.resourceLockComponent = params.resourceLockComponent;
  }

  protected override canExecuteEditor(editor: Editor, context: MarkdownFileInfo): boolean {
    return !isEditorCommandBlocked({ commandCategory: CommandCategory.SplitAndExtract, context, pluginSettingsComponent: this.pluginSettingsComponent })
      && editor.somethingSelected();
  }

  protected override async executeEditor(editor: Editor, context: MarkdownFileInfo): Promise<void> {
    const sourceFile = context.file;
    if (!sourceFile) {
      return;
    }

    // Captured before any picker opens, while the editor still shows the source note.
    const capturedSelections = getSelections(editor);
    const selectedText = editor.getSelection();

    let destination: HeadingMoveDestination | null;
    {
      // The source note stays locked while the pickers are open, as it does for the split picker: an edit
      // made meanwhile would shift the captured offsets onto other text. Released before the move, which
      // takes its own lock.
      const abortController = new AbortController();
      using _sourceLock = this.resourceLockComponent.lockForPath({ abortController, operationName: 'Move selection under heading', pathOrFile: sourceFile });
      destination = await pickHeadingMoveDestination({
        app: this.app,
        capturedSelections,
        commandCategory: CommandCategory.SplitAndExtract,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent: this.pluginSettingsComponent,
        sourceFile
      });
      if (abortController.signal.aborted) {
        return;
      }
    }

    if (!destination) {
      return;
    }

    await runMoveUnderHeading({
      app: this.app,
      capturedSelections,
      consoleDebugComponent: this.consoleDebugComponent,
      destination,
      editor,
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent,
      resourceLockComponent: this.resourceLockComponent,
      selectedText,
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
