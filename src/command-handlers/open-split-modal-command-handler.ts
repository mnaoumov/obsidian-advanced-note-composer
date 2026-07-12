import type { App } from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { MarkdownView } from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { GlobalCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/global-command-handler';

import type { MoveSelectionBuffer } from '../move-selection-buffer.ts';
import type { ExtractCurrentSelectionEditorCommandHandler } from './extract-current-selection-editor-command-handler.ts';

interface OpenSplitModalCommandHandlerConstructorParams {
  readonly app: App;
  readonly extractCurrentSelectionEditorCommandHandler: ExtractCurrentSelectionEditorCommandHandler;
  readonly moveSelectionBuffer: MoveSelectionBuffer;
  readonly pluginNoticeComponent: PluginNoticeComponent;
}

/**
 * Switches a pending smart-cut mark into the split/extract modal flow — the reverse of the split
 * modal's "Switch to smart cut & paste" action. Available (as a command and the marked-selection
 * notice's top button) whenever a selection is marked. Clearing the mark first releases its held
 * source-note lock, so the split flow can take its own lock without conflict.
 */
export class OpenSplitModalCommandHandler extends GlobalCommandHandler {
  private readonly app: App;
  private readonly extractCurrentSelectionEditorCommandHandler: ExtractCurrentSelectionEditorCommandHandler;
  private readonly moveSelectionBuffer: MoveSelectionBuffer;
  private readonly pluginNoticeComponent: PluginNoticeComponent;

  public constructor(params: OpenSplitModalCommandHandlerConstructorParams) {
    super({
      icon: 'lucide-scissors',
      id: 'open-split-modal',
      name: 'Smart cut & paste: Switch to split/extract'
    });

    this.app = params.app;
    this.extractCurrentSelectionEditorCommandHandler = params.extractCurrentSelectionEditorCommandHandler;
    this.moveSelectionBuffer = params.moveSelectionBuffer;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
  }

  /**
   * Abandons the pending smart-cut mark and re-enters the split/extract flow with the marked selection:
   * re-opens the source note, restores its editor selection to the marked text, then delegates to the
   * `Extract current selection` flow (which offers the switch back to smart cut). Also used by the
   * notice's "Switch to split/extract" button. A no-op when nothing is marked.
   */
  public async openSplitModal(): Promise<void> {
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

    // Snapshot the marked selection before clearing the buffer (which drops the mark).
    const capturedSelections = marked.capturedSelections;

    // Release the held source-note lock (and hide the notice + remove the highlight) before the split
    // Flow runs — `prepareForSplitFile` takes its own lock on the source note, which would otherwise
    // Conflict with the mark's lock.
    this.moveSelectionBuffer.clear();

    // Re-open the source note as the active editor and restore the marked selection, so the reused
    // `Extract current selection` flow sees exactly the text that was marked.
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(sourceFile, { active: true });

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.file?.path !== sourceFile.path) {
      return;
    }

    view.editor.setSelections(capturedSelections.map((selection) => ({
      anchor: view.editor.offsetToPos(selection.startOffset),
      head: view.editor.offsetToPos(selection.endOffset)
    })));

    await this.extractCurrentSelectionEditorCommandHandler.executeInActiveEditor();
  }

  protected override canExecute(): boolean {
    return this.moveSelectionBuffer.hasMark();
  }

  protected override execute(): void {
    invokeAsyncSafely(() => this.openSplitModal());
  }
}
