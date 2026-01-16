import type {
  Editor,
  EditorPosition,
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
import { getCacheSafe } from 'obsidian-dev-utils/obsidian/MetadataCache';

import type { Level } from '../MarkdownHeadingDocument.ts';
import type { Plugin } from '../Plugin.ts';

import { getSelectionUnderHeading } from '../Composers/ComposerBase.ts';
import { SplitComposer } from '../Composers/SplitComposer.ts';
import { SplitItemSelector } from '../ItemSelectors/SplitItemSelector.ts';

class SplitNoteByHeadingsEditorContentCommandInvocation extends EditorCommandInvocationBase<Plugin> {
  public constructor(
    plugin: Plugin,
    editor: Editor,
    ctx: MarkdownFileInfo | MarkdownView,
    private readonly headingLevel: Level
  ) {
    super(plugin, editor, ctx);
  }

  public override canExecute(): boolean {
    if (!super.canExecute()) {
      return false;
    }

    const cache = this.app.metadataCache.getFileCache(this.file);
    if (!cache) {
      return false;
    }

    const headings = cache.headings?.filter((heading) => heading.level === this.headingLevel);
    if (!headings || headings.length === 0) {
      return false;
    }

    return true;
  }

  public override async execute(): Promise<void> {
    await super.execute();

    if (this.plugin.settings.isPathIgnored(this.file.path)) {
      new Notice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot split file ');
          f.appendChild(await renderInternalLink(this.app, this.file));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }

    let headingIndex = 0;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- No better way for infinite loop.
    while (true) {
      const cache = await getCacheSafe(this.app, this.file);
      if (!cache) {
        break;
      }

      const heading = (cache.headings ?? []).filter((h) => h.level === this.headingLevel)[headingIndex];
      if (!heading) {
        break;
      }

      const headingInfo = getSelectionUnderHeading(this.app, this.file, this.editor, heading.position.start.line);
      if (!headingInfo) {
        new Notice('Failed to find heading');
        return;
      }

      const splitStart: EditorPosition = { ch: 0, line: heading.position.end.line + 1 };
      this.editor.setSelection(splitStart, headingInfo.end);
      const selectItemResult = await new SplitItemSelector({
        inputValue: headingInfo.heading,
        isMod: false,
        item: null,
        plugin: this.plugin,
        shouldAllowOnlyCurrentFolder: this.plugin.settings.shouldAllowOnlyCurrentFolderByDefault,
        shouldTreatTitleAsPath: this.plugin.settings.shouldTreatTitleAsPathByDefault,
        sourceFile: this.file
      }).selectItem();
      const composer = new SplitComposer({
        editor: this.editor,
        heading: headingInfo.heading,
        isNewTargetFile: selectItemResult.isNewTargetFile,
        plugin: this.plugin,
        sourceFile: this.file,
        targetFile: selectItemResult.targetFile
      });
      await composer.splitFile();

      if (this.plugin.settings.shouldKeepHeadingsWhenSplittingContent) {
        headingIndex++;
      } else {
        this.editor.replaceRange('', { ch: 0, line: heading.position.start.line }, splitStart);
      }
    }
  }
}

export class SplitNoteByHeadingsContentEditorCommand extends EditorCommandBase<Plugin> {
  protected override readonly editorMenuSubmenuIcon: IconName = 'lucide-git-merge';

  public constructor(plugin: Plugin, private readonly headingLevel: Level) {
    super({
      icon: 'lucide-scissors-line-dashed',
      id: `split-note-by-headings-content-h${String(headingLevel)}`,
      name: `Split note by headings content - H${String(headingLevel)}`,
      plugin
    });
  }

  protected override createEditorCommandInvocation(editor: Editor, ctx: MarkdownFileInfo | MarkdownView): CommandInvocationBase {
    return new SplitNoteByHeadingsEditorContentCommandInvocation(this.plugin, editor, ctx, this.headingLevel);
  }

  protected override shouldAddToEditorMenu(): boolean {
    return true;
  }
}
