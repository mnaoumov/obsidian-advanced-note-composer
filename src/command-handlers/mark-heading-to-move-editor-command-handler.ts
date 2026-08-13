import type {
  App,
  Editor,
  MarkdownFileInfo
} from 'obsidian';
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
  getEnclosingHeadingLine,
  getSelectionUnderHeading
} from '../composers/composer-base.ts';
import { markSelectionToMove } from '../mark-selection-to-move.ts';

interface MarkHeadingToMoveEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly moveNoticeComponent: MoveNoticeComponent;
  readonly moveSelectionBuffer: MoveSelectionBuffer;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
  readonly selectionHighlightComponent: SelectionHighlightComponent;
}

/**
 * `Smart cut & paste: Mark heading to move` (issue #229) — the smart cut & paste mark applied to a whole
 * heading section instead of a hand-made selection: the heading line, its body, and everything nested under
 * it are marked, locked and highlighted exactly as a marked selection is, and every move/paste target the
 * notice offers works on them unchanged.
 *
 * The heading is the one ENCLOSING the cursor (issue #143), the same rule `Extract this heading...` and
 * `Split heading recursively...` use — which is what makes right-clicking anywhere inside a heading's section
 * the entry point the issue asked for, with no UI surface of its own.
 */
export class MarkHeadingToMoveEditorCommandHandler extends EditorCommandHandler {
  private readonly app: App;
  private readonly moveNoticeComponent: MoveNoticeComponent;
  private readonly moveSelectionBuffer: MoveSelectionBuffer;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;
  private readonly selectionHighlightComponent: SelectionHighlightComponent;

  public constructor(params: MarkHeadingToMoveEditorCommandHandlerConstructorParams) {
    super({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-scissors',
      id: 'mark-heading-to-move',
      name: 'Smart cut & paste: Mark heading to move'
    });

    this.app = params.app;
    this.moveNoticeComponent = params.moveNoticeComponent;
    this.moveSelectionBuffer = params.moveSelectionBuffer;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.resourceLockComponent = params.resourceLockComponent;
    this.selectionHighlightComponent = params.selectionHighlightComponent;
  }

  protected override canExecuteEditor(editor: Editor, context: MarkdownFileInfo): boolean {
    if (isEditorCommandBlocked(this.pluginSettingsComponent, context)) {
      return false;
    }
    const file = context.file;
    if (!file) {
      return false;
    }
    const headingLine = getEnclosingHeadingLine({ app: this.app, cursorLine: editor.getCursor().line, file });
    if (headingLine === null) {
      return false;
    }
    return getSelectionUnderHeading({ app: this.app, editor, file, lineNumber: headingLine }) !== null;
  }

  protected override async executeEditor(editor: Editor, context: MarkdownFileInfo): Promise<void> {
    const file = context.file;
    if (!file) {
      return;
    }
    if (this.pluginSettingsComponent.settings.isPathIgnored(file.path)) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot move a heading from file ');
          f.append(await renderInternalLink({ app: this.app, pathOrAbstractFile: file }));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }

    /*
     * Re-resolved here rather than remembered from `canExecuteEditor`: the gate runs whenever Obsidian builds
     * a menu or checks the palette, so a cursor moved in between would otherwise mark a heading the user has
     * already left.
     */
    const headingLine = getEnclosingHeadingLine({ app: this.app, cursorLine: editor.getCursor().line, file });
    if (headingLine === null) {
      return;
    }
    const headingInfo = getSelectionUnderHeading({ app: this.app, editor, file, lineNumber: headingLine });
    if (!headingInfo) {
      return;
    }

    // The section's own bounds — heading line through its last nested line — which is the same range
    // `Extract this heading...` extracts.
    const startOffset = editor.posToOffset(headingInfo.start);
    const endOffset = editor.posToOffset(headingInfo.end);

    markSelectionToMove({
      app: this.app,
      capturedSelections: [{ endOffset, startOffset }],
      markedHeading: {
        line: headingLine,
        text: headingInfo.heading
      },
      moveNoticeComponent: this.moveNoticeComponent,
      moveSelectionBuffer: this.moveSelectionBuffer,
      resourceLockComponent: this.resourceLockComponent,
      selectedText: editor.getRange(headingInfo.start, headingInfo.end),
      selectionHighlightComponent: this.selectionHighlightComponent,
      shouldLockAllNotes: this.pluginSettingsComponent.settings.shouldLockAllNotesWhenMarkingSelection,
      sourceFile: file
    });
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  protected override shouldAddToEditorMenu(editor: Editor, context: MarkdownFileInfo): boolean {
    super.shouldAddToEditorMenu(editor, context);
    /*
     * Hidden only while a selection is active (issue #188), where `Mark selection to move` is the command the
     * user means — the same rule `Extract this heading...` and the recursive splits follow. The palette
     * command and any hotkey keep working with a selection active.
     */
    return !editor.somethingSelected();
  }
}
