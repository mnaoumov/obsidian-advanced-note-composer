import type {
  Editor,
  MarkdownFileInfo,
  MarkdownView
} from 'obsidian';
import type { HeadingInfo } from 'obsidian-typings/implementations';

import type { Plugin } from '../Plugin.ts';

import {
  AdvancedNoteComposer,
  extractHeadingFromLine
} from '../AdvancedNoteComposer.ts';
import { CorePluginWrapper } from '../CorePluginWrapper.ts';
import { SplitFileSuggestModal } from '../SplitFileModal.ts';
import { CommandInvocationBase } from './CommandBase.ts';
import {
  EditorCommandBase,
  EditorCommandInvocationBase
} from './EditorCommandBase.ts';

class ExtractThisHeadingEditorCommandInvocation extends EditorCommandInvocationBase<Plugin> {
  private headingInfo!: HeadingInfo;

  public constructor(plugin: Plugin, editor: Editor, ctx: MarkdownFileInfo | MarkdownView, private readonly corePluginWrapper: CorePluginWrapper) {
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

    const corePlugin = this.corePluginWrapper.getCorePlugin();
    if (corePlugin.enabled) {
      const headingInfo = corePlugin.instance.getSelectionUnderHeading(this.activeFile, this.editor, lineNumber);
      if (!headingInfo) {
        return false;
      }
      this.headingInfo = headingInfo;
    }

    return true;
  }

  public override execute(): void {
    super.execute();

    const corePlugin = this.corePluginWrapper.getAndCheckCorePlugin();
    if (!corePlugin) {
      return;
    }

    this.editor.setSelection(this.headingInfo.start, this.headingInfo.end);
    const composer = new AdvancedNoteComposer(this.plugin, corePlugin.instance, this.activeFile, this.editor, this.headingInfo.heading);
    const modal = new SplitFileSuggestModal(composer);
    modal.open();
  }
}

export class ExtractThisHeadingEditorCommand extends EditorCommandBase<Plugin> {
  protected override readonly menuItemName: string = 'Advanced extract this heading...';

  public constructor(plugin: Plugin, private readonly corePluginWrapper: CorePluginWrapper) {
    super({
      icon: 'lucide-scissors',
      id: 'extract-this-heading',
      name: 'Extract this heading...',
      plugin
    });
  }

  protected override createEditorCommandInvocation(editor: Editor, ctx: MarkdownFileInfo | MarkdownView): CommandInvocationBase {
    return new ExtractThisHeadingEditorCommandInvocation(this.plugin, editor, ctx, this.corePluginWrapper);
  }

  protected override shouldAddToEditorMenu(): boolean {
    return true;
  }
}
