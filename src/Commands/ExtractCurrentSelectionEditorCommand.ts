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

class ExtractCurrentSelectionEditorCommandInvocation extends EditorCommandInvocationBase<Plugin> {
  public constructor(plugin: Plugin, editor: Editor, ctx: MarkdownFileInfo | MarkdownView) {
    super(plugin, editor, ctx);
  }

  public override canExecute(): boolean {
    if (!super.canExecute()) {
      return false;
    }

    if (!this.editor.somethingSelected()) {
      return false;
    }

    return true;
  }

  public override async execute(): Promise<void> {
    await super.execute();

    const composer = new AdvancedNoteComposer(this.plugin, this.file, this.editor);
    const modal = new SplitFileSuggestModal(composer);
    modal.open();
  }
}

export class ExtractCurrentSelectionEditorCommand extends EditorCommandBase<Plugin> {
  protected override readonly editorMenuItemName: string = 'Advanced extract current selection...';
  protected override readonly editorMenuSection: string = 'selection';

  public constructor(plugin: Plugin) {
    super({
      icon: 'lucide-scissors',
      id: 'extract-current-selection',
      name: 'Extract current selection...',
      plugin
    });
  }

  protected override createEditorCommandInvocation(editor: Editor, ctx: MarkdownFileInfo | MarkdownView): CommandInvocationBase {
    return new ExtractCurrentSelectionEditorCommandInvocation(this.plugin, editor, ctx);
  }

  protected override shouldAddToEditorMenu(): boolean {
    return true;
  }
}
