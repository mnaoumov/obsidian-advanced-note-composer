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

import type { InsertMode } from '../insert-mode.ts';
import type { MoveOptions } from '../modals/paste-options-modal.ts';
import type { MoveSelectionBuffer } from '../move-selection-buffer.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { resolveInsertOffset } from '../composers/composer-base.ts';
import { SplitComposer } from '../composers/split-composer.ts';
import { createMoveToken } from '../move-token.ts';
import { TextAfterExtractionMode } from '../plugin-settings.ts';

/**
 * Where a marked selection is inserted in the target note: a specific `targetCursorOffset` (the paste
 * cursor), or `null` to derive the offset from `insertMode` (top = after frontmatter, bottom = end).
 */
export interface Insertion {
  readonly insertMode: InsertMode;
  readonly targetCursorOffset: null | number;
}

export interface MoveMarkedSelectionEditorCommandHandlerBaseConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly id: string;
  readonly moveSelectionBuffer: MoveSelectionBuffer;
  readonly name: string;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

/**
 * Shared base for the commands that move a marked selection into the active note. Subclasses only
 * decide the insert point ({@link resolveInsertion}) and, optionally, how content-processing options
 * are resolved ({@link resolveOptions}); all validation, locking, and the `SplitComposer` handoff live
 * here.
 */
export abstract class MoveMarkedSelectionEditorCommandHandlerBase extends EditorCommandHandler {
  protected readonly app: App;
  protected readonly consoleDebugComponent: ConsoleDebugComponent;
  protected readonly moveSelectionBuffer: MoveSelectionBuffer;
  protected readonly pluginNoticeComponent: PluginNoticeComponent;
  protected readonly pluginSettingsComponent: PluginSettingsComponent;
  protected readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: MoveMarkedSelectionEditorCommandHandlerBaseConstructorParams) {
    super({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-clipboard-paste',
      id: params.id,
      name: params.name
    });

    this.app = params.app;
    this.consoleDebugComponent = params.consoleDebugComponent;
    this.moveSelectionBuffer = params.moveSelectionBuffer;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.resourceLockComponent = params.resourceLockComponent;
  }

  /**
   * Builds the content-processing options from the plugin's default settings, seeded with the resolved
   * `Text after extraction` mode.
   *
   * @param defaultTextAfterExtractionMode - The residual to leave in the source note.
   * @returns The default options.
   */
  protected buildDefaultOptions(defaultTextAfterExtractionMode: TextAfterExtractionMode): MoveOptions {
    const settings = this.pluginSettingsComponent.settings;
    return {
      frontmatterMergeStrategy: settings.defaultFrontmatterMergeStrategy,
      shouldFixFootnotes: settings.shouldFixFootnotesByDefault,
      shouldIncludeFrontmatter: settings.shouldIncludeFrontmatterWhenSplittingByDefault,
      textAfterExtractionMode: defaultTextAfterExtractionMode
    };
  }

  protected override canExecuteEditor(editor: Editor, ctx: MarkdownFileInfo): boolean {
    const marked = this.moveSelectionBuffer.get();
    if (!marked) {
      return false;
    }
    const targetFile = ctx.file;
    if (!targetFile) {
      return false;
    }
    if (!this.app.vault.getFileByPath(marked.sourceFile.path)) {
      return false;
    }
    if (targetFile.path !== marked.sourceFile.path) {
      return true;
    }

    // Same-note move: forbid an insert point inside the marked selection — the moved content would be
    // Removed along with the source. The bottom offset (end of note) can never be inside a selection;
    // The top offset (after frontmatter) can when the selection spans the frontmatter boundary.
    const insertion = this.resolveInsertion(editor);
    const candidateOffset = insertion.targetCursorOffset ?? resolveInsertOffset(editor.getValue(), insertion.insertMode);
    return !this.moveSelectionBuffer.isOffsetInsideMarkedSelection(candidateOffset);
  }

  protected override async executeEditor(editor: Editor, ctx: MarkdownFileInfo): Promise<void> {
    const targetFile = ctx.file;
    if (!targetFile) {
      return;
    }
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

    if (this.pluginSettingsComponent.settings.isPathIgnored(targetFile.path)) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot move a selection into file ');
          f.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: targetFile }));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }

    if (sourceFile.stat.mtime !== marked.sourceMtime) {
      this.pluginNoticeComponent.showNotice('The note the selection was marked in has changed since it was marked. Mark the selection again.');
      return;
    }

    const isSameFile = sourceFile.path === targetFile.path;
    // A same-note move would otherwise leave a self-link (or self-embed) in place of the moved text,
    // Which is meaningless — so default to leaving nothing unless the user opted in via settings.
    const defaultTextAfterExtractionMode = isSameFile && !this.pluginSettingsComponent.settings.shouldApplyTextAfterExtractionToSameFile
      ? TextAfterExtractionMode.None
      : this.pluginSettingsComponent.settings.textAfterExtractionMode;

    const options = await this.resolveOptions(defaultTextAfterExtractionMode);
    if (!options) {
      return;
    }

    const insertion = this.resolveInsertion(editor);
    const insertToken = createMoveToken();

    // Release the held source lock before the composer runs — `splitFile` acquires its own source +
    // Target locks. The captured data is read from `marked` (a local), so clearing first is safe,
    // Makes the move one-shot, and leaves no dangling mark if the move fails.
    this.moveSelectionBuffer.clear();

    const composer = new SplitComposer({
      app: this.app,
      capturedSelections: marked.capturedSelections,
      consoleDebugComponent: this.consoleDebugComponent,
      editor,
      frontmatterMergeStrategy: options.frontmatterMergeStrategy,
      insertMode: insertion.insertMode,
      insertToken,
      isMultipleSplit: false,
      isNewTargetFile: false,
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent,
      resourceLockComponent: this.resourceLockComponent,
      selectedText: marked.selectedText,
      shouldFixFootnotes: options.shouldFixFootnotes,
      shouldIncludeFrontmatter: options.shouldIncludeFrontmatter,
      sourceFile,
      targetCursorOffset: insertion.targetCursorOffset,
      targetFile,
      textAfterExtractionMode: options.textAfterExtractionMode
    });
    await composer.splitFile();
  }

  /**
   * Resolves the insert point of the move in the target note.
   *
   * @param editor - The target editor.
   * @returns The insertion descriptor.
   */
  protected abstract resolveInsertion(editor: Editor): Insertion;

  /**
   * Resolves the content-processing options for the move. The default uses the plugin's settings with
   * no UI; subclasses may override to prompt the user.
   *
   * @param defaultTextAfterExtractionMode - The residual to leave in the source note.
   * @returns The options, or `null` when the user cancels.
   */
  protected resolveOptions(defaultTextAfterExtractionMode: TextAfterExtractionMode): Promise<MoveOptions | null> {
    return Promise.resolve(this.buildDefaultOptions(defaultTextAfterExtractionMode));
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  protected override shouldAddToEditorMenu(): boolean {
    return true;
  }
}
