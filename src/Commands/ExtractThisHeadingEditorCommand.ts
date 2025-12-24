import type {
  Editor,
  MarkdownFileInfo,
  MarkdownView
} from 'obsidian';
import type { HeadingInfo } from 'obsidian-typings/implementations';

import { CommandInvocationBase } from 'obsidian-dev-utils/obsidian/Commands/CommandBase';
import {
  EditorCommandBase,
  EditorCommandInvocationBase
} from 'obsidian-dev-utils/obsidian/Commands/EditorCommandBase';

import type { Plugin } from '../Plugin.ts';

import {
  AdvancedNoteComposer,
  extractHeadingFromLine,
  getSelectionUnderHeading
} from '../AdvancedNoteComposer.ts';
import { SplitFileSuggestModal } from '../Modals/SplitFileModal.ts';

class ExtractThisHeadingEditorCommandInvocation extends EditorCommandInvocationBase<Plugin> {
  private headingInfo?: HeadingInfo;

  public constructor(plugin: Plugin, editor: Editor, ctx: MarkdownFileInfo | MarkdownView) {
    super(plugin, editor, ctx);
  }

  public override canExecute(): boolean {
    if (!super.canExecute()) {
      return false;
    }

    const lineNumber = this.editor.getCursor().line;
    const line = this.editor.getLine(lineNumber);
    const heading = extractHeadingFromLine(line);
    if (!heading) {
      return false;
    }

    const headingInfo = getSelectionUnderHeading(this.app, this.file, this.editor, lineNumber);
    if (!headingInfo) {
      return false;
    }

    this.headingInfo = headingInfo;
    return true;
  }

  public override async execute(): Promise<void> {
    await super.execute();

    if (!this.headingInfo) {
      return;
    }

    this.editor.setSelection(this.headingInfo.start, this.headingInfo.end);
    const composer = new AdvancedNoteComposer(this.plugin, this.file, this.editor, this.headingInfo.heading);
    const modal = new SplitFileSuggestModal(composer);
    modal.open();
  }
}

export class ExtractThisHeadingEditorCommand extends EditorCommandBase<Plugin> {
  protected override readonly editorMenuItemName: string = 'Advanced extract this heading...';

  public constructor(plugin: Plugin) {
    super({
      icon: 'lucide-scissors',
      id: 'extract-this-heading',
      name: 'Extract this heading...',
      plugin
    });
  }

  protected override createEditorCommandInvocation(editor: Editor, ctx: MarkdownFileInfo | MarkdownView): CommandInvocationBase {
    return new ExtractThisHeadingEditorCommandInvocation(this.plugin, editor, ctx);
  }

  protected override shouldAddToEditorMenu(): boolean {
    return true;
  }
}
