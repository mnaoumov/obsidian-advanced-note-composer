import type { HeadingInfo } from '@obsidian-typings/obsidian-public-latest/implementations';
import type {
  App,
  Editor,
  MarkdownFileInfo,
  MarkdownView
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

import { isEditorCommandBlocked } from '../command-block.ts';
import {
  checkShouldAddCommandToEditorMenu,
  checkShouldAddCommandToViewportMenu
} from '../command-menu-placement.ts';
import {
  getEnclosingHeadingLine,
  getSelectionUnderHeading
} from '../composers/composer-base.ts';
import { SplitComposer } from '../composers/split-composer.ts';
import { prepareForSplitFile } from '../modals/split-file-modal.ts';
import { CommandCategory } from '../plugin-settings.ts';

interface ExtractThisHeadingEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly moveNoticeComponent: MoveNoticeComponent;
  readonly moveSelectionBuffer: MoveSelectionBuffer;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
  readonly selectionHighlightComponent: SelectionHighlightComponent;
}

export class ExtractThisHeadingEditorCommandHandler extends EditorCommandHandler {
  private readonly app: App;
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private headingInfo?: HeadingInfo;
  private readonly moveNoticeComponent: MoveNoticeComponent;
  private readonly moveSelectionBuffer: MoveSelectionBuffer;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;
  private readonly selectionHighlightComponent: SelectionHighlightComponent;

  public constructor(params: ExtractThisHeadingEditorCommandHandlerConstructorParams) {
    super({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-scissors',
      id: 'extract-this-heading',
      name: 'Extract this heading...'
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

    const cursorLine = editor.getCursor().line;
    const headingLine = getEnclosingHeadingLine({ app: this.app, cursorLine, file });
    if (headingLine === null) {
      return false;
    }

    const headingInfo = getSelectionUnderHeading({ app: this.app, editor, file, lineNumber: headingLine });
    if (!headingInfo) {
      return false;
    }

    this.headingInfo = headingInfo;
    return true;
  }

  protected override async executeEditor(editor: Editor, context: MarkdownFileInfo): Promise<void> {
    const file = context.file;
    if (!file) {
      return;
    }
    if (this.pluginSettingsComponent.settings.isPathIgnored(file.path)) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot extract from file ');
          f.append(await renderInternalLink({ app: this.app, pathOrAbstractFile: file }));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }
    if (!this.headingInfo) {
      return;
    }
    editor.setSelection(this.headingInfo.start, this.headingInfo.end);
    const result = await prepareForSplitFile({
      app: this.app,
      editor,
      // The enclosing heading names the new note. When splitting headings automatically, it also replaces
      // The target picker entirely (issue #79); otherwise it merely seeds the picker input, exactly as
      // `extractHeading` did before.
      heading: this.headingInfo.heading,
      moveNoticeComponent: this.moveNoticeComponent,
      moveSelectionBuffer: this.moveSelectionBuffer,
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent,
      resourceLockComponent: this.resourceLockComponent,
      selectionHighlightComponent: this.selectionHighlightComponent,
      shouldSkipModal: this.pluginSettingsComponent.settings.shouldSplitHeadingsAutomatically,
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

  protected override shouldAddToEditorMenu(editor: Editor, context: MarkdownFileInfo): boolean {
    super.shouldAddToEditorMenu(editor, context);
    /*
     * Hidden only while a selection is active (issue #188), where `Extract current selection...` is the
     * command the user means. Without a selection the item stays, resolving the heading that ENCLOSES the
     * cursor — so it still works from anywhere in the heading's body (issue #143), not only on the `#` line.
     * Deliberately NOT in `canExecuteEditor`: the palette command and any hotkey keep working with a
     * selection active.
     */
    return !editor.somethingSelected() && checkShouldAddCommandToEditorMenu({
      commandCategory: CommandCategory.SplitAndExtract,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }

  protected override shouldAddToViewportMenu(view: MarkdownView, mode: string, _source: string): boolean {
    // The selection gate above is about which command the user means, not about which menu was raised, so
    // It holds here too.
    return !view.editor.somethingSelected() && checkShouldAddCommandToViewportMenu({
      commandCategory: CommandCategory.SplitAndExtract,
      mode,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }
}
