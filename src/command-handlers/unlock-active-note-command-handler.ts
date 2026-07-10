import type { App } from 'obsidian';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { GlobalCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/global-command-handler';
import {
  isResourceLockedForPath,
  requestResourceUnlockForPath
} from 'obsidian-dev-utils/obsidian/resource-lock';

import type { MoveSelectionBuffer } from '../move-selection-buffer.ts';

interface UnlockActiveNoteCommandHandlerConstructorParams {
  readonly app: App;
  readonly moveSelectionBuffer: MoveSelectionBuffer;
  readonly resourceLockComponent: ResourceLockComponent;
}

/**
 * Unlocks the active note. Available whenever the active note is locked — either directly (a merge/
 * split operation, or a source-only mark lock) or via the all-notes mark lock (a `subtree` lock on the
 * vault root). For a pending mark this cancels the entire move (releases the lock, drops the mark, and
 * hides the notice) through the abort listener wired at mark time.
 */
export class UnlockActiveNoteCommandHandler extends GlobalCommandHandler {
  private readonly app: App;
  private readonly moveSelectionBuffer: MoveSelectionBuffer;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: UnlockActiveNoteCommandHandlerConstructorParams) {
    super({
      icon: 'lucide-lock-open',
      id: 'unlock-active-note',
      name: 'Unlock active note'
    });

    this.app = params.app;
    this.moveSelectionBuffer = params.moveSelectionBuffer;
    this.resourceLockComponent = params.resourceLockComponent;
  }

  protected override canExecute(): boolean {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      return false;
    }
    if (isResourceLockedForPath(this.app, activeFile)) {
      return true;
    }
    // Not directly locked, but a pending mark can lock every note (all-notes mode locks the vault root
    // As a subtree), so offer the command on any note whose mutation the mark currently blocks.
    return this.moveSelectionBuffer.hasMark() && this.resourceLockComponent.isMutationBlockedByAncestorForPath(activeFile);
  }

  protected override execute(): void {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      return;
    }
    if (isResourceLockedForPath(this.app, activeFile)) {
      // A direct lock on the active note (a merge/split operation, or a source-only mark lock).
      // Requesting its unlock aborts that operation's controller; for a mark that cancels the move.
      requestResourceUnlockForPath(this.app, activeFile);
      return;
    }
    // Covered only by the all-notes mark lock: abort the mark's controller to cancel the whole move.
    const marked = this.moveSelectionBuffer.get();
    if (marked) {
      marked.abortController.abort();
    }
  }
}
