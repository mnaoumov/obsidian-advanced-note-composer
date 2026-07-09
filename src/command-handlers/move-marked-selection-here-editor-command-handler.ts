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

import type { MoveOptions } from '../modals/paste-options-modal.ts';
import type { MoveSelectionBuffer } from '../move-selection-buffer.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { SplitComposer } from '../composers/split-composer.ts';
import { openPasteOptionsModal } from '../modals/paste-options-modal.ts';

interface MoveMarkedSelectionHereEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;

  /**
   * When `true`, the command prompts for content-processing options before moving; when `false`, it
   * uses the plugin's default settings without any UI.
   */
  readonly isAdvanced: boolean;
  readonly moveSelectionBuffer: MoveSelectionBuffer;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

export class MoveMarkedSelectionHereEditorCommandHandler extends EditorCommandHandler {
  private readonly app: App;
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly isAdvanced: boolean;
  private readonly moveSelectionBuffer: MoveSelectionBuffer;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: MoveMarkedSelectionHereEditorCommandHandlerConstructorParams) {
    super({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-clipboard-paste',
      id: params.isAdvanced ? 'move-marked-selection-here-advanced' : 'move-marked-selection-here',
      name: params.isAdvanced ? 'Move marked selection here (advanced)...' : 'Move marked selection here'
    });

    this.app = params.app;
    this.consoleDebugComponent = params.consoleDebugComponent;
    this.isAdvanced = params.isAdvanced;
    this.moveSelectionBuffer = params.moveSelectionBuffer;
    this.resourceLockComponent = params.resourceLockComponent;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
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
    if (targetFile.path === marked.sourceFile.path) {
      return !this.moveSelectionBuffer.isCursorInsideMarkedSelection(editor);
    }
    return true;
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

    const options = await this.resolveOptions();
    if (!options) {
      return;
    }

    const targetCursorOffset = editor.posToOffset(editor.getCursor());
    // eslint-disable-next-line n/no-unsupported-features/node-builtins -- crypto.randomUUID is a stable Web API in the Obsidian (Electron) runtime.
    const insertToken = `<!--advanced-note-composer-move-${crypto.randomUUID()}-->`;

    // Release the held source lock before the composer runs — `splitFile` acquires its own
    // Source + target locks. The captured data is read from `marked` (a local), so clearing first is
    // Safe, makes the move one-shot, and leaves no dangling mark if the move fails.
    this.moveSelectionBuffer.clear();

    const composer = new SplitComposer({
      app: this.app,
      capturedSelections: marked.capturedSelections,
      consoleDebugComponent: this.consoleDebugComponent,
      editor,
      frontmatterMergeStrategy: options.frontmatterMergeStrategy,
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
      targetCursorOffset,
      targetFile
    });
    await composer.splitFile();
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  protected override shouldAddToEditorMenu(): boolean {
    return true;
  }

  private async resolveOptions(): Promise<MoveOptions | null> {
    const settings = this.pluginSettingsComponent.settings;
    const defaultOptions: MoveOptions = {
      frontmatterMergeStrategy: settings.defaultFrontmatterMergeStrategy,
      shouldFixFootnotes: settings.shouldFixFootnotesByDefault,
      shouldIncludeFrontmatter: settings.shouldIncludeFrontmatterWhenSplittingByDefault
    };
    if (!this.isAdvanced) {
      return defaultOptions;
    }
    return await openPasteOptionsModal({ app: this.app, defaultOptions });
  }
}
