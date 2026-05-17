import type {
  Editor,
  MarkdownFileInfo
} from 'obsidian';

import { Notice } from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { EditorCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/editor-command-handler';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';

import type { Plugin } from '../plugin.ts';

import { SplitComposer } from '../composers/split-composer.ts';
import { prepareForSplitFile } from '../modals/split-file-modal.ts';

export class ExtractBeforeCursorEditorCommandHandler extends EditorCommandHandler {
  public constructor(private readonly plugin: Plugin) {
    super({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-arrow-up-from-line',
      id: 'extract-before-cursor',
      name: 'Extract before cursor...'
    });
  }

  protected override async executeEditor(editor: Editor, ctx: MarkdownFileInfo): Promise<void> {
    const file = ctx.file;
    if (!file) {
      return;
    }
    if (this.plugin.pluginSettingsComponent.settings.isPathIgnored(file.path)) {
      new Notice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot extract from file ');
          f.appendChild(await renderInternalLink(this.plugin.app, file));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }
    editor.setSelection({ ch: 0, line: 0 }, editor.getCursor());
    const result = await prepareForSplitFile(this.plugin, file, editor);
    if (!result) {
      return;
    }
    const composer = new SplitComposer({
      editor,
      frontmatterMergeStrategy: result.frontmatterMergeStrategy,
      insertMode: result.insertMode,
      isMultipleSplit: false,
      isNewTargetFile: result.isNewTargetFile,
      plugin: this.plugin,
      shouldAllowOnlyCurrentFolder: result.shouldAllowOnlyCurrentFolder,
      shouldAllowSplitIntoUnresolvedPath: result.shouldAllowSplitIntoUnresolvedPath,
      shouldFixFootnotes: result.shouldFixFootnotes,
      shouldIncludeFrontmatter: result.shouldIncludeFrontmatter,
      shouldMergeHeadings: result.shouldMergeHeadings,
      sourceFile: file,
      targetFile: result.targetFile
    });
    await composer.splitFile();
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return this.plugin.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  protected override shouldAddToEditorMenu(): boolean {
    return true;
  }
}
