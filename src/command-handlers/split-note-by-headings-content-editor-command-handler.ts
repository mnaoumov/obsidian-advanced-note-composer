import type {
  App,
  Editor,
  EditorPosition,
  MarkdownFileInfo
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';

import { Notice } from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { EditorCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/editor-command-handler';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';
import { getCacheSafe } from 'obsidian-dev-utils/obsidian/metadata-cache';

import type { Level } from '../markdown-heading-document.ts';
import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { getSelectionUnderHeading } from '../composers/composer-base.ts';
import { SplitComposer } from '../composers/split-composer.ts';
import { prepareForSplitFile } from '../modals/split-file-modal.ts';

interface SplitNoteByHeadingsContentEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly headingLevel: Level;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

export class SplitNoteByHeadingsContentEditorCommandHandler extends EditorCommandHandler {
  private readonly app: App;
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly headingLevel: Level;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: SplitNoteByHeadingsContentEditorCommandHandlerConstructorParams) {
    super({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-scissors-line-dashed',
      id: `split-note-by-headings-content-h${String(params.headingLevel)}`,
      name: `Split note by headings content - H${String(params.headingLevel)}`
    });

    this.app = params.app;
    this.consoleDebugComponent = params.consoleDebugComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
    this.headingLevel = params.headingLevel;
  }

  protected override canExecuteEditor(editor: Editor, ctx: MarkdownFileInfo): boolean {
    super.canExecuteEditor(editor, ctx);
    const file = ctx.file;
    if (!file) {
      return false;
    }
    const cache = this.app.metadataCache.getFileCache(file);
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
    if (this.pluginSettingsComponent.settings.isPathIgnored(file.path)) {
      new Notice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot split file ');
          f.appendChild(await renderInternalLink(this.app, file));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }

    let headingIndex = 0;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- No better way for infinite loop.
    while (true) {
      const cache = await getCacheSafe(this.app, file);
      if (!cache) {
        break;
      }
      /* v8 ignore start -- defensive ?? on cache.headings. */
      const heading = (cache.headings ?? []).filter((h) => h.level === this.headingLevel)[headingIndex];
      /* v8 ignore stop */
      if (!heading) {
        break;
      }
      const headingInfo = getSelectionUnderHeading(this.app, file, editor, heading.position.start.line);
      if (!headingInfo) {
        new Notice('Failed to find heading');
        return;
      }
      const splitStart: EditorPosition = { ch: 0, line: heading.position.end.line + 1 };
      editor.setSelection(splitStart, headingInfo.end);
      const result = await prepareForSplitFile({
        app: this.app,
        editor,
        heading: headingInfo.heading,
        pluginSettingsComponent: this.pluginSettingsComponent,
        shouldSkipModal: true,
        sourceFile: file
      });
      if (!result) {
        return;
      }
      const composer = new SplitComposer({
        app: this.app,
        consoleDebugComponent: this.consoleDebugComponent,
        editor,
        heading: headingInfo.heading,
        isMultipleSplit: true,
        isNewTargetFile: result.isNewTargetFile,
        pluginSettingsComponent: this.pluginSettingsComponent,
        sourceFile: file,
        targetFile: result.targetFile
      });
      await composer.splitFile();
      if (this.pluginSettingsComponent.settings.shouldKeepHeadingsWhenSplittingContent) {
        headingIndex++;
      } else {
        editor.replaceRange('', { ch: 0, line: heading.position.start.line }, splitStart);
      }
    }
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return super.shouldAddCommandToSubmenu() ?? this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  protected override shouldAddToEditorMenu(editor: Editor, ctx: MarkdownFileInfo): boolean {
    super.shouldAddToEditorMenu(editor, ctx);
    return true;
  }
}
