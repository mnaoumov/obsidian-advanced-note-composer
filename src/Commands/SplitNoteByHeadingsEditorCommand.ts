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
import { getCacheSafe } from 'obsidian-dev-utils/obsidian/MetadataCache';

import type { Level } from '../MarkdownHeadingDocument.ts';
import type { Plugin } from '../Plugin.ts';

import {
  AdvancedNoteComposer,
  getSelectionUnderHeading
} from '../AdvancedNoteComposer.ts';

class SplitNoteByHeadingsEditorCommandInvocation extends EditorCommandInvocationBase<Plugin> {
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

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- No better way for infinite loop.
    while (true) {
      const cache = await getCacheSafe(this.app, this.file);
      if (!cache) {
        break;
      }

      const heading = (cache.headings ?? []).find((h) => h.level === this.headingLevel);
      if (!heading) {
        break;
      }

      const headingInfo = getSelectionUnderHeading(this.app, this.file, this.editor, heading.position.start.line);
      if (!headingInfo) {
        new Notice('Failed to find heading');
        return;
      }

      this.editor.setSelection(headingInfo.start, headingInfo.end);
      const composer = new AdvancedNoteComposer({
        editor: this.editor,
        heading: headingInfo.heading,
        plugin: this.plugin,
        sourceFile: this.file
      });
      await composer.splitFile();
    }
  }
}

export class SplitNoteByHeadingsEditorCommand extends EditorCommandBase<Plugin> {
  protected override readonly editorMenuSubmenuIcon: IconName = 'lucide-git-merge';

  public constructor(plugin: Plugin, private readonly headingLevel: Level) {
    super({
      icon: 'lucide-scissors-line-dashed',
      id: `split-note-by-headings-h${String(headingLevel)}`,
      name: `Split note by headings - H${String(headingLevel)}`,
      plugin
    });
  }

  protected override createEditorCommandInvocation(editor: Editor, ctx: MarkdownFileInfo | MarkdownView): CommandInvocationBase {
    return new SplitNoteByHeadingsEditorCommandInvocation(this.plugin, editor, ctx, this.headingLevel);
  }

  protected override shouldAddToEditorMenu(): boolean {
    return true;
  }
}
