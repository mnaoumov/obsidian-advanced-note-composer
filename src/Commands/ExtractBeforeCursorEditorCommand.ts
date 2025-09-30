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
import { CorePluginWrapper } from '../CorePluginWrapper.ts';
import { SplitFileSuggestModal } from '../SplitFileModal.ts';

class ExtractBeforeCursorEditorCommandInvocation extends EditorCommandInvocationBase<Plugin> {
  public constructor(plugin: Plugin, editor: Editor, ctx: MarkdownFileInfo | MarkdownView, private readonly corePluginWrapper: CorePluginWrapper) {
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

    const corePlugin = this.corePluginWrapper.getAndCheckCorePlugin();
    if (!corePlugin) {
      return;
    }

    this.editor.setSelection({ ch: 0, line: 0 }, this.editor.getCursor());
    const composer = new AdvancedNoteComposer(this.plugin, corePlugin.instance, this.file, this.editor);
    const modal = new SplitFileSuggestModal(composer);
    modal.open();
  }
}

export class ExtractBeforeCursorEditorCommand extends EditorCommandBase<Plugin> {
  protected override readonly menuItemName: string = 'Advanced extract before cursor...';

  public constructor(plugin: Plugin, private readonly corePluginWrapper: CorePluginWrapper) {
    super({
      icon: 'lucide-arrow-up-from-line',
      id: 'extract-before-cursor',
      name: 'Extract before cursor...',
      plugin
    });
  }

  protected override createEditorCommandInvocation(editor: Editor, ctx: MarkdownFileInfo | MarkdownView): CommandInvocationBase {
    return new ExtractBeforeCursorEditorCommandInvocation(this.plugin, editor, ctx, this.corePluginWrapper);
  }

  protected override shouldAddToEditorMenu(): boolean {
    return true;
  }
}
