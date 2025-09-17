import type {
  Editor,
  MarkdownFileInfo,
  MarkdownView
} from 'obsidian';

import type { Plugin } from '../Plugin.ts';

import { AdvancedNoteComposer } from '../AdvancedNoteComposer.ts';
import { CorePluginWrapper } from '../CorePluginWrapper.ts';
import { SplitFileSuggestModal } from '../SplitFileModal.ts';
import { CommandInvocationBase } from './CommandBase.ts';
import {
  EditorCommandBase,
  EditorCommandInvocationBase
} from './EditorCommandBase.ts';

class ExtractAfterCursorEditorCommandInvocation extends EditorCommandInvocationBase<Plugin> {
  public constructor(plugin: Plugin, editor: Editor, ctx: MarkdownFileInfo | MarkdownView, private readonly corePluginWrapper: CorePluginWrapper) {
    super(plugin, editor, ctx);
  }

  public override canExecute(): boolean {
    if (!super.canExecute()) {
      return false;
    }

    return true;
  }

  public override execute(): void {
    super.execute();

    const corePlugin = this.corePluginWrapper.getAndCheckCorePlugin();
    if (!corePlugin) {
      return;
    }

    this.editor.setSelection({ ch: this.editor.getLine(this.editor.lastLine()).length, line: this.editor.lastLine() }, this.editor.getCursor());
    const composer = new AdvancedNoteComposer(this.plugin, corePlugin.instance, this.activeFile, this.editor);
    const modal = new SplitFileSuggestModal(composer);
    modal.open();
  }
}

export class ExtractAfterCursorEditorCommand extends EditorCommandBase<Plugin> {
  protected override readonly menuItemName: string = 'Advanced extract after cursor...';

  public constructor(plugin: Plugin, private readonly corePluginWrapper: CorePluginWrapper) {
    super({
      icon: 'lucide-arrow-down-from-line',
      id: 'extract-after-cursor',
      name: 'Extract after cursor...',
      plugin
    });
  }

  protected override createEditorCommandInvocation(editor: Editor, ctx: MarkdownFileInfo | MarkdownView): CommandInvocationBase {
    return new ExtractAfterCursorEditorCommandInvocation(this.plugin, editor, ctx, this.corePluginWrapper);
  }

  protected override shouldAddToEditorMenu(): boolean {
    return true;
  }
}
