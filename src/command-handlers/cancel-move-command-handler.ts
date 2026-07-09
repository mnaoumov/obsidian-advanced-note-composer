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
      name: 'Cancel move'
    });

    this.moveSelectionBuffer = params.moveSelectionBuffer;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
  }

  protected override canExecute(): boolean {
    return this.moveSelectionBuffer.hasMark();
  }

  protected override execute(): void {
    this.moveSelectionBuffer.clear();
    this.pluginNoticeComponent.showNotice('Cancelled move. The source note is unlocked.');
  }
}
