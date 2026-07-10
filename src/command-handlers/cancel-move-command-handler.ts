import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { GlobalCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/global-command-handler';

import type { MoveSelectionBuffer } from '../move-selection-buffer.ts';

interface CancelMoveCommandHandlerConstructorParams {
  readonly moveSelectionBuffer: MoveSelectionBuffer;
  readonly pluginNoticeComponent: PluginNoticeComponent;
}

export class CancelMoveCommandHandler extends GlobalCommandHandler {
  private readonly moveSelectionBuffer: MoveSelectionBuffer;
  private readonly pluginNoticeComponent: PluginNoticeComponent;

  public constructor(params: CancelMoveCommandHandlerConstructorParams) {
    super({
      icon: 'lucide-x',
      id: 'cancel-move',
      name: 'Smart cut & paste: Cancel move'
    });

    this.moveSelectionBuffer = params.moveSelectionBuffer;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
  }

  /**
   * Cancels the pending move: clears the marked selection (releasing the held source-note lock and
   * hiding the marked-selection notice) and confirms with a notice. Also used by the notice's
   * `Cancel move` button. A no-op-ish call when nothing is marked (the buffer clear is a no-op).
   */
  public cancelMove(): void {
    this.moveSelectionBuffer.clear();
    this.pluginNoticeComponent.showNotice('Cancelled move. The source note is unlocked.');
  }

  protected override canExecute(): boolean {
    return this.moveSelectionBuffer.hasMark();
  }

  protected override execute(): void {
    this.cancelMove();
  }
}
