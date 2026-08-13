import type { App } from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { MarkdownView } from 'obsidian';

import type { MoveSelectionBuffer } from './move-selection-buffer.ts';

/**
 * Parameters for {@link reopenMarkedSourceNote}.
 */
export interface ReopenMarkedSourceNoteParams {
  readonly app: App;
  readonly moveSelectionBuffer: MoveSelectionBuffer;
  readonly pluginNoticeComponent: PluginNoticeComponent;
}

/**
 * Releases a pending smart-cut mark and re-opens its source note as the active editor, handing the note over
 * to an operation that writes to it — `Switch to split/extract`, and the marked-heading notice's
 * `Split heading recursively...` / `Reorder headings...` actions.
 *
 * Clearing the mark first is what makes the handoff possible at all: the mark holds a `shouldBlockMutations`
 * lock on the source note (and hides the notice and highlight with it), which every one of those operations
 * would otherwise collide with when it takes its own lock.
 *
 * @param params - The parameters.
 * @returns The source note's view, or `null` when nothing is marked, the note is gone, or it did not become
 * the active markdown view.
 */
export async function reopenMarkedSourceNote(params: ReopenMarkedSourceNoteParams): Promise<MarkdownView | null> {
  const marked = params.moveSelectionBuffer.get();
  if (!marked) {
    return null;
  }

  const sourceFile = params.app.vault.getFileByPath(marked.sourceFile.path);
  if (!sourceFile) {
    params.pluginNoticeComponent.showNotice('The note the selection was marked in no longer exists.');
    params.moveSelectionBuffer.clear();
    return null;
  }

  params.moveSelectionBuffer.clear();

  const leaf = params.app.workspace.getLeaf(false);
  await leaf.openFile(sourceFile, { active: true });

  const view = params.app.workspace.getActiveViewOfType(MarkdownView);
  if (!view || view.file?.path !== sourceFile.path) {
    return null;
  }
  return view;
}
