import type {
  Editor,
  MarkdownFileInfo
} from 'obsidian';

import { Notice } from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { EditorCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/editor-command-handler';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { getCacheSafe } from 'obsidian-dev-utils/obsidian/metadata-cache';

import type { Level } from '../markdown-heading-document.ts';
import type { Plugin } from '../plugin.ts';

import { getSelectionUnderHeading } from '../composers/composer-base.ts';
import { SplitComposer } from '../composers/split-composer.ts';
import { prepareForSplitFile } from '../modals/split-file-modal.ts';

export class SplitNoteByHeadingsEditorCommandHandler extends EditorCommandHandler {
  protected override get shouldAddCommandToSubmenu(): boolean {
    return this.plugin.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  public constructor(private readonly plugin: Plugin, private readonly headingLevel: Level) {
    super({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-scissors-line-dashed',
      id: `split-note-by-headings-h${String(headingLevel)}`,
      name: `Split note by headings - H${String(headingLevel)}`
    });
  }

  protected override canExecuteEditor(_editor: Editor, ctx: MarkdownFileInfo): boolean {
    const file = ctx.file;
    if (!file) {
      return false;
    }
    const cache = this.plugin.app.metadataCache.getFileCache(file);
    if (!cache) {
      return false;
    }
    const headings = cache.headings?.filter((heading) => heading.level === this.headingLevel);
    if (!headings || headings.length === 0) {
      return false;
    }
    return true;
  }

  protected override async executeEditor(editor: Editor, ctx: MarkdownFileInfo): Promise<void> {
    const file = ctx.file;
    if (!file) {
      return;
    }
    if (this.plugin.pluginSettingsComponent.settings.isPathIgnored(file.path)) {
      new Notice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot split file ');
          f.appendChild(await renderInternalLink(this.plugin.app, file));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- No better way for infinite loop.
    while (true) {
      const cache = await getCacheSafe(this.plugin.app, file);
      if (!cache) {
        break;
      }
      const heading = (cache.headings ?? []).find((h) => h.level === this.headingLevel);
      if (!heading) {
        break;
      }
      const headingInfo = getSelectionUnderHeading(this.plugin.app, file, editor, heading.position.start.line);
      if (!headingInfo) {
        new Notice('Failed to find heading');
        return;
      }
      editor.setSelection(headingInfo.start, headingInfo.end);
      const result = await prepareForSplitFile(this.plugin, file, editor, headingInfo.heading, true);
      if (!result) {
        return;
      }
      const composer = new SplitComposer({
        editor,
        heading: headingInfo.heading,
        isMultipleSplit: true,
        isNewTargetFile: result.isNewTargetFile,
        plugin: this.plugin,
        sourceFile: file,
        targetFile: result.targetFile
      });
      await composer.splitFile();
    }
  }

  protected override shouldAddToEditorMenu(): boolean {
    return true;
  }
}
