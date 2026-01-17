import type {
  Editor,
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

import { getSelectionUnderHeading } from '../Composers/ComposerBase.ts';
import { SplitComposer } from '../Composers/SplitComposer.ts';
import { extractHeadingFromLine } from '../Headings.ts';
import { prepareForSplitFile } from '../Modals/SplitFileModal.ts';

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
    const prepareForSplitFileResult = await prepareForSplitFile(this.plugin, this.file, this.editor);
    if (!prepareForSplitFileResult) {
      return;
    }

    const composer = new SplitComposer({
      editor: this.editor,
      frontmatterMergeStrategy: prepareForSplitFileResult.frontmatterMergeStrategy,
      insertMode: prepareForSplitFileResult.insertMode,
      isMultipleSplit: false,
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

export class ExtractThisHeadingEditorCommand extends EditorCommandBase<Plugin> {
  protected override get shouldAddCommandToSubmenu(): boolean {
    return this.plugin.settings.shouldAddCommandsToSubmenu;
  }

  public constructor(plugin: Plugin) {
    super({
      editorMenuSubmenuIcon: 'lucide-git-merge',
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
