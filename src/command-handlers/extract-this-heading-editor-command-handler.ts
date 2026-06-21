import type { HeadingInfo } from '@obsidian-typings/obsidian-public-latest/implementations';
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

import { getSelectionUnderHeading } from '../composers/composer-base.ts';
import { SplitComposer } from '../composers/split-composer.ts';
import { extractHeadingFromLine } from '../headings.ts';
import { prepareForSplitFile } from '../modals/split-file-modal.ts';

interface ExtractThisHeadingEditorCommandHandlerConstructorParams {
  readonly app: App;
  readonly consoleDebugComponent: ConsoleDebugComponent;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

export class ExtractThisHeadingEditorCommandHandler extends EditorCommandHandler {
  private readonly app: App;
  private readonly consoleDebugComponent: ConsoleDebugComponent;
  private headingInfo?: HeadingInfo;
  private readonly pluginSettingsComponent: PluginSettingsComponent;

  public constructor(params: ExtractThisHeadingEditorCommandHandlerConstructorParams) {
    super({
      editorMenuSubmenuIcon: 'lucide-git-merge',
      icon: 'lucide-scissors',
      id: 'extract-this-heading',
      name: 'Extract this heading...'
    });

    this.app = params.app;
    this.consoleDebugComponent = params.consoleDebugComponent;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  protected override canExecuteEditor(editor: Editor, ctx: MarkdownFileInfo): boolean {
    const file = ctx.file;
    if (!file) {
      return false;
    }

    const lineNumber = editor.getCursor().line;
    const line = editor.getLine(lineNumber);
    const heading = extractHeadingFromLine(line);
    if (!heading) {
      return false;
    }

    const headingInfo = getSelectionUnderHeading(this.app, file, editor, lineNumber);
    if (!headingInfo) {
      return false;
    }

    this.headingInfo = headingInfo;
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
          f.appendText('You cannot extract from file ');
          f.appendChild(await renderInternalLink(this.app, file));
          f.appendText(' because it is ignored in the plugin settings.');
        })
      );
      return;
    }
    if (!this.headingInfo) {
      return;
    }
    editor.setSelection(this.headingInfo.start, this.headingInfo.end);
    const result = await prepareForSplitFile({
      app: this.app,
      editor,
      pluginSettingsComponent: this.pluginSettingsComponent,
      sourceFile: file
    });
    if (!result) {
      return;
    }
    const composer = new SplitComposer({
      app: this.app,
      consoleDebugComponent: this.consoleDebugComponent,
      editor,
      frontmatterMergeStrategy: result.frontmatterMergeStrategy,
      insertMode: result.insertMode,
      isMultipleSplit: false,
      isNewTargetFile: result.isNewTargetFile,
      pluginSettingsComponent: this.pluginSettingsComponent,
      shouldFixFootnotes: result.shouldFixFootnotes,
      shouldIncludeFrontmatter: result.shouldIncludeFrontmatter,
      shouldMergeHeadings: result.shouldMergeHeadings,
      sourceFile: file,
      targetFile: result.targetFile
    });
    await composer.splitFile();
  }

  protected override shouldAddCommandToSubmenu(): boolean {
    return this.pluginSettingsComponent.settings.shouldAddCommandsToSubmenu;
  }

  protected override shouldAddToEditorMenu(editor: Editor, ctx: MarkdownFileInfo): boolean {
    return super.shouldAddToEditorMenu(editor, ctx) || true;
  }
}
