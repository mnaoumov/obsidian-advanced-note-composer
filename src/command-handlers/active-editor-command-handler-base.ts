import type { App } from 'obsidian';
import type { EditorCommandHandlerConstructorParams } from 'obsidian-dev-utils/obsidian/command-handlers/editor-command-handler';

import { MarkdownView } from 'obsidian';
import { EditorCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/editor-command-handler';

interface ActiveEditorCommandHandlerBaseConstructorParams extends EditorCommandHandlerConstructorParams {
  readonly app: App;
}

/**
 * Shared base for editor command handlers that can also be driven against the active markdown editor
 * (e.g. from a notice button), not only through Obsidian's editor-command dispatch. Adds public
 * {@link canExecuteInActiveEditor} / {@link executeInActiveEditor} that resolve the active
 * {@link MarkdownView} and delegate to the protected `canExecuteEditor` / `executeEditor`.
 */
export abstract class ActiveEditorCommandHandlerBase extends EditorCommandHandler {
  protected readonly app: App;

  public constructor(params: ActiveEditorCommandHandlerBaseConstructorParams) {
    super(params);
    this.app = params.app;
  }

  /**
   * Checks whether this command can run against the active markdown editor. Used to enable or disable a
   * notice button for this command. Mirrors what Obsidian's command dispatch checks: an active markdown
   * view must exist and `canExecuteEditor` must pass for it.
   *
   * @returns Whether the command can run against the active markdown editor.
   */
  public canExecuteInActiveEditor(): boolean {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) {
      return false;
    }
    return this.canExecuteEditor(view.editor, view);
  }

  /**
   * Runs this command against the active markdown editor, if it can. Used by notice buttons. A no-op
   * when there is no active markdown view or the command cannot run there.
   */
  public async executeInActiveEditor(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file || !this.canExecuteEditor(view.editor, view)) {
      return;
    }
    await this.executeEditor(view.editor, view);
  }
}
