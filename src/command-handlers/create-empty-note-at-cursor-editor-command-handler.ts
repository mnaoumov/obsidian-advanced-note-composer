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

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { CONTENT_ONLY_TEMPLATE } from '../apply-split-template.ts';
import { isEditorCommandBlocked } from '../command-block.ts';
import { SplitComposer } from '../composers/split-composer.ts';
import { prepareForSplitFile } from '../modals/split-file-modal.ts';

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
    return !isEditorCommandBlocked(this.pluginSettingsComponent, context);
  }

  protected override async executeEditor(editor: Editor, context: MarkdownFileInfo): Promise<void> {
    const file = context.file;
    if (!file) {
      return;
    }

    if (this.pluginSettingsComponent.settings.isPathIgnored(file.path)) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot create a note from file ');
          f.append(await renderInternalLink({ app: this.app, pathOrAbstractFile: file }));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }

    // Collapse to the cursor BEFORE anything captures the selection. Without this the flow would extract
    // Nothing (this command never reads the selected text) and then overwrite the selected text with the
    // Residual link — losing content the user never asked to move.
    editor.setSelection(editor.getCursor());

    const prepareForSplitFileResult = await prepareForSplitFile({
      app: this.app,
      canMergeIntoExistingNote: false,
      editor,
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent,
      resourceLockComponent: this.resourceLockComponent,
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
      // Nothing, since nothing was extracted — is where the caret goes when the note opens (#244). Naming
      // The template is also what tells the composer to write it at all; the identity template stands for
      // "no template configured", which leaves the note genuinely empty. `Merge template` is deliberately
      // NOT the fallback here: wrapping it around no content is what left two blank lines in a note asked
      // To be empty.
      templateOverride: this.pluginSettingsComponent.settings.splitTemplate || CONTENT_ONLY_TEMPLATE
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
