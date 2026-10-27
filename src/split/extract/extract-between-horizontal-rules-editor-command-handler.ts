import type { ConsoleDebugComponent } from '@mnaoumov/obsidian-lib/components/console-debug-component';
import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type { ResourceLockComponent } from '@mnaoumov/obsidian-lib/resource-lock';
import type {
  App,
  Editor,
  MarkdownFileInfo,
  MarkdownView
} from 'obsidian';

import { EditorCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/editor-command-handler';

import type { PluginSettingsComponent } from '../../settings/plugin-settings-component.ts';
import type { MoveSelectionBuffer } from '../../smart-cut/mark/move-selection-buffer.ts';
import type { SelectionHighlightComponent } from '../../smart-cut/mark/selection-highlight-component.ts';
import type { MoveNoticeComponent } from '../../smart-cut/move-notice-component.ts';
import type { HorizontalRuleSelection } from './horizontal-rules.ts';

import { isEditorCommandBlocked } from '../../settings/command-visibility/command-block.ts';
import {
  checkShouldAddCommandToEditorMenu,
  checkShouldAddCommandToViewportMenu
} from '../../settings/command-visibility/command-menu-placement.ts';
import { CommandCategory } from '../../settings/plugin-settings.ts';
import { prepareForSplitFile } from '../picker/split-file-modal.ts';
import { SplitComposer } from '../split-composer.ts';
import { getSelectionBetweenHorizontalRules } from './horizontal-rules.ts';

interface ExtractBetweenHorizontalRulesEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly moveNoticeComponent: MoveNoticeComponent;
  readonly moveSelectionBuffer: MoveSelectionBuffer;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
  readonly selectionHighlightComponent: SelectionHighlightComponent;
}

export class ExtractBetweenHorizontalRulesEditorCommandHandler extends EditorCommandHandler {
  private readonly app: App;
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly moveNoticeComponent: MoveNoticeComponent;
  private readonly moveSelectionBuffer: MoveSelectionBuffer;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private range?: HorizontalRuleSelection;
  private readonly resourceLockComponent: ResourceLockComponent;
  private readonly selectionHighlightComponent: SelectionHighlightComponent;

  public constructor(params: ExtractBetweenHorizontalRulesEditorCommandHandlerConstructorParams) {
    super({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-separator-horizontal',
      id: 'extract-between-horizontal-rules',
      name: 'Extract between horizontal rules...'
    });

    this.app = params.app;
    this.consoleDebugComponent = params.consoleDebugComponent;
    this.moveNoticeComponent = params.moveNoticeComponent;
    this.moveSelectionBuffer = params.moveSelectionBuffer;
    this.resourceLockComponent = params.resourceLockComponent;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.selectionHighlightComponent = params.selectionHighlightComponent;
  }

  protected override canExecuteEditor(editor: Editor, context: MarkdownFileInfo): boolean {
    if (isEditorCommandBlocked({ commandCategory: CommandCategory.SplitAndExtract, context, pluginSettingsComponent: this.pluginSettingsComponent })) {
      return false;
    }

    const file = context.file;
    if (!file) {
      return false;
    }

    const range = getSelectionBetweenHorizontalRules({
      app: this.app,
      editor,
      file,
      lineNumber: editor.getCursor().line
    });
    if (!range) {
      return false;
    }

    this.range = range;
    return true;
  }

  protected override async executeEditor(editor: Editor, context: MarkdownFileInfo): Promise<void> {
    const file = context.file;
    if (!file || !this.range) {
      return;
    }
    editor.setSelection(this.range.start, this.range.end);
    const result = await prepareForSplitFile({
      app: this.app,
      editor,
      moveNoticeComponent: this.moveNoticeComponent,
      moveSelectionBuffer: this.moveSelectionBuffer,
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent,
      resourceLockComponent: this.resourceLockComponent,
      selectionHighlightComponent: this.selectionHighlightComponent,
      sourceFile: file
    });
    if (!result) {
      return;
    }
    const composer = new SplitComposer({
      app: this.app,
      capturedSelections: result.capturedSelections,
      consoleDebugComponent: this.consoleDebugComponent,
      editor,
      frontmatterMergeStrategy: result.frontmatterMergeStrategy,
      insertMode: result.insertMode,
      isMultipleSplit: false,
      isNewTargetFile: result.isNewTargetFile,
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent,
      resourceLockComponent: this.resourceLockComponent,
      selectedText: result.selectedText,
      shouldFixFootnotes: result.shouldFixFootnotes,
      shouldIncludeFrontmatter: result.shouldIncludeFrontmatter,
      shouldMergeHeadings: result.shouldMergeHeadings,
      sourceFile: file,
      targetFile: result.targetFile
    });
    await composer.splitFile();
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
