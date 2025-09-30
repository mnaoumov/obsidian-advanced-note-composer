import type {
  Editor,
  EditorPosition,
  MarkdownFileInfo,
  MarkdownView
} from 'obsidian';

import { Notice } from 'obsidian';
import { CommandInvocationBase } from 'obsidian-dev-utils/obsidian/Commands/CommandBase';
import {
  EditorCommandBase,
  EditorCommandInvocationBase
} from 'obsidian-dev-utils/obsidian/Commands/EditorCommandBase';
import { getCacheSafe } from 'obsidian-dev-utils/obsidian/MetadataCache';

import type { Level } from '../MarkdownHeadingDocument.ts';
import type { Plugin } from '../Plugin.ts';

import { AdvancedNoteComposer } from '../AdvancedNoteComposer.ts';
import { CorePluginWrapper } from '../CorePluginWrapper.ts';

class SplitNoteByHeadingsEditorContentCommandInvocation extends EditorCommandInvocationBase<Plugin> {
  public constructor(
    plugin: Plugin,
    editor: Editor,
    ctx: MarkdownFileInfo | MarkdownView,
    private readonly corePluginWrapper: CorePluginWrapper,
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

    const corePlugin = this.corePluginWrapper.getAndCheckCorePlugin();
    if (!corePlugin) {
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

      const headingInfo = corePlugin.instance.getSelectionUnderHeading(this.file, this.editor, heading.position.start.line);
      if (!headingInfo) {
        new Notice('Failed to find heading');
        return;
      }

      const splitStart: EditorPosition = { ch: 1, line: headingInfo.start.line + 1 };
      this.editor.setSelection(splitStart, headingInfo.end);
      const composer = new AdvancedNoteComposer(this.plugin, corePlugin.instance, this.file, this.editor, headingInfo.heading);
      await composer.splitFile();
      headingIndex++;
    }
  }
}

export class SplitNoteByHeadingsContentEditorCommand extends EditorCommandBase<Plugin> {
  public constructor(plugin: Plugin, private readonly corePluginWrapper: CorePluginWrapper, private readonly headingLevel: Level) {
    super({
      icon: 'lucide-scissors-line-dashed',
      id: `split-note-by-headings-content-h${String(headingLevel)}`,
      name: `Split note by headings content - H${String(headingLevel)}`,
      plugin
    });
  }

  protected override createEditorCommandInvocation(editor: Editor, ctx: MarkdownFileInfo | MarkdownView): CommandInvocationBase {
    return new SplitNoteByHeadingsEditorContentCommandInvocation(this.plugin, editor, ctx, this.corePluginWrapper, this.headingLevel);
  }
}
