import type {
  App,
  Editor,
  TFile
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';

import type { LockTarget } from './locked-transaction.ts';
import type { PluginSettingsComponent } from './plugin-settings-component.ts';
import type { SwapRegion } from './swap-selections.ts';

import { runLockedTransaction } from './locked-transaction.ts';
import { showOperationCompletionNotice } from './operation-notices.ts';
import {
  areRegionsOverlapping,
  swapContents,
  swapSameFileContent
} from './swap-selections.ts';

/**
 * Parameters shared by {@link canSwapWithSelection} and {@link swapWithSelection}.
 */
export interface CanSwapWithSelectionParams {
  readonly app: App;

  /**
   * The target editor holding the second (live) selection to swap with the marked one.
   */
  readonly editor: Editor;

  /**
   * The already-marked side of the swap.
   */
  readonly marked: MarkedSwapSide;

  /**
   * The note the target editor is showing.
   */
  readonly targetFile: TFile;
}

/**
 * The already-marked side of a selection swap: the region and text captured earlier (by either the
 * `Mark selection to swap` command or a smart-cut mark), plus its source note and mark-time mtime.
 */
export interface MarkedSwapSide {
  /**
   * The exclusive end offset of the marked region in the source note.
   */
  readonly endOffset: number;

  /**
   * The marked text, used as a staleness guard against the live source content.
   */
  readonly selectedText: string;

  /**
   * The note the selection was marked in.
   */
  readonly sourceFile: TFile;

  /**
   * The source note's modification time at mark time.
   */
  readonly sourceMtime: number;

  /**
   * The inclusive start offset of the marked region in the source note.
   */
  readonly startOffset: number;
}

/**
 * Parameters for {@link swapWithSelection}.
 */
export interface SwapWithSelectionParams extends CanSwapWithSelectionParams {
  /**
   * Releases the mark (dropping any held lock and hiding any pending notice); called before the write so
   * the swap is one-shot and the swap's own transaction can re-lock the notes.
   */
  clearMark(): void;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

/**
 * Whether the marked selection can be swapped with the target editor's current selection: the source
 * note must still exist, the target editor must have a selection, and — for a same-note swap — the two
 * regions must not overlap (swapping overlapping regions is meaningless and would corrupt the text).
 *
 * @param params - The parameters.
 * @returns Whether the swap can run.
 */
export function canSwapWithSelection(params: CanSwapWithSelectionParams): boolean {
  const {
    app,
    editor,
    marked,
    targetFile
  } = params;
  if (!app.vault.getFileByPath(marked.sourceFile.path)) {
    return false;
  }
  if (!editor.somethingSelected()) {
    return false;
  }
  if (targetFile.path !== marked.sourceFile.path) {
    return true;
  }
  return !areRegionsOverlapping(getEditorRegion(editor), markedRegion(marked));
}

/**
 * Swaps the marked selection with the target editor's current selection, exchanging the two pieces of
 * text across their notes (or within one note). The mark is released first and the writes run in a
 * reversible resource-locked transaction that locks both notes.
 *
 * @param params - The parameters.
 */
export async function swapWithSelection(params: SwapWithSelectionParams): Promise<void> {
  const {
    app,
    editor,
    marked,
    pluginNoticeComponent,
    pluginSettingsComponent,
    resourceLockComponent,
    targetFile
  } = params;

  const sourceFile = app.vault.getFileByPath(marked.sourceFile.path);
  if (!sourceFile) {
    pluginNoticeComponent.showNotice('The note the selection was marked in no longer exists.');
    params.clearMark();
    return;
  }

  if (pluginSettingsComponent.settings.isPathIgnored(targetFile.path)) {
    pluginNoticeComponent.showNotice(
      await createFragmentAsync(async (f) => {
        f.appendText('You cannot swap a selection into file ');
        f.append(await renderInternalLink({ app, pathOrAbstractFile: targetFile }));
        f.appendText(' because it is ignored in the plugin settings.');
      })
    );
    return;
  }

  if (sourceFile.stat.mtime !== marked.sourceMtime) {
    pluginNoticeComponent.showNotice('The note the selection was marked in has changed since it was marked. Mark the selection again.');
    return;
  }

  const isSameFile = sourceFile.path === targetFile.path;
  const targetRegion = getEditorRegion(editor);
  const sourceRegion = markedRegion(marked);
  if (isSameFile && areRegionsOverlapping(targetRegion, sourceRegion)) {
    pluginNoticeComponent.showNotice('You cannot swap a selection with one that overlaps it.');
    return;
  }

  const targetContent = editor.getValue();
  const sourceContent = isSameFile ? targetContent : await app.vault.read(sourceFile);
  if (sourceContent.slice(sourceRegion.startOffset, sourceRegion.endOffset) !== marked.selectedText) {
    pluginNoticeComponent.showNotice('The marked selection no longer matches the source note. Mark the selection again.');
    params.clearMark();
    return;
  }

  let newSourceContent: string;
  let newTargetContent: null | string;
  if (isSameFile) {
    newSourceContent = swapSameFileContent({ content: targetContent, regionA: sourceRegion, regionB: targetRegion });
    newTargetContent = null;
  } else {
    const swapped = swapContents({ sourceContent, sourceRegion, targetContent, targetRegion });
    newSourceContent = swapped.newSourceContent;
    newTargetContent = swapped.newTargetContent;
  }

  params.clearMark();

  const lockTargets: LockTarget[] = isSameFile
    ? [{ mode: 'file', pathOrFile: sourceFile }]
    : [{ mode: 'file', pathOrFile: sourceFile }, { mode: 'file', pathOrFile: targetFile }];

  await runLockedTransaction({
    abortController: new AbortController(),
    app,
    body: async (vaultTransaction) => {
      await vaultTransaction.modify(sourceFile, newSourceContent);
      if (newTargetContent !== null) {
        await vaultTransaction.modify(targetFile, newTargetContent);
      }
    },
    lockTargets,
    operationName: 'Swap selections',
    resourceLockComponent
  });

  showOperationCompletionNotice({
    content: 'Selections swapped.',
    pluginNoticeComponent,
    pluginSettingsComponent
  });
}

function getEditorRegion(editor: Editor): SwapRegion {
  return {
    endOffset: editor.posToOffset(editor.getCursor('to')),
    startOffset: editor.posToOffset(editor.getCursor('from'))
  };
}

function markedRegion(marked: MarkedSwapSide): SwapRegion {
  return { endOffset: marked.endOffset, startOffset: marked.startOffset };
}
