import type {
  App,
  Editor,
  MarkdownFileInfo
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { EditorCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/editor-command-handler';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';

import type { MoveNoticeComponent } from '../move-notice-component.ts';
import type { MoveSelectionBuffer } from '../move-selection-buffer.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { SelectionHighlightComponent } from '../selection-highlight-component.ts';

import { SplitComposer } from '../composers/split-composer.ts';
import { prepareForSplitFile } from '../modals/split-file-modal.ts';

interface ExtractCurrentSelectionEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly moveNoticeComponent: MoveNoticeComponent;
  readonly moveSelectionBuffer: MoveSelectionBuffer;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
  readonly selectionHighlightComponent: SelectionHighlightComponent;
}

export class ExtractCurrentSelectionEditorCommandHandler extends EditorCommandHandler {
  private readonly app: App;
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly moveNoticeComponent: MoveNoticeComponent;
  private readonly moveSelectionBuffer: MoveSelectionBuffer;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;
  private readonly selectionHighlightComponent: SelectionHighlightComponent;

  public constructor(params: ExtractCurrentSelectionEditorCommandHandlerConstructorParams) {
    super({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-scissors',
      id: 'extract-current-selection',
      name: 'Extract current selection...'
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

  protected override canExecuteEditor(editor: Editor): boolean {
    return editor.somethingSelected();
  }

  protected override async executeEditor(editor: Editor, ctx: MarkdownFileInfo): Promise<void> {
    const file = ctx.file;
    if (!file) {
      return;
    }
    if (this.pluginSettingsComponent.settings.isPathIgnored(file.path)) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot extract from file ');
          f.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: file }));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }
    const result = await prepareForSplitFile({
      app: this.app,
      editor,
      moveNoticeComponent: this.moveNoticeComponent,
      moveSelectionBuffer: this.moveSelectionBuffer,
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
    return true;
  }
}
