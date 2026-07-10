import type {
  App,
  Editor,
  MarkdownFileInfo
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { EditorCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/editor-command-handler';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';

import type {
  MarkedSelection,
  MoveSelectionBuffer
} from '../move-selection-buffer.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { getSelections } from '../composers/split-composer.ts';

interface MarkSelectionToMoveEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly moveSelectionBuffer: MoveSelectionBuffer;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

export class MarkSelectionToMoveEditorCommandHandler extends EditorCommandHandler {
  private readonly app: App;
  private readonly moveSelectionBuffer: MoveSelectionBuffer;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: MarkSelectionToMoveEditorCommandHandlerConstructorParams) {
    super({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-scissors',
      id: 'mark-selection-to-move',
      name: 'Mark selection to move'
    });

    this.app = params.app;
    this.moveSelectionBuffer = params.moveSelectionBuffer;
    this.resourceLockComponent = params.resourceLockComponent;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
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
          f.appendText('You cannot move a selection from file ');
          f.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: file }));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }

    // Lock (blocking edit/delete/rename/move) for as long as the mark is held, so the captured
    // Selection offsets cannot be invalidated before the move runs. By default only the source note is
    // Locked; when `shouldLockAllNotesWhenMarkingSelection` is on, a subtree lock on the vault root
    // Locks every note so the user must finish the extraction before editing anything. Released by
    // `MoveSelectionBuffer.clear` (on move, `Cancel move`, or re-mark) or by aborting `abortController`.
    const abortController = new AbortController();
    const shouldLockAllNotes = this.pluginSettingsComponent.settings.shouldLockAllNotesWhenMarkingSelection;
    const lock = this.resourceLockComponent.lockForPath(shouldLockAllNotes ? this.app.vault.getRoot().path : file, {
      abortController,
      mode: shouldLockAllNotes ? 'subtree' : 'file',
      shouldBlockMutations: true
    });

    // A permanent notice reminds the user a selection is marked for the whole time the mark is held; it
    // Is hidden when the mark is released (move, `Cancel move`, or re-mark) via `MoveSelectionBuffer.clear`.
    const notice = this.pluginNoticeComponent.showNotice(
      createFragment((f) => {
        f.appendText('Marked selection to move. Run ');
        appendCodeBlock(f, 'Move marked selection here');
        f.appendText(' in the target note, or ');
        appendCodeBlock(f, 'Cancel move');
        f.appendText(' to release.');
      }),
      { isPermanent: true }
    );

    const markedSelection: MarkedSelection = {
      abortController,
      capturedSelections: getSelections(editor),
      lock,
      notice,
      selectedText: editor.getSelection(),
      sourceFile: file,
      sourceMtime: file.stat.mtime
    };

    // Aborting the lock (the `Unlock active note` command or the lock indicator's right-click unlock)
    // Cancels the entire pending move: `clear` releases the lock, drops the mark, and hides the notice.
    // Guarded on identity so a stale controller can never cancel a subsequently-marked selection.
    abortController.signal.addEventListener('abort', () => {
      if (this.moveSelectionBuffer.get() === markedSelection) {
        this.moveSelectionBuffer.clear();
      }
    }, { once: true });

    this.moveSelectionBuffer.mark(markedSelection);
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  protected override shouldAddToEditorMenu(): boolean {
    return true;
  }
}
