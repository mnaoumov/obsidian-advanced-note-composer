import type {
  App,
  Editor,
  MarkdownFileInfo
} from 'obsidian';
import type { PluginNoticeComponent } from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';
import type { ResourceLockComponent } from 'obsidian-dev-utils/obsidian/resource-lock';

import type {
  MarkedSelection,
  MoveSelectionBuffer
} from '../move-selection-buffer.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';
import type { MarkedSwapSide } from '../swap-selection-runner.ts';

import {
  canSwapWithSelection,
  swapWithSelection
} from '../swap-selection-runner.ts';
import { ActiveEditorCommandHandlerBase } from './active-editor-command-handler-base.ts';

interface SwapMarkedSelectionEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly moveSelectionBuffer: MoveSelectionBuffer;
  readonly pluginNoticeComponent: PluginNoticeComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
  readonly resourceLockComponent: ResourceLockComponent;
}

/**
 * Backs the `Swap with selection` button in the Smart cut & paste notice: swaps the smart-cut-marked
 * selection with the active editor's current selection, reusing the shared swap runner (the marked notes
 * are locked while pending and the write runs in a reversible resource-locked transaction). It is driven
 * only through the notice button (via {@link ActiveEditorCommandHandlerBase.canExecuteInActiveEditor} /
 * {@link ActiveEditorCommandHandlerBase.executeInActiveEditor}) and is not registered as a command, so it
 * has no hotkey and never intercepts keys in the main editor.
 */
export class SwapMarkedSelectionEditorCommandHandler extends ActiveEditorCommandHandlerBase {
  private readonly moveSelectionBuffer: MoveSelectionBuffer;
  private readonly pluginNoticeComponent: PluginNoticeComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly resourceLockComponent: ResourceLockComponent;

  public constructor(params: SwapMarkedSelectionEditorCommandHandlerConstructorParams) {
    super({
      app: params.app,
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'switch-camera',
      id: 'swap-marked-selection',
      name: 'Swap selections: Swap marked selection with the current selection'
    });

    this.moveSelectionBuffer = params.moveSelectionBuffer;
    this.pluginNoticeComponent = params.pluginNoticeComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.resourceLockComponent = params.resourceLockComponent;
  }

  protected override canExecuteEditor(editor: Editor, ctx: MarkdownFileInfo): boolean {
    const targetFile = ctx.file;
    if (!targetFile) {
      return false;
    }
    const side = this.resolveMarkedSide();
    if (!side) {
      return false;
    }
    return canSwapWithSelection({
      app: this.app,
      editor,
      marked: side,
      targetFile
    });
  }

  protected override async executeEditor(editor: Editor, ctx: MarkdownFileInfo): Promise<void> {
    const targetFile = ctx.file;
    if (!targetFile) {
      return;
    }
    const side = this.resolveMarkedSide();
    if (!side) {
      return;
    }
    await swapWithSelection({
      app: this.app,
      clearMark: () => {
        this.moveSelectionBuffer.clear();
      },
      editor,
      marked: side,
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent: this.pluginSettingsComponent,
      resourceLockComponent: this.resourceLockComponent,
      targetFile
    });
  }

  /**
   * Resolves the smart-cut mark into a single swap side, or `null` when nothing is marked or the mark
   * covers more than one selection (a swap is one region for one region).
   *
   * @returns The swap side, or `null`.
   */
  private resolveMarkedSide(): MarkedSwapSide | null {
    const marked: MarkedSelection | null = this.moveSelectionBuffer.get();
    if (!marked) {
      return null;
    }
    const [selection, ...rest] = marked.capturedSelections;
    if (!selection || rest.length > 0) {
      return null;
    }
    return {
      endOffset: selection.endOffset,
      selectedText: marked.selectedText,
      sourceFile: marked.sourceFile,
      sourceMtime: marked.sourceMtime,
      startOffset: selection.startOffset
    };
  }
}
