import type {
  Editor,
  IconName,
  MarkdownFileInfo,
  MarkdownView
} from 'obsidian';
import type { HeadingInfo } from 'obsidian-typings/implementations';

import { Notice } from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/HTMLElement';
import { CommandInvocationBase } from 'obsidian-dev-utils/obsidian/Commands/CommandBase';
import {
  EditorCommandBase,
  EditorCommandInvocationBase
} from 'obsidian-dev-utils/obsidian/Commands/EditorCommandBase';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/Markdown';

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

    if (this.plugin.settings.isPathIgnored(this.file.path)) {
      new Notice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot extract from file ');
          f.appendChild(await renderInternalLink(this.app, this.file));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }

    if (!this.headingInfo) {
      return;
    }

    this.editor.setSelection(this.headingInfo.start, this.headingInfo.end);
    const composer = new AdvancedNoteComposer({
      editor: this.editor,
      heading: this.headingInfo.heading,
      plugin: this.plugin,
      sourceFile: this.file
    });
    const modal = new SplitFileSuggestModal(this.app, composer);
    modal.open();
  }
}

export class ExtractThisHeadingEditorCommand extends EditorCommandBase<Plugin> {
  protected override readonly editorMenuSubmenuIcon: IconName = 'lucide-git-merge';

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
