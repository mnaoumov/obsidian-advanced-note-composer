import type {
  App,
  Editor,
  MarkdownFileInfo
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { EditorCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/editor-command-handler';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';

import type { LockTarget } from '../locked-transaction.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type {
  MarkedSwapSelection,
  SwapSelectionBuffer
} from '../swap-selection-buffer.ts';
import type { SwapRegion } from '../swap-selections.ts';

import { runLockedTransaction } from '../locked-transaction.ts';
import {
  doRegionsOverlap,
  swapContents,
  swapSameFileContent
} from '../swap-selections.ts';

interface SwapWithMarkedSelectionEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
  readonly swapSelectionBuffer: SwapSelectionBuffer;
}

/**
 * Swaps the current editor selection with the previously marked selection (`Swap selections: Mark
 * selection to swap`), exchanging the two pieces of text across their notes (or within one note). Both
 * notes are locked and the writes run in a reversible transaction.
 */
export class SwapWithMarkedSelectionEditorCommandHandler extends EditorCommandHandler {
  private readonly app: App;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;
  private readonly swapSelectionBuffer: SwapSelectionBuffer;

  public constructor(params: SwapWithMarkedSelectionEditorCommandHandlerConstructorParams) {
    super({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'switch-camera',
      id: 'swap-with-marked-selection',
      name: 'Swap selections: Swap with marked selection'
    });

    this.app = params.app;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.resourceLockComponent = params.resourceLockComponent;
    this.swapSelectionBuffer = params.swapSelectionBuffer;
  }

  protected override canExecuteEditor(editor: Editor, ctx: MarkdownFileInfo): boolean {
    const marked = this.swapSelectionBuffer.get();
    if (!marked) {
      return false;
    }
    const targetFile = ctx.file;
    if (!targetFile) {
      return false;
    }
    if (!editor.somethingSelected()) {
      return false;
    }
    if (!this.app.vault.getFileByPath(marked.sourceFile.path)) {
      return false;
    }
    if (targetFile.path !== marked.sourceFile.path) {
      return true;
    }

    // Same-note swap: the two selections must not overlap — swapping a selection with one that shares
    // Characters with it is meaningless and would corrupt the text.
    return !doRegionsOverlap(getEditorRegion(editor), markedRegion(marked));
  }

  protected override async executeEditor(editor: Editor, ctx: MarkdownFileInfo): Promise<void> {
    const targetFile = ctx.file;
    if (!targetFile) {
      return;
    }
    const marked = this.swapSelectionBuffer.get();
    if (!marked) {
      return;
    }

    const sourceFile = this.app.vault.getFileByPath(marked.sourceFile.path);
    if (!sourceFile) {
      this.pluginNoticeComponent.showNotice('The note the selection was marked in no longer exists.');
      this.swapSelectionBuffer.clear();
      return;
    }

    if (this.pluginSettingsComponent.settings.isPathIgnored(targetFile.path)) {
      this.pluginNoticeComponent.showNotice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot swap a selection into file ');
          f.appendChild(await renderInternalLink({ app: this.app, pathOrAbstractFile: targetFile }));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }

    if (sourceFile.stat.mtime !== marked.sourceMtime) {
      this.pluginNoticeComponent.showNotice('The note the selection was marked in has changed since it was marked. Mark the selection again.');
      return;
    }

    const isSameFile = sourceFile.path === targetFile.path;
    const targetRegion = getEditorRegion(editor);
    const sourceRegion = markedRegion(marked);
    if (isSameFile && doRegionsOverlap(targetRegion, sourceRegion)) {
      this.pluginNoticeComponent.showNotice('You cannot swap a selection with one that overlaps it.');
      return;
    }

    const targetContent = editor.getValue();
    const sourceContent = isSameFile ? targetContent : await this.app.vault.read(sourceFile);
    if (sourceContent.slice(sourceRegion.startOffset, sourceRegion.endOffset) !== marked.selectedText) {
      this.pluginNoticeComponent.showNotice('The marked selection no longer matches the source note. Mark the selection again.');
      this.swapSelectionBuffer.clear();
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

    this.swapSelectionBuffer.clear();

    const lockTargets: LockTarget[] = isSameFile
      ? [{ mode: 'file', pathOrFile: sourceFile }]
      : [{ mode: 'file', pathOrFile: sourceFile }, { mode: 'file', pathOrFile: targetFile }];

    await runLockedTransaction({
      abortController: new AbortController(),
      app: this.app,
      body: async (vaultTransaction) => {
        await vaultTransaction.modify(sourceFile, newSourceContent);
        if (newTargetContent !== null) {
          await vaultTransaction.modify(targetFile, newTargetContent);
        }
      },
      lockTargets,
      operationName: 'Swap selections',
      resourceLockComponent: this.resourceLockComponent
    });

    this.pluginNoticeComponent.showNotice('Selections swapped.');
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  protected override shouldAddToEditorMenu(): boolean {
    return true;
  }
}

function getEditorRegion(editor: Editor): SwapRegion {
  return {
    endOffset: editor.posToOffset(editor.getCursor('to')),
    startOffset: editor.posToOffset(editor.getCursor('from'))
  };
}

function markedRegion(marked: MarkedSwapSelection): SwapRegion {
  return { endOffset: marked.endOffset, startOffset: marked.startOffset };
}
