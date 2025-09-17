import type {
  Editor,
  IconName,
  MarkdownFileInfo,
  MarkdownView
} from 'obsidian';

import { Notice } from 'obsidian';
import { invokeAsyncSafely } from 'obsidian-dev-utils/Async';
import { getCacheSafe } from 'obsidian-dev-utils/obsidian/MetadataCache';

import type { Level } from '../MarkdownHeadingDocument.ts';
import type { Plugin } from '../Plugin.ts';

import { AdvancedNoteComposer } from '../AdvancedNoteComposer.ts';
import { CorePluginWrapper } from '../CorePluginWrapper.ts';
import { CommandInvocationBase } from './CommandBase.ts';
import {
  EditorCommandBase,
  EditorCommandInvocationBase
} from './EditorCommandBase.ts';

class SplitNoteByHeadingsEditorCommandInvocation extends EditorCommandInvocationBase<Plugin> {
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

    const cache = this.app.metadataCache.getFileCache(this.activeFile);
    if (!cache) {
      return false;
    }

    const headings = cache.headings?.filter((heading) => heading.level === this.headingLevel);
    if (!headings || headings.length === 0) {
      return false;
    }

    return true;
  }

  public override execute(): void {
    super.execute();
    invokeAsyncSafely(() => this.executeAsync());
  }

  private async executeAsync(): Promise<void> {
    const corePlugin = this.corePluginWrapper.getAndCheckCorePlugin();
    if (!corePlugin) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const cache = await getCacheSafe(this.app, this.activeFile);
      if (!cache) {
        break;
      }

      const heading = (cache.headings ?? []).find((h) => h.level === this.headingLevel);
      if (!heading) {
        break;
      }

      const headingInfo = corePlugin.instance.getSelectionUnderHeading(this.activeFile, this.editor, heading.position.start.line);
      if (!headingInfo) {
        new Notice('Failed to find heading');
        return;
      }

      this.editor.setSelection(headingInfo.start, headingInfo.end);
      const composer = new AdvancedNoteComposer(this.plugin, corePlugin.instance, this.activeFile, this.editor, headingInfo.heading);
      await composer.splitFile();
    }
  }
}

export class SplitNoteByHeadingsEditorCommand extends EditorCommandBase<Plugin> {
  public override icon: IconName = 'lucide-scissors-line-dashed';

  public constructor(plugin: Plugin, private readonly corePluginWrapper: CorePluginWrapper, private readonly headingLevel: Level) {
    super({
      icon: 'lucide-scissors-line-dashed',
      id: `split-note-by-headings-h${String(headingLevel)}`,
      name: `Split note by headings - H${String(headingLevel)}`,
      plugin
    });
  }

  protected override createEditorCommandInvocation(editor: Editor, ctx: MarkdownFileInfo | MarkdownView): CommandInvocationBase {
    return new SplitNoteByHeadingsEditorCommandInvocation(this.plugin, editor, ctx, this.corePluginWrapper, this.headingLevel);
  }
}
