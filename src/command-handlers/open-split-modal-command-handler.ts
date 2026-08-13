import type { App } from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { invokeAsyncSafely } from 'obsidian-dev-utils/async';
import { GlobalCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/global-command-handler';

import type { MoveSelectionBuffer } from '../move-selection-buffer.ts';
import type { ExtractCurrentSelectionEditorCommandHandler } from './extract-current-selection-editor-command-handler.ts';

import { reopenMarkedSourceNote } from '../marked-source-handoff.ts';

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

    // Snapshot the marked selection before the handoff clears the buffer (which drops the mark).
    const capturedSelections = marked.capturedSelections;

    // Releases the held source-note lock (hiding the notice + removing the highlight) and re-opens the
    // Source note — `prepareForSplitFile` takes its own lock on it, which would otherwise conflict.
    const view = await reopenMarkedSourceNote({
      app: this.app,
      moveSelectionBuffer: this.moveSelectionBuffer,
      pluginNoticeComponent: this.pluginNoticeComponent
    });
    if (!view) {
      return;
    }

    // Restore the marked selection, so the reused `Extract current selection` flow sees exactly the text
    // That was marked.
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
