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

import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';

import { isEditorCommandBlocked } from '../settings/command-visibility/command-block.ts';
import {
  checkShouldAddCommandToEditorMenu,
  checkShouldAddCommandToViewportMenu
} from '../settings/command-visibility/command-menu-placement.ts';
import { CommandCategory } from '../settings/plugin-settings.ts';
import { prepareForSplitFile } from '../split/picker/split-file-modal.ts';
import { CONTENT_ONLY_TEMPLATE } from '../split/recursive/apply-split-template.ts';
import { SplitComposer } from '../split/split-composer.ts';

interface CreateEmptyNoteAtCursorEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

/**
 * Creates a brand-new EMPTY note through the extract/split flow (issue #244), leaving whatever
 * `Text after extraction` asks for — a link, by default — at the cursor.
 *
 * The pipeline needed no persuading: an empty selection is a zero-length range like any other, so the picker,
 * the folder prompt, the confirmation dialog and the transaction all work unchanged. What this command adds
 * is the three things an extract of NOTHING has to say for itself:
 *
 * - it does not require a selection (`Extract current selection...` still does, so nothing anyone has bound
 *   changes behavior);
 * - it COLLAPSES any selection to the cursor first, because the residual is written with
 *   `Editor.replaceSelection` — run over a real selection it would replace that text with the link;
 * - it forbids `Merge` (`canMergeIntoExistingNote: false`), since merging nothing into an existing note is an
 *   operation with no content and no effect.
 *
 * The marked-selection collaborators are deliberately not wired: `Switch to smart cut & paste` would mark an
 * empty selection to move, and there is nothing to highlight either.
 *
 * "Empty" is the DEFAULT rather than the promise: a configured `Split template` fills the created note, and
 * its `{{content}}` — interpolating to nothing here — is where the caret goes when the note opens. Naming
 * that template is also what tells the composer to write anything at all.
 */
export class CreateEmptyNoteAtCursorEditorCommandHandler extends EditorCommandHandler {
  private readonly app: App;
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: CreateEmptyNoteAtCursorEditorCommandHandlerConstructorParams) {
    super({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-file-plus',
      id: 'create-empty-note-at-cursor',
      name: 'Create empty note at cursor...'
    });

    this.app = params.app;
    this.consoleDebugComponent = params.consoleDebugComponent;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.resourceLockComponent = params.resourceLockComponent;
  }

  protected override canExecuteEditor(_editor: Editor, context: MarkdownFileInfo): boolean {
    return !isEditorCommandBlocked({ commandCategory: CommandCategory.Create, context, pluginSettingsComponent: this.pluginSettingsComponent });
  }

  protected override async executeEditor(editor: Editor, context: MarkdownFileInfo): Promise<void> {
    const file = context.file;
    if (!file) {
      return;
    }

    // Collapse to the cursor BEFORE anything captures the selection. Without this the flow would extract
    // nothing (this command never reads the selected text) and then overwrite the selected text with the
    // residual link — losing content the user never asked to move.
    editor.setSelection(editor.getCursor());

    const prepareForSplitFileResult = await prepareForSplitFile({
      app: this.app,
      canMergeIntoExistingNote: false,
      editor,
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent,
      resourceLockComponent: this.resourceLockComponent,
      // The name is typed from scratch, not taken from a heading, so it is cleaned the way
      // `Create empty note in folder...` cleans it (issue #283).
      shouldCleanTypedName: true,
      sourceFile: file
    });
    if (!prepareForSplitFileResult) {
      return;
    }

    const composer = new SplitComposer({
      app: this.app,
      capturedSelections: prepareForSplitFileResult.capturedSelections,
      consoleDebugComponent: this.consoleDebugComponent,
      editor,
      frontmatterMergeStrategy: prepareForSplitFileResult.frontmatterMergeStrategy,
      insertMode: prepareForSplitFileResult.insertMode,
      isMultipleSplit: false,
      isNewTargetFile: prepareForSplitFileResult.isNewTargetFile,
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent,
      resourceLockComponent: this.resourceLockComponent,
      selectedText: prepareForSplitFileResult.selectedText,
      shouldFixFootnotes: prepareForSplitFileResult.shouldFixFootnotes,
      shouldIncludeFrontmatter: prepareForSplitFileResult.shouldIncludeFrontmatter,
      shouldMergeHeadings: prepareForSplitFileResult.shouldMergeHeadings,
      sourceFile: file,
      targetFile: prepareForSplitFileResult.targetFile,
      // The created note is filled with the `Split template`, and its `{{content}}` — interpolating to
      // nothing, since nothing was extracted — is where the caret goes when the note opens (#244). Naming
      // the template is also what tells the composer to write it at all; the identity template stands for
      // "no template configured", which leaves the note genuinely empty. `Merge template` is deliberately
      // NOT the fallback here: wrapping it around no content is what left two blank lines in a note asked
      // to be empty.
      templateOverride: this.pluginSettingsComponent.settings.splitTemplate || CONTENT_ONLY_TEMPLATE
    });
    await composer.splitFile();
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  protected override shouldAddToEditorMenu(editor: Editor, context: MarkdownFileInfo): boolean {
    super.shouldAddToEditorMenu(editor, context);
    /*
     * Hidden while a selection is active (issue #265), following the rule issue #188 set for the extracts:
     * with text selected, this is not the command the user means. Here it is also a safety rail — the
     * command COLLAPSES the selection to the cursor before it does anything (that collapse is what keeps
     * it from overwriting the selected text with the new note's link), so a mis-click on a highlighted
     * passage looks like it ate the selection.
     *
     * Deliberately NOT in `canExecuteEditor`: the palette command and any hotkey keep working with a
     * selection active, which is the same boundary every other #188 gate holds to.
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
