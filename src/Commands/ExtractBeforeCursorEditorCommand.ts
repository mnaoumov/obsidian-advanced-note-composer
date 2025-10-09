import type {
  Editor,
  MarkdownFileInfo,
  MarkdownView
} from 'obsidian';

import { CommandInvocationBase } from 'obsidian-dev-utils/obsidian/Commands/CommandBase';
import {
  EditorCommandBase,
  EditorCommandInvocationBase
} from 'obsidian-dev-utils/obsidian/Commands/EditorCommandBase';

import type { Plugin } from '../Plugin.ts';

import { AdvancedNoteComposer } from '../AdvancedNoteComposer.ts';
import { SplitFileSuggestModal } from '../SplitFileModal.ts';

class ExtractBeforeCursorEditorCommandInvocation extends EditorCommandInvocationBase<Plugin> {
  public constructor(plugin: Plugin, editor: Editor, ctx: MarkdownFileInfo | MarkdownView) {
    super(plugin, editor, ctx);
  }

  public override canExecute(): boolean {
    if (!super.canExecute()) {
      return false;
    }

    return true;
  }

  public override async execute(): Promise<void> {
    await super.execute();

    this.editor.setSelection({ ch: 0, line: 0 }, this.editor.getCursor());
    const composer = new AdvancedNoteComposer(this.plugin, this.file, this.editor);
    const modal = new SplitFileSuggestModal(composer);
    modal.open();
  }
}

export class ExtractBeforeCursorEditorCommand extends EditorCommandBase<Plugin> {
  protected override readonly editorMenuItemName: string = 'Advanced extract before cursor...';

  public constructor(plugin: Plugin) {
    super({
      icon: 'lucide-arrow-up-from-line',
      id: 'extract-before-cursor',
      name: 'Extract before cursor...',
      plugin
    });
  }

  protected override createEditorCommandInvocation(editor: Editor, ctx: MarkdownFileInfo | MarkdownView): CommandInvocationBase {
    return new ExtractBeforeCursorEditorCommandInvocation(this.plugin, editor, ctx);
  }

  protected override shouldAddToEditorMenu(): boolean {
    return true;
  }
}
