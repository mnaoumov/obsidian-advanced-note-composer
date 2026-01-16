import type {
  Editor,
  IconName,
  MarkdownFileInfo,
  MarkdownView
} from 'obsidian';

import { Notice } from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/HTMLElement';
import { CommandInvocationBase } from 'obsidian-dev-utils/obsidian/Commands/CommandBase';
import {
  EditorCommandBase,
  EditorCommandInvocationBase
} from 'obsidian-dev-utils/obsidian/Commands/EditorCommandBase';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/Markdown';

import type { Plugin } from '../Plugin.ts';

import { SplitComposer } from '../Composers/SplitComposer.ts';
import { prepareForSplitFile } from '../Modals/SplitFileModal.ts';

class ExtractAfterCursorEditorCommandInvocation extends EditorCommandInvocationBase<Plugin> {
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

    this.editor.setSelection({ ch: this.editor.getLine(this.editor.lastLine()).length, line: this.editor.lastLine() }, this.editor.getCursor());
    const prepareForSplitFileResult = await prepareForSplitFile(this.plugin, this.file, this.editor);
    if (!prepareForSplitFileResult) {
      return;
    }

    const composer = new SplitComposer({
      editor: this.editor,
      frontmatterMergeStrategy: prepareForSplitFileResult.frontmatterMergeStrategy,
      insertMode: prepareForSplitFileResult.insertMode,
      isNewTargetFile: prepareForSplitFileResult.isNewTargetFile,
      plugin: this.plugin,
      shouldAllowOnlyCurrentFolder: prepareForSplitFileResult.shouldAllowOnlyCurrentFolder,
      shouldAllowSplitIntoUnresolvedPath: prepareForSplitFileResult.shouldAllowSplitIntoUnresolvedPath,
      shouldFixFootnotes: prepareForSplitFileResult.shouldFixFootnotes,
      shouldIncludeFrontmatter: prepareForSplitFileResult.shouldIncludeFrontmatter,
      shouldMergeHeadings: prepareForSplitFileResult.shouldMergeHeadings,
      sourceFile: this.file,
      targetFile: prepareForSplitFileResult.targetFile
    });
    await composer.splitFile();
  }
}

export class ExtractAfterCursorEditorCommand extends EditorCommandBase<Plugin> {
  protected override readonly editorMenuSubmenuIcon: IconName = 'lucide-git-merge';

  public constructor(plugin: Plugin) {
    super({
      icon: 'lucide-arrow-down-from-line',
      id: 'extract-after-cursor',
      name: 'Extract after cursor...',
      plugin
    });
  }

  protected override createEditorCommandInvocation(editor: Editor, ctx: MarkdownFileInfo | MarkdownView): CommandInvocationBase {
    return new ExtractAfterCursorEditorCommandInvocation(this.plugin, editor, ctx);
  }

  protected override shouldAddToEditorMenu(): boolean {
    return true;
  }
}
