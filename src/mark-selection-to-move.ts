import type {
  App,
  TFile
} from 'obsidian';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import type { Selection } from './composers/composer-base.ts';
import type { MoveNoticeComponent } from './move-notice-component.ts';
import type {
  MarkedSelection,
  MoveSelectionBuffer
} from './move-selection-buffer.ts';
import type { SelectionHighlightComponent } from './selection-highlight-component.ts';

/**
 * Parameters for {@link markSelectionToMove}.
 */
export interface MarkSelectionToMoveParams {
  readonly app: App;
  readonly capturedSelections: Selection[];
  readonly moveNoticeComponent: MoveNoticeComponent;
  readonly moveSelectionBuffer: MoveSelectionBuffer;
  readonly resourceLockComponent: ResourceLockComponent;
  readonly selectedText: string;
  readonly selectionHighlightComponent: SelectionHighlightComponent;
  readonly shouldLockAllNotes: boolean;
  readonly sourceFile: TFile;
}

/**
 * Marks the given selection for moving: locks the source note (blocking edit/delete/rename/move) for as
 * long as the mark is held, shows the permanent marked-selection notice, and records the mark in the
 * buffer. Shared by the `Mark selection to move` command and the split picker's "switch to smart cut"
 * action.
 *
 * By default only the source note is locked; when `shouldLockAllNotes` is set, a subtree lock on the
 * vault root locks every note (read-only + mutation-blocked) so the user must finish the extraction
 * before editing anything.
 *
 * The held lock is cancelable: the built-in `Unlock active note` aborts every lock on the note (thereby
 * cancelling all operations that hold one), and this mark observes that abort to release itself — the
 * buffer is cleared and the notice hidden — so unlocking also cancels a pending move.
 *
 * @param params - The parameters.
 */
export function markSelectionToMove(params: MarkSelectionToMoveParams): void {
  const abortController = new AbortController();
  const lock = params.resourceLockComponent.lockForPath({
    abortController,
    mode: params.shouldLockAllNotes ? 'subtree' : 'file',
    operationName: 'Move selection',
    pathOrFile: params.shouldLockAllNotes ? params.app.vault.getRoot().path : params.sourceFile,
    shouldBlockMutations: true
  });

  const notice = params.moveNoticeComponent.showNotice();
  const highlight = params.selectionHighlightComponent.addHighlight(params.sourceFile, params.capturedSelections);

  const markedSelection: MarkedSelection = {
    abortController,
    capturedSelections: params.capturedSelections,
    highlight,
    lock,
    notice,
    selectedText: params.selectedText,
    sourceFile: params.sourceFile,
    sourceMtime: params.sourceFile.stat.mtime
  };
  params.moveSelectionBuffer.mark(markedSelection);
  params.moveNoticeComponent.refreshButtons();

  // When the source note is unlocked, `requestResourceUnlockForPath` aborts every lock on it (cancelling
  // Every operation that holds one); tear this mark down too — but only while it is still the current
  // Mark, since a later re-mark installs its own controller and must not be cleared by this one.
  abortController.signal.addEventListener('abort', () => {
    if (params.moveSelectionBuffer.get() === markedSelection) {
      params.moveSelectionBuffer.clear();
    }
  }, { once: true });
}
