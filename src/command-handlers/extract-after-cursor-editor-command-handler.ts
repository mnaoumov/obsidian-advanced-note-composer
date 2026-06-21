import type {
  App,
  Editor,
  MarkdownFileInfo
} from 'obsidian';
import type { ConsoleDebugComponent } from 'obsidian-dev-utils/obsidian/components/console-debug-component';

import { Notice } from 'obsidian';
import { createFragmentAsync } from 'obsidian-dev-utils/html-element';
import { EditorCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/editor-command-handler';
import { renderInternalLink } from 'obsidian-dev-utils/obsidian/markdown';

import type { PluginSettingsComponent } from '../plugin-settings-component.ts';

import { SplitComposer } from '../composers/split-composer.ts';
import { prepareForSplitFile } from '../modals/split-file-modal.ts';

interface ExtractAfterCursorEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

export class ExtractAfterCursorEditorCommandHandler extends EditorCommandHandler {
  private readonly app: App;
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: ExtractAfterCursorEditorCommandHandlerConstructorParams) {
    super({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-arrow-down-from-line',
      id: 'extract-after-cursor',
      name: 'Extract after cursor...'
    });

    this.app = params.app;
    this.consoleDebugComponent = params.consoleDebugComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  protected override async executeEditor(editor: Editor, ctx: MarkdownFileInfo): Promise<void> {
    const file = ctx.file;
    if (!file) {
      return;
    }

    if (this.pluginSettingsComponent.settings.isPathIgnored(file.path)) {
      new Notice(
        await createFragmentAsync(async (f) => {
          f.appendText('You cannot extract from file ');
          f.appendChild(await renderInternalLink(this.app, file));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }

    editor.setSelection({ ch: editor.getLine(editor.lastLine()).length, line: editor.lastLine() }, editor.getCursor());
    const prepareForSplitFileResult = await prepareForSplitFile({
      app: this.app,
      editor,
      pluginSettingsComponent: this.pluginSettingsComponent,
      sourceFile: file
    });
    if (!prepareForSplitFileResult) {
      return;
    }

    const composer = new SplitComposer({
      app: this.app,
      consoleDebugComponent: this.consoleDebugComponent,
      editor,
      frontmatterMergeStrategy: prepareForSplitFileResult.frontmatterMergeStrategy,
      insertMode: prepareForSplitFileResult.insertMode,
      isMultipleSplit: false,
      isNewTargetFile: prepareForSplitFileResult.isNewTargetFile,
      pluginSettingsComponent: this.pluginSettingsComponent,
      shouldFixFootnotes: prepareForSplitFileResult.shouldFixFootnotes,
      shouldIncludeFrontmatter: prepareForSplitFileResult.shouldIncludeFrontmatter,
      shouldMergeHeadings: prepareForSplitFileResult.shouldMergeHeadings,
      sourceFile: file,
      targetFile: prepareForSplitFileResult.targetFile
    });
    await composer.splitFile();
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  protected override shouldAddToEditorMenu(): boolean {
    return true;
  }
}
