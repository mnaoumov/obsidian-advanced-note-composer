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

import type { SelectionRange } from '../../select/select-ranges.ts';
import type { PluginSettingsComponent } from '../../settings/plugin-settings-component.ts';
import type { MoveSelectionBuffer } from '../../smart-cut/mark/move-selection-buffer.ts';
import type { SelectionHighlightComponent } from '../../smart-cut/mark/selection-highlight-component.ts';
import type { MoveNoticeComponent } from '../../smart-cut/move-notice-component.ts';

import {
  getEnclosingHeadingLine,
  getSelectionUnderHeading
} from '../../composers/composer-base.ts';
import { getHeadingContentSelection } from '../../select/select-ranges.ts';
import { isEditorCommandBlocked } from '../../settings/command-visibility/command-block.ts';
import {
  checkShouldAddCommandToEditorMenu,
  checkShouldAddCommandToViewportMenu
} from '../../settings/command-visibility/command-menu-placement.ts';
import { CommandCategory } from '../../settings/plugin-settings.ts';
import { prepareForSplitFile } from '../picker/split-file-modal.ts';
import { SplitComposer } from '../split-composer.ts';

interface ExtractTarget {
  readonly heading: string;
  readonly range: SelectionRange;
}

interface ExtractThisHeadingEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  /**
   * `true` for `Extract this heading's content...`: the heading's line stays in the note and only what is under it
   * is extracted (discussion #310).
   */
  readonly isContentOnly?: boolean;
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
  private readonly isContentOnly: boolean;
  private readonly moveNoticeComponent: MoveNoticeComponent;
  private readonly moveSelectionBuffer: MoveSelectionBuffer;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;
  private readonly selectionHighlightComponent: SelectionHighlightComponent;
  private target?: ExtractTarget;

  public constructor(params: ExtractThisHeadingEditorCommandHandlerConstructorParams) {
    const isContentOnly = params.isContentOnly ?? false;
    super(
      isContentOnly
        ? {
          editorMenuSubmenuIcon: 'lucide-git-merge',
          icon: 'lucide-text',
          id: 'extract-this-heading-content',
          name: 'Extract this heading\'s content...'
        }
        : {
          editorMenuSubmenuIcon: 'lucide-git-merge',
          icon: 'lucide-scissors',
          id: 'extract-this-heading',
          name: 'Extract this heading...'
        }
    );

    this.isContentOnly = isContentOnly;
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

    /*
     * The content-only variant takes the same section without its `#` line, through the very finder
     * `Select this heading's content` uses, so the two can never disagree about where the body starts. A heading
     * with no body has nothing to extract, so the command is not offered on it.
     */
    const range = this.isContentOnly
      ? getHeadingContentSelection({ editor, headingInfo })
      : { end: headingInfo.end, start: headingInfo.start };
    if (!range) {
      return false;
    }

    this.target = { heading: headingInfo.heading, range };
    return true;
  }

  protected override async executeEditor(editor: Editor, context: MarkdownFileInfo): Promise<void> {
    const file = context.file;
    if (!file || !this.target) {
      return;
    }
    editor.setSelection(this.target.range.start, this.target.range.end);
    const result = await prepareForSplitFile({
      app: this.app,
      editor,
      // The enclosing heading names the new note. When splitting headings automatically, it also replaces
      // the target picker entirely (issue #79); otherwise it merely seeds the picker input, exactly as
      // `extractHeading` did before.
      heading: this.target.heading,
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
      commandId: this.id,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }

  protected override shouldAddToViewportMenu(view: MarkdownView, mode: string, _source: string): boolean {
    // The selection gate above is about which command the user means, not about which menu was raised, so
    // it holds here too.
    return !view.editor.somethingSelected() && checkShouldAddCommandToViewportMenu({
      commandId: this.id,
      mode,
      pluginSettingsComponent: this.pluginSettingsComponent
    });
  }
}
