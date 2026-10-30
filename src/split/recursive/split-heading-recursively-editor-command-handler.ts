import type { ConsoleDebugComponent } from '@mnaoumov/obsidian-lib/components/console-debug-component';
import type { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import type { ResourceLockComponent } from '@mnaoumov/obsidian-lib/resource-lock';
import type {
  App,
  CachedMetadata,
  Editor,
  MarkdownFileInfo,
  MarkdownView,
  TFile
} from 'obsidian';

import type { BulkOperationRunner } from '../../bulk-operations/bulk-operation-runner.ts';
import type { PluginSettingsComponent } from '../../settings/plugin-settings-component.ts';
import type { RecursiveSplitRun } from './split-recursively-editor-command-handler-base.ts';

import {
  getEnclosingHeadingLine,
  getSelectionUnderHeading
} from '../../composers/composer-base.ts';
import { isEditorCommandBlocked } from '../../settings/command-visibility/command-block.ts';
import {
  checkShouldAddCommandToEditorMenu,
  checkShouldAddCommandToViewportMenu
} from '../../settings/command-visibility/command-menu-placement.ts';
import { CommandCategory } from '../../settings/plugin-settings.ts';
import {
  buildRecursiveSplitPreviewRows,
  getHeadingSubtree
} from './heading-split-recursion.ts';
import { SplitRecursivelyEditorCommandHandlerBase } from './split-recursively-editor-command-handler-base.ts';

interface SplitHeadingRecursivelyEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly bulkOperationRunner: BulkOperationRunner;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

/**
 * `Split heading recursively...` (issue #228) — the recursive split scoped to ONE heading: the heading the
 * cursor is in becomes a folder holding a note of its own name, its sub-headings nest inside it exactly as
 * they would in a whole-note recursive split, and every other heading in the note is left alone.
 *
 * The heading is the one ENCLOSING the cursor (issue #143), the same rule `Extract this heading...` uses —
 * which is what makes right-clicking anywhere in a heading's section the entry point, with no new UI
 * surface of its own.
 */
export class SplitHeadingRecursivelyEditorCommandHandler extends SplitRecursivelyEditorCommandHandlerBase {
  public constructor(params: SplitHeadingRecursivelyEditorCommandHandlerConstructorParams) {
    super({
      app: params.app,
      bulkOperationRunner: params.bulkOperationRunner,
      consoleDebugComponent: params.consoleDebugComponent,
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-folder-tree',
      id: 'split-heading-recursively',
      name: 'Split heading recursively...',
      pluginNoticeComponent: params.pluginNoticeComponent,
      pluginSettingsComponent: params.pluginSettingsComponent,
      resourceLockComponent: params.resourceLockComponent
    });
  }

  protected override canExecuteEditor(editor: Editor, context: MarkdownFileInfo): boolean {
    super.canExecuteEditor(editor, context);
    if (isEditorCommandBlocked({ commandCategory: CommandCategory.SplitAndExtract, context, pluginSettingsComponent: this.pluginSettingsComponent })) {
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
    /*
     * A heading with no sub-headings is deliberately still offered: it produces `X/X.md`, which is exactly
     * what the whole-note recursive split does when it reaches a leaf. What IS checked is that the heading
     * owns a resolvable range, so the command is never offered where the split would only report failure.
     */
    return getSelectionUnderHeading({ app: this.app, editor, file, lineNumber: headingLine }) !== null;
  }

  protected override resolveRun(editor: Editor, file: TFile, cache: CachedMetadata): null | RecursiveSplitRun {
    /*
     * Re-resolved here rather than remembered from `canExecuteEditor`: the gate runs whenever Obsidian
     * builds a menu or checks the palette, so a cursor moved in between would otherwise split a heading the
     * user has already left.
     */
    const headingLine = getEnclosingHeadingLine({ app: this.app, cursorLine: editor.getCursor().line, file });
    if (headingLine === null) {
      return null;
    }
    const subtree = getHeadingSubtree(cache.headings ?? [], headingLine);
    const rootHeading = subtree[0];
    if (!rootHeading) {
      return null;
    }
    return {
      completionVerb: 'Split heading in',
      dialogTitle: 'Split heading recursively',
      headingText: rootHeading.heading,
      // Only the chosen heading and what nests under it — which is also exactly the set of notes the run
      // will create, so the dialog's list doubles as the promise that the note's other headings stay put.
      previewRows: buildRecursiveSplitPreviewRows(editor.getValue(), subtree),
      progressVerb: 'Splitting heading recursively in',
      rootHeadingLine: headingLine
    };
  }

  protected override shouldAddToEditorMenu(editor: Editor, context: MarkdownFileInfo): boolean {
    super.shouldAddToEditorMenu(editor, context);
    /*
     * Hidden only while a selection is active (issue #188), where `Extract current selection...` is the
     * command the user means — the same rule `Extract this heading...` and the whole-note recursive split
     * follow. The palette command and any hotkey keep working with a selection active.
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
